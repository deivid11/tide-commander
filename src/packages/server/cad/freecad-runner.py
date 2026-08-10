"""Tide Commander FreeCADCmd worker.

This file intentionally uses only FreeCAD modules, Python's standard library,
and Pillow (bundled by the official FreeCAD Flatpak). It never imports
FreeCADGui, opens a window, or requires an X/Wayland display.
"""

from __future__ import annotations

import inspect
import json
import math
import os
import runpy
import sys
import time
import traceback
from array import array
from pathlib import Path
from typing import Any

import FreeCAD as App
import Part


def _within(root: Path, candidate: Path) -> bool:
    try:
        candidate.relative_to(root)
        return True
    except ValueError:
        return False


def _target_path(workspace: Path, relative_path: str, suffix: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path:
        raise ValueError("Artifact path must be a non-empty string")
    supplied = Path(relative_path)
    if supplied.is_absolute():
        raise ValueError("Artifact paths must be relative to workspace")
    target = (workspace / supplied).resolve(strict=False)
    if not _within(workspace, target):
        raise ValueError("Artifact path escapes workspace: %s" % relative_path)
    if target.suffix.lower() != suffix:
        raise ValueError("Artifact path must end in %s: %s" % (suffix, relative_path))
    target.parent.mkdir(parents=True, exist_ok=True)
    parent = target.parent.resolve(strict=True)
    if not _within(workspace, parent):
        raise ValueError("Artifact parent resolves outside workspace: %s" % relative_path)
    return target


def _staging_path(target: Path, job_id: str) -> Path:
    return target.with_name(".%s.tide-cad-%s%s" % (target.stem, job_id, target.suffix))


def _atomic_json(path_value: str, payload: dict[str, Any]) -> None:
    target = Path(path_value)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(temporary, target)


def _is_document(value: Any) -> bool:
    return hasattr(value, "Objects") and hasattr(value, "recompute") and hasattr(value, "Name")


def _is_document_object(value: Any) -> bool:
    return hasattr(value, "Document") and hasattr(value, "Name") and hasattr(value, "TypeId")


def _is_shape(value: Any) -> bool:
    return hasattr(value, "ShapeType") and hasattr(value, "isValid") and hasattr(value, "BoundBox")


def _collect_build_result(value: Any, aliases: dict[str, Any], preferred: list[Any], name: str | None = None) -> None:
    if value is None:
        return
    if _is_document_object(value):
        preferred.append(value)
        if name:
            aliases[name] = value
        aliases.setdefault(value.Name, value)
        return
    if _is_document(value):
        if name:
            aliases[name] = value
        return
    if _is_shape(value):
        docs = list(App.listDocuments().values())
        doc = App.ActiveDocument or (docs[0] if len(docs) == 1 else App.newDocument("TideCadResult"))
        base_name = name or "Result"
        obj = doc.addObject("Part::Feature", base_name)
        obj.Label = base_name
        obj.Shape = value
        preferred.append(obj)
        aliases[base_name] = obj
        aliases[obj.Name] = obj
        return
    if isinstance(value, dict):
        for key, item in value.items():
            _collect_build_result(item, aliases, preferred, str(key))
        return
    if isinstance(value, (list, tuple, set)):
        for index, item in enumerate(value):
            _collect_build_result(item, aliases, preferred, "%s_%d" % (name or "result", index + 1))


def _call_entrypoint(function: Any, params: dict[str, Any], context: dict[str, Any]) -> Any:
    try:
        signature = inspect.signature(function)
    except (TypeError, ValueError):
        return function(params, context)

    candidates = ((params, context), (params,), ())
    for args in candidates:
        try:
            signature.bind(*args)
        except TypeError:
            continue
        return function(*args)
    raise TypeError("CAD entrypoint must accept build(), build(params), or build(params, context)")


def _document(name: str | None) -> Any:
    documents = App.listDocuments()
    if name:
        if name in documents:
            return documents[name]
        by_label = [doc for doc in documents.values() if getattr(doc, "Label", None) == name]
        if len(by_label) == 1:
            return by_label[0]
        raise ValueError("FreeCAD document not found: %s" % name)
    if len(documents) == 1:
        return next(iter(documents.values()))
    if App.ActiveDocument is not None:
        return App.ActiveDocument
    if not documents:
        raise ValueError("The model script did not create a FreeCAD document")
    raise ValueError("Selection must name a document because the script created several")


def _shape_object(obj: Any) -> bool:
    try:
        return hasattr(obj, "Shape") and obj.Shape is not None and not obj.Shape.isNull()
    except Exception:
        return False


def _object(doc: Any, name: str, aliases: dict[str, Any]) -> Any:
    alias = aliases.get(name)
    if _is_document_object(alias):
        return alias
    obj = doc.getObject(name)
    if obj is not None:
        return obj
    matches = [candidate for candidate in doc.Objects if getattr(candidate, "Label", None) == name]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ValueError("Object label is ambiguous in %s: %s" % (doc.Name, name))
    raise ValueError("Object not found in %s: %s" % (doc.Name, name))


def _selection(spec: dict[str, Any], aliases: dict[str, Any], preferred: list[Any]) -> tuple[Any, list[Any]]:
    names = spec.get("objects")
    document_name = spec.get("document")
    if not document_name and names:
        alias_documents = {
            aliases[name].Document
            for name in names
            if _is_document_object(aliases.get(name))
        }
        doc = next(iter(alias_documents)) if len(alias_documents) == 1 else _document(None)
    else:
        doc = _document(document_name)
    if names:
        objects = [_object(doc, name, aliases) for name in names]
    else:
        preferred_in_doc = [obj for obj in preferred if getattr(obj, "Document", None) is doc and _shape_object(obj)]
        objects = preferred_in_doc or [obj for obj in doc.Objects if _shape_object(obj)]
    if not objects:
        raise ValueError("No shape objects selected in document %s" % doc.Name)
    invalid = [getattr(obj, "Name", repr(obj)) for obj in objects if not _shape_object(obj)]
    if invalid:
        raise ValueError("Selected objects have no usable Shape: %s" % ", ".join(invalid))
    return doc, objects


def _finite(value: float) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Shape contains a non-finite geometry value")
    return number


def _validate_object(obj: Any) -> dict[str, Any]:
    shape = obj.Shape
    bbox = shape.BoundBox
    issues: list[str] = []
    valid = bool(shape.isValid())
    closed = bool(shape.isClosed())
    solids = len(shape.Solids)
    if not valid:
        issues.append("shape is invalid")
    if not closed:
        issues.append("shape is not closed")
    if solids == 0:
        issues.append("shape contains no solids")
    bounds = {
        "min": [_finite(bbox.XMin), _finite(bbox.YMin), _finite(bbox.ZMin)],
        "max": [_finite(bbox.XMax), _finite(bbox.YMax), _finite(bbox.ZMax)],
        "size": [_finite(bbox.XLength), _finite(bbox.YLength), _finite(bbox.ZLength)],
    }
    return {
        "document": obj.Document.Name,
        "object": obj.Name,
        "label": str(getattr(obj, "Label", obj.Name)),
        "shapeType": str(shape.ShapeType),
        "valid": valid,
        "closed": closed,
        "solids": solids,
        "volumeMm3": _finite(shape.Volume),
        "areaMm2": _finite(shape.Area),
        "boundingBox": bounds,
        "passed": valid and closed and solids > 0,
        "issues": issues,
    }


def _artifact_result(kind: str, target: Path, doc: Any, objects: list[Any], **extra: Any) -> dict[str, Any]:
    return {
        "type": kind,
        "path": str(target),
        "sizeBytes": target.stat().st_size,
        "document": doc.Name,
        "objects": [obj.Name for obj in objects],
        **extra,
    }


def _export_output(spec: dict[str, Any], workspace: Path, job_id: str, aliases: dict[str, Any], preferred: list[Any]) -> tuple[dict[str, Any], list[Any]]:
    kind = spec["format"]
    target = _target_path(workspace, spec["path"], ".fcstd" if kind == "fcstd" else "." + kind)
    stage = _staging_path(target, job_id)
    doc, objects = _selection(spec, aliases, preferred)
    try:
        if kind == "fcstd":
            if hasattr(doc, "saveCopy"):
                doc.saveCopy(str(stage))
            else:
                doc.saveAs(str(stage))
        elif kind == "step":
            Part.export(objects, str(stage))
        elif kind == "stl":
            import Mesh
            import MeshPart

            combined = Mesh.Mesh()
            linear = float(spec.get("linearDeflection", 0.03))
            angular = float(spec.get("angularDeflection", 0.10))
            for obj in objects:
                mesh = MeshPart.meshFromShape(
                    Shape=obj.Shape,
                    LinearDeflection=linear,
                    AngularDeflection=angular,
                    Relative=False,
                )
                combined.addMesh(mesh)
            combined.write(str(stage))
            facets = int(combined.CountFacets)
            mesh_solid = bool(combined.isSolid())
            mesh_self_intersections = bool(combined.hasSelfIntersections())
            mesh_non_manifolds = bool(combined.hasNonManifolds())
            mesh_volume = _finite(combined.Volume)
            source_volume = sum(float(obj.Shape.Volume) for obj in objects)
            volume_error = (
                abs(mesh_volume - source_volume) / source_volume * 100.0
                if source_volume > 1e-12
                else 0.0
            )
            mesh_validation = {
                "solid": mesh_solid,
                "selfIntersections": mesh_self_intersections,
                "nonManifolds": mesh_non_manifolds,
                "volumeMm3": mesh_volume,
                "volumeErrorPercent": volume_error,
                "passed": mesh_solid and not mesh_non_manifolds and volume_error < 0.1,
            }
        else:
            raise ValueError("Unsupported output format: %s" % kind)
        os.replace(stage, target)
    finally:
        if stage.exists():
            stage.unlink()
    extra = {"facets": facets, "meshValidation": mesh_validation} if kind == "stl" else {}
    return _artifact_result(kind, target, doc, objects, **extra), objects


def _vec(value: Any) -> tuple[float, float, float]:
    return float(value.x), float(value.y), float(value.z)


def _sub(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return a[0] - b[0], a[1] - b[1], a[2] - b[2]


def _dot(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]


def _normal(value: tuple[float, float, float]) -> tuple[float, float, float]:
    length = math.sqrt(_dot(value, value))
    if length <= 1e-12:
        return 0.0, 0.0, 0.0
    return value[0] / length, value[1] / length, value[2] / length


def _hex_color(value: str) -> tuple[int, int, int]:
    text = value.lstrip("#")
    return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)


def _shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int, int]:
    return tuple(max(0, min(255, round(component * factor))) for component in color) + (255,)


