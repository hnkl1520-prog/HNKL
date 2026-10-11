"""Build four independent, rough stone letters for the SOON experiment.

Run with Blender, for example:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
    tools/build-soon-stone.py -- --preview /tmp/soon-stone-preview.png

The exported glTF uses Y-up, faces +Z, and contains S, O1, O2, N at the
origin with identity transforms. Each letter has its own centered mesh.
The preview arranges those same meshes horizontally only after exporting.
"""

import argparse
import json
import math
import os
import random
import sys
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "public/experiments/page-states/soon-stone/assets/soon-stone.glb"
FONT = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(DEFAULT_OUT))
    parser.add_argument("--preview", default="")
    parser.add_argument("--voxel", type=float, default=0.0145)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])


def active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply(obj, modifier):
    active(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def bounds(obj):
    vertices = [v.co for v in obj.data.vertices]
    lo = Vector([min(v[i] for v in vertices) for i in range(3)])
    hi = Vector([max(v[i] for v in vertices) for i in range(3)])
    return lo, hi


def center(obj):
    lo, hi = bounds(obj)
    midpoint = (lo + hi) * 0.5
    for vertex in obj.data.vertices:
        vertex.co -= midpoint


def stone_material(name="Neutral stone"):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.48, 0.47, 0.44, 1)
    bsdf.inputs["Roughness"].default_value = 0.93
    bsdf.inputs["Metallic"].default_value = 0
    return material


