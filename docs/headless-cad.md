# Headless CAD with FreeCAD

Tide Commander can build parametric FreeCAD models without opening the
FreeCAD GUI. The server runs each model in a fresh `FreeCADCmd` process,
serializes jobs by default, validates the resulting shapes, and can write
FCStd, STL, STEP, and PNG artifacts directly into the model workspace.

The implementation uses FreeCAD/OpenCASCADE as the geometry kernel. It is a
headless automation layer, not a second CAD kernel.

## Requirements

Install either `FreeCADCmd`/`freecadcmd` on `PATH`, or the official FreeCAD
Flatpak. Fedora's default setup works without extra configuration:

```bash
flatpak install flathub org.freecad.FreeCAD
```

Check what Tide Commander detects:

```text
GET /api/cad/capabilities
```

Set `TIDE_CAD_FREECAD_CMD=/absolute/path/to/FreeCADCmd` to override the
executable. For a non-default Flatpak application ID, set
`TIDE_CAD_FREECAD_FLATPAK_ID`. Jobs run one at a time unless
`TIDE_CAD_MAX_CONCURRENCY` is set to a value from 1 to 4.

## Model script contract

Keep source geometry in a Python file inside the workspace. A normal script
exports a `build` function and returns the document objects agents will name
in job requests:

```python
import FreeCAD as App
import Part

def build(params, context):
    doc = App.newDocument("DeviceV41")
    shape = Part.makeBox(float(params.get("width", 40)), 30, 8)
    part = doc.addObject("Part::Feature", "LowerCase")
    part.Shape = shape
    doc.recompute()
    return {"lower": part}
```

Accepted signatures are `build()`, `build(params)`, and
`build(params, context)`. `context` contains `workspace`, `jobId`, and
`headless: True`. Returned dictionary keys become aliases, so a request can
select `"lower"` even when FreeCAD renamed the internal object.

Headless scripts must not import `FreeCADGui` or unconditionally touch
`ViewObject`. A headless `saveAs` writes `Document.xml` only — there is no
`GuiDocument.xml` — so the Tide Commander 3D viewer will not see
`ViewObject.ShapeColor`. Persist the colour on the App object as well:

```python
if "ShapeColor" not in part.PropertiesList:
    part.addProperty("App::PropertyColor", "ShapeColor", "View")
part.ShapeColor = (0.4, 0.6, 0.8)
if "Transparency" not in part.PropertiesList:
    part.addProperty("App::PropertyPercent", "Transparency", "View")
part.Transparency = 0
if App.GuiUp:
    part.ViewObject.ShapeColor = (0.4, 0.6, 0.8)
```

Legacy scripts that build at module load time can use `"entrypoint": null`.
For reproducibility, prefer a side-effect-free module plus `build`.

## Start and poll a job

All paths except `workspace` are relative to the workspace. Tide rejects path
traversal and symlinks escaping it. The global `/api` authentication middleware
also applies to these routes.

```text
POST /api/cad/jobs
```

```json
{
  "workspace": "/home/riven/d/project/case",
  "script": "build_v41.py",
  "parameters": { "wall": 2.0 },
  "outputs": [
    { "format": "fcstd", "path": "v41.FCStd", "document": "DeviceV41" },
    { "format": "stl", "path": "stls/lower.stl", "objects": ["lower"] },
    { "format": "step", "path": "step/lower.step", "objects": ["lower"] }
  ],
  "renders": [
    {
      "path": "renders/lower_iso.png",
      "objects": ["lower"],
      "view": "isometric",
      "width": 1200,
      "height": 900,
      "edges": true
    }
  ],
  "checks": [
    {
      "type": "clearance",
      "name": "PCB below lid",
      "a": { "object": "pcb" },
      "b": { "object": "upper" },
      "minimum": 0.6
    },
    {
      "type": "intersection",
      "name": "speaker vs battery",
      "a": { "object": "speaker" },
      "b": { "object": "battery" },
      "maximumVolume": 0
    }
  ]
}
```

The response is `202 Accepted` with a job ID. Poll until status is terminal:

```text
GET /api/cad/jobs/JOB_ID
```

Statuses are `queued`, `running`, `completed`, `failed`, and `cancelled`.
Cancel a queued or running job with `DELETE /api/cad/jobs/JOB_ID`; list recent
jobs with `GET /api/cad/jobs?limit=20`.

## Reading validation results

Every selected shape reports `valid`, `closed`, `solids`, volume, area, and
bounding box. A completed job means FreeCAD finished and artifacts were
written; it does not mean every engineering check passed. Before accepting a
print, require all relevant `validations[].passed` and `checks[].passed` values
to be true. For every STL also require
`artifacts[].meshValidation.passed`: it checks that the mesh is solid, has no
non-manifold edges, and stays within 0.1% of the source solid's volume. Inspect
at least one PNG as the final orientation/feature sanity check.

STL meshing defaults to 0.03 mm linear deflection and 0.10 rad angular
deflection. Renders use an orthographic software rasterizer over FreeCAD's
tessellation, so they need no window, display server, browser, or WebGL.
Supported named views are `isometric`, `front`, `back`, `left`, `right`,
`top`, and `bottom`.

Artifacts are exported to hidden staging files in their destination directory
and atomically renamed only after a successful write. A failed export therefore
does not leave a half-written final file.

See [`examples/headless-cad`](../examples/headless-cad) for a runnable model
and request body.