def _camera(view: str) -> tuple[float, float, float]:
    return {
        "isometric": (1.0, -1.0, 0.8),
        "front": (0.0, -1.0, 0.0),
        "back": (0.0, 1.0, 0.0),
        "left": (-1.0, 0.0, 0.0),
        "right": (1.0, 0.0, 0.0),
        "top": (0.0, 0.0, 1.0),
        "bottom": (0.0, 0.0, -1.0),
    }[view]


def _render(spec: dict[str, Any], workspace: Path, job_id: str, aliases: dict[str, Any], preferred: list[Any]) -> tuple[dict[str, Any], list[Any]]:
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError("Headless PNG rendering requires Pillow in FreeCAD's Python environment") from error

    target = _target_path(workspace, spec["path"], ".png")
    stage = _staging_path(target, job_id)
    doc, objects = _selection(spec, aliases, preferred)
    view = spec.get("view", "isometric")
    width = int(spec.get("width", 1200))
    height = int(spec.get("height", 900))
    supersample = 2
    draw_width, draw_height = width * supersample, height * supersample
    base_color = _hex_color(spec.get("color", "#6f8fae"))
    edge_color = _hex_color(spec.get("edgeColor", "#22313f")) + (210,)
    background_value = spec.get("background", "#f4f6f8")
    background = (0, 0, 0, 0) if background_value == "transparent" else _hex_color(background_value) + (255,)
    show_edges = bool(spec.get("edges", True))
    deflection = float(spec.get("linearDeflection", 0.08))

    camera = _normal(_camera(view))
    up_reference = (0.0, 1.0, 0.0) if abs(camera[2]) > 0.95 else (0.0, 0.0, 1.0)
    right = _normal(_cross(up_reference, camera))
    screen_up = _normal(_cross(camera, right))
    light = _normal((camera[0] + 0.25, camera[1] - 0.15, camera[2] + 0.65))

    triangles: list[dict[str, Any]] = []
    edge_normals: dict[tuple[int, int, int], list[tuple[float, float, float]]] = {}
    all_projected: list[tuple[float, float]] = []
    for object_index, obj in enumerate(objects):
        vertices, facets = obj.Shape.tessellate(deflection)
        points = [_vec(vertex) for vertex in vertices]
        for facet in facets:
            a, b, c = points[facet[0]], points[facet[1]], points[facet[2]]
            normal = _normal(_cross(_sub(b, a), _sub(c, a)))
            if normal == (0.0, 0.0, 0.0):
                continue
            edges = [
                (object_index, min(facet[0], facet[1]), max(facet[0], facet[1])),
                (object_index, min(facet[1], facet[2]), max(facet[1], facet[2])),
                (object_index, min(facet[2], facet[0]), max(facet[2], facet[0])),
            ]
            for edge in edges:
                edge_normals.setdefault(edge, []).append(normal)
            # FreeCAD tessellates solid faces with outward winding. Removing
            # back faces halves the software rasterizer's work.
            if _dot(normal, camera) <= 1e-9:
                continue
            projected = [(_dot(point, right), _dot(point, screen_up)) for point in (a, b, c)]
            all_projected.extend(projected)
            depths = [_dot(point, camera) for point in (a, b, c)]
            illumination = 0.35 + 0.65 * max(0.0, _dot(normal, light))
            triangles.append({
                "projected": projected,
                "depths": depths,
                "fill": _shade(base_color, illumination),
                "edges": edges,
            })
    if not triangles or not all_projected:
        raise ValueError("Selected objects produced no renderable triangles")

    min_x = min(point[0] for point in all_projected)
    max_x = max(point[0] for point in all_projected)
    min_y = min(point[1] for point in all_projected)
    max_y = max(point[1] for point in all_projected)
    span_x = max(max_x - min_x, 1e-9)
    span_y = max(max_y - min_y, 1e-9)
    margin = float(spec.get("fitMargin", 0.08))
    inner_width = draw_width * (1.0 - 2.0 * margin)
    inner_height = draw_height * (1.0 - 2.0 * margin)
    scale = min(inner_width / span_x, inner_height / span_y)
    center_x = (min_x + max_x) / 2.0
    center_y = (min_y + max_y) / 2.0

    def pixel(point: tuple[float, float]) -> tuple[float, float]:
        return (
            draw_width / 2.0 + (point[0] - center_x) * scale,
            draw_height / 2.0 - (point[1] - center_y) * scale,
        )

    image = Image.new("RGBA", (draw_width, draw_height), background)
    pixels = image.load()
    z_buffer = array("f", [-math.inf]) * (draw_width * draw_height)

    def raster_triangle(screen: list[tuple[float, float]], depths: list[float], fill: tuple[int, int, int, int]) -> None:
        x0, y0 = screen[0]
        x1, y1 = screen[1]
        x2, y2 = screen[2]
        denominator = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(denominator) <= 1e-12:
            return
        min_px = max(0, int(math.floor(min(x0, x1, x2))))
        max_px = min(draw_width - 1, int(math.ceil(max(x0, x1, x2))))
        min_py = max(0, int(math.floor(min(y0, y1, y2))))
        max_py = min(draw_height - 1, int(math.ceil(max(y0, y1, y2))))
        epsilon = -1e-7
        for py in range(min_py, max_py + 1):
            sample_y = py + 0.5
            row = py * draw_width
            for px in range(min_px, max_px + 1):
                sample_x = px + 0.5
                w0 = ((y1 - y2) * (sample_x - x2) + (x2 - x1) * (sample_y - y2)) / denominator
                w1 = ((y2 - y0) * (sample_x - x2) + (x0 - x2) * (sample_y - y2)) / denominator
                w2 = 1.0 - w0 - w1
                if w0 < epsilon or w1 < epsilon or w2 < epsilon:
                    continue
                depth = w0 * depths[0] + w1 * depths[1] + w2 * depths[2]
                index = row + px
                if depth > z_buffer[index]:
                    z_buffer[index] = depth
                    pixels[px, py] = fill

    screen_triangles: list[dict[str, Any]] = []
    for triangle in triangles:
        screen = [pixel(point) for point in triangle["projected"]]
        raster_triangle(screen, triangle["depths"], triangle["fill"])
        screen_triangles.append({**triangle, "screen": screen})

    if show_edges:
        # Only draw boundaries and true creases, not every tessellation
        # diagonal. This keeps curved surfaces smooth and dimensions legible.
        crease_cosine = math.cos(math.radians(28.0))
        feature_edges = {
            edge
            for edge, normals in edge_normals.items()
            if len(normals) == 1 or any(_dot(normals[0], other) < crease_cosine for other in normals[1:])
        }
        all_depths = [depth for triangle in triangles for depth in triangle["depths"]]
        depth_tolerance = max(1e-4, (max(all_depths) - min(all_depths)) * 0.002)

        def raster_edge(start: tuple[float, float], end: tuple[float, float], start_depth: float, end_depth: float) -> None:
            dx, dy = end[0] - start[0], end[1] - start[1]
            steps = max(1, int(math.ceil(max(abs(dx), abs(dy)))))
            for step in range(steps + 1):
                fraction = step / steps
                px = int(round(start[0] + dx * fraction))
                py = int(round(start[1] + dy * fraction))
                depth = start_depth + (end_depth - start_depth) * fraction
                for offset_y in range(-supersample // 2, supersample // 2 + 1):
                    for offset_x in range(-supersample // 2, supersample // 2 + 1):
                        x, y = px + offset_x, py + offset_y
                        if 0 <= x < draw_width and 0 <= y < draw_height:
                            index = y * draw_width + x
                            if depth + depth_tolerance >= z_buffer[index]:
                                pixels[x, y] = edge_color

        for triangle in screen_triangles:
            screen = triangle["screen"]
            depths = triangle["depths"]
            for edge_index, (start_index, end_index) in enumerate(((0, 1), (1, 2), (2, 0))):
                if triangle["edges"][edge_index] in feature_edges:
                    raster_edge(screen[start_index], screen[end_index], depths[start_index], depths[end_index])
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    try:
        image.save(stage, format="PNG", optimize=True)
        os.replace(stage, target)
    finally:
        if stage.exists():
            stage.unlink()
    return _artifact_result("png", target, doc, objects, facets=len(triangles), view=view), objects


def _resolve_reference(reference: dict[str, Any], aliases: dict[str, Any]) -> Any:
    alias = aliases.get(reference["object"])
    doc = (
        alias.Document
        if not reference.get("document") and _is_document_object(alias)
        else _document(reference.get("document"))
    )
    obj = _object(doc, reference["object"], aliases)
    if not _shape_object(obj):
        raise ValueError("Check object has no usable Shape: %s" % reference["object"])
    return obj


def _run_check(spec: dict[str, Any], aliases: dict[str, Any]) -> dict[str, Any]:
    a = _resolve_reference(spec["a"], aliases)
    b = _resolve_reference(spec["b"], aliases)
    label = spec.get("name") or "%s:%s/%s" % (spec["type"], a.Name, b.Name)
    if spec["type"] == "clearance":
        distance = _finite(a.Shape.distToShape(b.Shape)[0])
        minimum = float(spec["minimum"])
        return {
            "type": "clearance",
            "name": label,
            "passed": distance + 1e-9 >= minimum,
            "distanceMm": distance,
            "expected": {"minimumMm": minimum},
        }
    maximum = float(spec.get("maximumVolume", 0.0))
    common_volume = _finite(a.Shape.common(b.Shape).Volume)
    return {
        "type": "intersection",
        "name": label,
        "passed": common_volume <= maximum + 1e-9,
        "commonVolumeMm3": common_volume,
        "expected": {"maximumVolumeMm3": maximum},
    }


def run(request: dict[str, Any]) -> dict[str, Any]:
    started = time.monotonic()
    workspace = Path(request["workspace"]).resolve(strict=True)
    if not workspace.is_dir():
        raise ValueError("workspace must be a directory")
    script = (workspace / request["script"]).resolve(strict=True)
    if not _within(workspace, script) or script.suffix.lower() != ".py":
        raise ValueError("script must be a .py file inside workspace")

    params = request.get("parameters") or {}
    context = {
        "workspace": str(workspace),
        "jobId": request.get("jobId"),
        "headless": True,
    }
    sys.path.insert(0, str(script.parent))
    namespace = runpy.run_path(
        str(script),
        init_globals={
            "App": App,
            "Part": Part,
            "TIDE_CAD_PARAMS": params,
            "TIDE_CAD_CONTEXT": context,
        },
        run_name="__tide_cad__",
    )

    aliases: dict[str, Any] = {}
    preferred: list[Any] = []
    entrypoint = request.get("entrypoint", "build")
    if entrypoint is not None:
        function = namespace.get(entrypoint)
        if not callable(function):
            raise ValueError("CAD entrypoint not found or not callable: %s" % entrypoint)
        build_result = _call_entrypoint(function, params, context)
        _collect_build_result(build_result, aliases, preferred)

    documents = list(App.listDocuments().values())
    if not documents:
        raise ValueError("The model script did not create a FreeCAD document")
    for doc in documents:
        doc.recompute()

    artifacts: list[dict[str, Any]] = []
    selected: list[Any] = []
    for output in request.get("outputs") or []:
        artifact, objects = _export_output(output, workspace, str(request.get("jobId", "job")), aliases, preferred)
        artifacts.append(artifact)
        selected.extend(objects)
    for render in request.get("renders") or []:
        artifact, objects = _render(render, workspace, str(request.get("jobId", "job")), aliases, preferred)
        artifacts.append(artifact)
        selected.extend(objects)

    if not selected:
        selected = [obj for doc in documents for obj in doc.Objects if _shape_object(obj)]
    unique_objects: list[Any] = []
    seen: set[tuple[str, str]] = set()
    for obj in selected:
        key = (obj.Document.Name, obj.Name)
        if key not in seen:
            seen.add(key)
            unique_objects.append(obj)

    validations = [_validate_object(obj) for obj in unique_objects]
    checks = [_run_check(check, aliases) for check in request.get("checks") or []]
    version = ".".join(str(part) for part in App.Version()[:3])
    return {
        "ok": True,
        "freecadVersion": version,
        "durationMs": round((time.monotonic() - started) * 1000),
        "artifacts": artifacts,
        "validations": validations,
        "checks": checks,
        "documents": [doc.Name for doc in documents],
    }


def main() -> int:
    request_path = os.environ.get("TIDE_CAD_JOB_PATH")
    result_path = os.environ.get("TIDE_CAD_RESULT_PATH")
    # Direct invocation with CPython remains convenient for diagnostics, even
    # though production uses environment variables because FreeCADCmd treats
    # every extra CLI argument as another model file to import.
    if (not request_path or not result_path) and len(sys.argv) >= 3:
        request_path, result_path = sys.argv[-2], sys.argv[-1]
    if not request_path or not result_path:
        print("Set TIDE_CAD_JOB_PATH and TIDE_CAD_RESULT_PATH", file=sys.stderr)
        return 2
    started = time.monotonic()
    try:
        request = json.loads(Path(request_path).read_text(encoding="utf-8"))
        result = run(request)
        _atomic_json(result_path, result)
        print("TIDE_CAD_RESULT %s" % json.dumps({"ok": True, "artifacts": len(result["artifacts"])}))
        return 0
    except BaseException as error:
        failure = {
            "ok": False,
            "durationMs": round((time.monotonic() - started) * 1000),
            "artifacts": [],
            "validations": [],
            "checks": [],
            "documents": list(App.listDocuments().keys()),
            "error": "%s: %s" % (type(error).__name__, error),
            "traceback": traceback.format_exc(),
        }
        try:
            _atomic_json(result_path, failure)
        except Exception:
            pass
        traceback.print_exc()
        return 1


# FreeCADCmd executes script files in its console namespace instead of setting
# __name__ to "__main__". This file is a dedicated executable worker, not an
# importable module, so invoke it unconditionally.
raise SystemExit(main())