def subtract_cutter(obj, cutter, name):
    modifier = obj.modifiers.new(name, "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    apply(obj, modifier)
    bpy.data.objects.remove(cutter, do_unlink=True)


def cut_plane(obj, point, normal, name):
    """Remove a half-space with a real capped Boolean plane."""
    normal = Vector(normal).normalized()
    size = 4.0
    bpy.ops.mesh.primitive_cube_add(size=size)
    cutter = bpy.context.object
    cutter.name = name + " cutter"
    cutter.rotation_euler = normal.to_track_quat("Z", "Y").to_euler()
    cutter.location = Vector(point) + normal * (size * 0.5)
    subtract_cutter(obj, cutter, name)


def chip(obj, point, radius, rng, name):
    """A low-sided, asymmetric convex cutter leaves real fractured facets."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
    cutter = bpy.context.object
    cutter.name = name + " cutter"
    for vertex in cutter.data.vertices:
        vertex.co *= rng.uniform(0.86, 1.13)
    cutter.scale = radius
    cutter.rotation_euler = (
        rng.uniform(-0.5, 0.5), rng.uniform(-0.55, 0.55), rng.uniform(-math.pi, math.pi)
    )
    cutter.location = point
    subtract_cutter(obj, cutter, name)


def rock_uv(obj):
    """One UV unit per world unit; no packed atlas or tiny stretched islands."""
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    uv = obj.data.uv_layers.new(name="StoneUV")
    obj.data.uv_layers.active = uv
    obj.data.update()
    for polygon in obj.data.polygons:
        normal = polygon.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for loop_index in polygon.loop_indices:
            co = obj.data.vertices[obj.data.loops[loop_index].vertex_index].co
            if axis == 2:
                u, v = co.x, co.y
            elif axis == 0:
                u, v = co.z, co.y
            else:
                u, v = co.x, co.z
            if normal[axis] < 0:
                u = -u
            uv.data[loop_index].uv = (u, v)


def outline_fractures(obj, index):
    """Cut four oblique slabs through the full depth of the stone blank."""
    # Each pair of O glyphs has a visibly different set of supporting planes.
    angles = ([0.19, 1.48, 2.88, 4.70] if index == 1 else
              [0.63, 2.17, 3.65, 5.36] if index == 2 else
              [0.38, 1.79, 3.08, 4.85])
    for i, angle in enumerate(angles):
        n = Vector((math.cos(angle), math.sin(angle), [0.085, -0.055, 0.065, -0.075][i]))
        n.normalize()
        outer = max(v.co.dot(n) for v in obj.data.vertices)
        loss = [0.040, 0.054, 0.032, 0.046][(i + index) % 4]
        if index in (0, 3):
            loss *= 0.76
        cut_plane(obj, n * (outer - loss), n, "Through-depth outline fracture %d" % i)


def bake_limestone_relief(obj, index):
    """Shallow relief from the actual rock height map, with no procedural noise.

    Native XY becomes glTF XY. Three uploads its JPG with flipY=false, so the
    first image row is UV v=0; Blender's pixel buffer needs a vertical flip.
    """
    path = DEFAULT_OUT.parent / "limestone-height.jpg"
    if not path.exists():
        raise FileNotFoundError("Rock height map is required: " + str(path))
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    # Split the broad Boolean caps with a uniform XY grid before triangulating.
    # Subdividing their original triangle fans would retain skinny radial
    # triangles and make the height map produce directional shading artefacts.
    lo, hi = bounds(obj)
    for axis in (0, 1):
        line = math.ceil(lo[axis] / 0.025) * 0.025
        while line < hi[axis]:
            front = [f for f in bm.faces if f.normal.z > 0.70 and
                     min(v.co.z for v in f.verts) > 0.10]
            edges = set(e for f in front for e in f.edges)
            verts = set(v for f in front for v in f.verts)
            point, normal = [0, 0, 0], [0, 0, 0]
            point[axis], normal[axis] = line, 1
            bmesh.ops.bisect_plane(bm, geom=list(verts) + list(edges) + front,
                                  dist=0.000001, plane_co=point, plane_no=normal,
                                  clear_inner=False, clear_outer=False)
            bm.normal_update()
            line += 0.025
    bmesh.ops.triangulate(bm, faces=list(bm.faces), quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()

    img = bpy.data.images.load(str(path), check_existing=True)
    img.colorspace_settings.name = "Non-Color"
    width, height = img.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    img.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)[:, :, 0]

    def sample(x, y):
        u = (x * 0.75 + index * 0.713) % 1
        v = (y * 0.75 + index * 1.379) % 1
        px, py = u * width - 0.5, (1 - v) * height - 0.5
        ix, iy = math.floor(px), math.floor(py)
        fx, fy = px - ix, py - iy
        a = pixels[iy % height, ix % width] * (1 - fx) + pixels[iy % height, (ix + 1) % width] * fx
        b = pixels[(iy + 1) % height, ix % width] * (1 - fx) + pixels[(iy + 1) % height, (ix + 1) % width] * fx
        return float(a * (1 - fy) + b * fy)

    offsets = []
    for vertex in obj.data.vertices:
        # The broad face gets the height map; taper into the side walls so
        # small rim chips and cut silhouettes stay intact.
        weight = max(0, min(1, (vertex.co.z - 0.11) / 0.085))
        weight = weight * weight * (3 - 2 * weight)
        offset = (sample(vertex.co.x, vertex.co.y) - 0.5) * 0.032 * weight
        vertex.co.z += offset
        offsets.append(offset)
    obj.data.update()
    # Center depth only: XY must not shift after the map has been sampled.
    lo, hi = bounds(obj)
    for vertex in obj.data.vertices:
        vertex.co.z -= (lo.z + hi.z) * 0.5
    return {"height_map": path.name, "range": [round(min(offsets), 5), round(max(offsets), 5)],
            "density": 0.75, "offset_xy": [index * 0.713, index * 1.379], "flipY": False}


def make_letter(name, char, index, font, material, voxel):
    rng = random.Random(571 + index * 101)
    curve = bpy.data.curves.new(name + " source", type="FONT")
    curve.body = char
    curve.font = font
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = 1
    curve.resolution_u = 20
    curve.offset = 0.010
    curve.extrude = 0.18
    curve.bevel_depth = 0.009
    curve.bevel_resolution = 1
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    active(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    obj.data.name = name + " fractured stone mesh"

    lo, hi = bounds(obj)
    height, depth = hi.y - lo.y, hi.z - lo.z
    for vertex in obj.data.vertices:
        vertex.co.x /= height
        vertex.co.y /= height
        vertex.co.z *= 0.56 / depth
    center(obj)

    remesh = obj.modifiers.new("Manifold stone blank", "REMESH")
    remesh.mode = "VOXEL"
    remesh.voxel_size = voxel
    remesh.use_smooth_shade = True
    apply(obj, remesh)
    smooth = obj.modifiers.new("Remove voxel stair steps", "SMOOTH")
    smooth.factor = 0.5
    smooth.iterations = 1
    apply(obj, smooth)

    # Only large, low-frequency changes: there is no cloudy/high-frequency
    # displacement. The two O blanks do not share the same outline or thickness.
    phase = index * 1.41
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        vertex.co.x = x + 0.017 * math.sin(5.1 * y + phase) + 0.010 * math.sin(8.3 * y - phase)
        vertex.co.y = y + 0.012 * math.sin(4.8 * x + phase * 0.7)
        vertex.co.z = z * (1 + 0.12 * math.sin(3.2 * x + 2.8 * y + phase))
    obj.data.update()

    decimate = obj.modifiers.new("Stone blank density", "DECIMATE")
    decimate.ratio = 0.72
    apply(obj, decimate)

    # Four intersecting planar cuts retain a broad, quiet central face and
    # remove substantial slabs at its edges. Caps are real geometry, not a
    # bump texture or a height-field ripple.
    front_planes = [
        (0.244, 0.023, -0.016),
        (0.298, 0.215, 0.150),
        (0.288, -0.185, 0.120),
        (0.291, 0.115, -0.185),
    ]
    spin = (index - 1.5) * 0.21
    for plane_index, (c, a, b) in enumerate(front_planes):
        ax = a * math.cos(spin) - b * math.sin(spin)
        ay = a * math.sin(spin) + b * math.cos(spin)
        cut_plane(obj, (0, 0, c + rng.uniform(-0.006, 0.006)), (-ax, -ay, 1),
                  "Front fracture %d" % plane_index)
    cut_plane(obj, (0, 0, -0.261), (0.065, -0.035, -1), "Back split")
    cut_plane(obj, (0, 0, -0.282), (-0.17, 0.13, -1), "Back corner loss")
    outline_fractures(obj, index)

    lo, hi = bounds(obj)
    half_x, half_y = (hi.x - lo.x) * 0.5, (hi.y - lo.y) * 0.5
    angles = [0.27, 1.45, 2.67, 3.88, 5.16]
    for chip_index, angle in enumerate(angles):
        angle += index * 0.36
        target = Vector((math.cos(angle) * half_x * 1.35,
                         math.sin(angle) * half_y * 1.35, 0.24))
        candidates = [v.co.copy() for v in obj.data.vertices if v.co.z > 0.07]
        point = min(candidates, key=lambda p: (p.x - target.x) ** 2 + (p.y - target.y) ** 2 +
                    0.22 * (p.z - target.z) ** 2)
        outward = Vector((point.x / max(half_x * half_x, 0.01),
                           point.y / max(half_y * half_y, 0.01), 0)).normalized()
        point += outward * 0.018
        point.z += 0.017
        major = chip_index == (index % 5)
        radius = (0.115, 0.085, 0.090) if major else (0.075, 0.061, 0.063)
        chip(obj, point, radius, rng, "Broken rim %d" % chip_index)
        if major:
            # Two smaller losses cluster at the major fracture instead of
            # peppering the entire face with equally sized surface noise.
            tangent = Vector((-outward.y, outward.x, 0))
            for side in (-1, 1):
                little = point + tangent * (side * 0.074) - outward * 0.008
                little.z -= 0.017
                chip(obj, little, (0.042, 0.028, 0.034), rng, "Corner crunch %d" % side)

    lo, hi = bounds(obj)
    factor = 1 / (hi.y - lo.y)
    for vertex in obj.data.vertices:
        vertex.co *= factor
    center(obj)
    relief = bake_limestone_relief(obj, index)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    split = obj.modifiers.new("Preserve sharp stone fracture seams", "EDGE_SPLIT")
    split.split_angle = math.radians(38)
    split.use_edge_angle = True
    split.use_edge_sharp = False
    apply(obj, split)
    rock_uv(obj)
    obj.data.materials.clear()
    obj.data.materials.append(material)

    # Blender Z-up / native front -Y -> glTF Y-up / front +Z.
    for vertex in obj.data.vertices:
        x, y, z = vertex.co
        vertex.co = (x, -z, y)
    obj.data.update()
    obj.data.calc_loop_triangles()
    lo, hi = bounds(obj)
    dimensions = hi - lo
    report = {
        "name": name,
        "vertices": len(obj.data.vertices),
        "triangles": len(obj.data.loop_triangles),
        "dimensions_glTF_xyz": [round(dimensions.x, 4), round(dimensions.z, 4), round(dimensions.y, 4)],
        "position": list(obj.location),
        "rotation": list(obj.rotation_euler),
        "uv_layer": obj.data.uv_layers.active.name,
        "uv_density": "1 UV unit per world unit; dominant-axis projection",
        "construction": "4 front planes, 2 back planes, 4 through-depth outline cuts, 7 rim chips",
        "relief": relief,
    }
    return obj, report


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_preview(objects, path):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 650
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.22, 0.22, 0.22)
    scene.view_settings.view_transform = "AgX"

    # Neutral preview isolates the actual cut silhouette and baked relief.
    preview_material = stone_material("Geometry verification")
    for i, obj in enumerate(objects):
        obj.location = ((i - 1.5) * 1.13, 0, 0)
        obj.rotation_euler[2] = math.radians([-7, 4, -4, 8][i])
        obj.data.materials[0] = preview_material

    camera_data = bpy.data.cameras.new("Preview camera")
    camera = bpy.data.objects.new("Preview camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (1.2, -8, 1.4)
    aim(camera, (0, 0, 0))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 5.4
    scene.camera = camera

    for name, position, power, size in [
        ("Large key", (-3, -4, 4), 450, 3),
        ("Soft fill", (4, -2, 1), 100, 4),
        ("Top rim", (1, 2, 4), 350, 2.5),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = power
        data.shape = "DISK"
        data.size = size
        light = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(light)
        light.location = position
        aim(light, (0, 0, 0))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    options = args()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    font = bpy.data.fonts.load(FONT)
    material = stone_material()
    objects, reports = [], []
    for index, (name, char) in enumerate([("S", "S"), ("O1", "O"), ("O2", "O"), ("N", "N")]):
        obj, report = make_letter(name, char, index, font, material, options.voxel)
        objects.append(obj)
        reports.append(report)
        print("STONE_LETTER", json.dumps(report), flush=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    Path(options.output).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=options.output,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
    )
    report = {"path": options.output, "letters": reports, "total_triangles": sum(r["triangles"] for r in reports)}
    Path("/tmp/soon-stone-model-report.json").write_text(json.dumps(report, indent=2))
    print("STONE_EXPORT", json.dumps(report), flush=True)
    if options.preview:
        render_preview(objects, options.preview)


if __name__ == "__main__":
    main()
