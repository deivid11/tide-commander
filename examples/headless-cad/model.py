"""Small headless-safe model used by the Tide Commander CAD example."""

import FreeCAD as App
import Part


def build(params, context):
    length = float(params.get("length", 40))
    width = float(params.get("width", 28))
    height = float(params.get("height", 8))
    hole_diameter = float(params.get("holeDiameter", 5))

    doc = App.newDocument("HeadlessCadExample")
    body = Part.makeBox(length, width, height)
    hole = Part.makeCylinder(
        hole_diameter / 2,
        height + 2,
        App.Vector(length / 2, width / 2, -1),
    )
    finished = body.cut(hole).removeSplitter()

    part = doc.addObject("Part::Feature", "PrintedPart")
    part.Label = "Printed Part"
    part.Shape = finished
    doc.recompute()
    return {"part": part}
