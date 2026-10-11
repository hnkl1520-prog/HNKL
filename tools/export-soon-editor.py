"""Export editable WIP outlines with the font's natural glyph proportions.

Run with Blender:
  /Applications/Blender.app/Contents/MacOS/Blender --background \
    --factory-startup --threads 1 --python tools/export-soon-editor.py

Arial Regular's authentic curves are exported directly. Every glyph is 260
units tall, with 64 units between glyphs; the complete word is centered in the
1120 by 360 viewBox.
"""

import json
from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/experiments/page-states/soon-editor/glyphs.js"
FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
GLYPHS = [("W", "w"), ("I", "i"), ("P", "p")]
TOP, BOTTOM = 50.0, 310.0
GAP, VIEWBOX_WIDTH = 64.0, 1120.0


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    font = bpy.data.fonts.load(FONT)
    letters = []
    cursor = 0.0
    for char, glyph_id in GLYPHS:
        curve = bpy.data.curves.new("Outline " + glyph_id, "FONT")
        curve.body = char
        curve.font = font
        curve.size = 1
        curve.resolution_u = 12
        obj = bpy.data.objects.new(glyph_id, curve)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.convert(target="CURVE")
        obj = bpy.context.object
        points = [point.co for spline in obj.data.splines for point in spline.bezier_points]
        x0, x1 = min(p.x for p in points), max(p.x for p in points)
        y0, y1 = min(p.y for p in points), max(p.y for p in points)
        scale = (BOTTOM - TOP) / (y1 - y0)

        def position(vector):
            return [
                cursor + (vector.x - x0) * scale,
                BOTTOM - (vector.y - y0) * scale,
            ]

        contours = [[{
            "p": position(p.co),
            "inHandle": position(p.handle_left),
            "outHandle": position(p.handle_right),
        } for p in spline.bezier_points] for spline in obj.data.splines]
        letters.append({"name": char, "id": glyph_id, "contours": contours})
        cursor += (x1 - x0) * scale + GAP
        obj.select_set(False)

    shift = (VIEWBOX_WIDTH - (cursor - GAP)) / 2
    for glyph in letters:
        for contour in glyph["contours"]:
            for node in contour:
                for key in ("p", "inHandle", "outHandle"):
                    node[key] = [round(node[key][0] + shift, 3), round(node[key][1], 3)]

    OUTPUT.write_text(
        "// Editable WIP outlines from Arial Regular. Natural proportions, 260-unit height, 64-unit gaps. No font file is shipped.\n"
        + "export const originalGlyphs=" + json.dumps(letters, separators=(",", ":")) + ";\n"
    )
    print("OUTLINES", [(g["id"], [len(c) for c in g["contours"]]) for g in letters])


if __name__ == "__main__":
    main()
