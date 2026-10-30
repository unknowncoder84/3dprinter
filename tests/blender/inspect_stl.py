"""
Independent check of exported STL files using Blender's own importer and mesh kernel (bmesh).

    blender --background --python tests/blender/inspect_stl.py -- <out.json> <render-dir> file1.stl file2.stl ...

For every file it reports: triangle count, bounding box (mm), volume, number of open
(boundary) edges, non-manifold edges, loose vertices/edges, and connected pieces after
merging coincident vertices. It also renders a front view so the result can be inspected by eye.
"""
import sys, json, os, math
import bpy, bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
out_json, render_dir, files = argv[0], argv[1], argv[2:]
os.makedirs(render_dir, exist_ok=True)


def import_stl(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if hasattr(bpy.ops.wm, "stl_import"):
        bpy.ops.wm.stl_import(filepath=path)
    else:  # older Blender
        bpy.ops.import_mesh.stl(filepath=path)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"][0]


def analyse(path):
    obj = import_stl(path)
    mesh = obj.data
    tris_raw = len(mesh.polygons)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)  # weld coincident vertices
    bm.edges.ensure_lookup_table()

    boundary = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    nonmanifold = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    loose_edges = sum(1 for e in bm.edges if len(e.link_faces) == 0)
    loose_verts = sum(1 for v in bm.verts if len(v.link_edges) == 0)
    # inconsistent winding: two faces sharing an edge must traverse it in opposite directions
    bad_winding = 0
    for e in bm.edges:
        if len(e.link_faces) == 2:
            f1, f2 = e.link_faces
            if f1.normal.dot(f2.normal) < -0.999999 and False:
                pass
            if not e.is_contiguous:
                bad_winding += 1
    volume = bm.calc_volume(signed=True)

    # connected pieces
    seen, pieces = set(), 0
    for f in bm.faces:
        if f.index in seen:
            continue
        pieces += 1
        stack = [f]
        seen.add(f.index)
        while stack:
            cur = stack.pop()
            for e in cur.edges:
                for g in e.link_faces:
                    if g.index not in seen:
                        seen.add(g.index)
                        stack.append(g)

    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    res = {
        "file": os.path.basename(path),
        "triangles": tris_raw,
        "size_mm": [round(max(xs) - min(xs), 4), round(max(ys) - min(ys), 4), round(max(zs) - min(zs), 4)],
        "min": [round(min(xs), 4), round(min(ys), 4), round(min(zs), 4)],
        "volume_mm3": round(volume, 3),
        "open_edges": boundary,
        "non_manifold_edges": nonmanifold,
        "loose_edges": loose_edges,
        "loose_vertices": loose_verts,
        "inconsistent_winding_edges": bad_winding,
        "pieces": pieces,
    }
    bm.free()

    # render a front view
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 700, 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.92, 0.95, 1)
    scene.world = world
    mat = bpy.data.materials.new("m")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.64, 0.68, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = False
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 112
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    # the card lies in the XY plane with its front face towards +Z: look down on it, slightly tilted
    cam.location = (0, -38, 190)
    cam.rotation_euler = (math.radians(11), 0, 0)
    scene.camera = cam
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.2
    sun.angle = math.radians(2)
    sun_o = bpy.data.objects.new("sun", sun)
    # low-angle light from the upper left so the raised details cast visible shadows
    sun_o.rotation_euler = (math.radians(62), math.radians(0), math.radians(-48))
    scene.collection.objects.link(sun_o)
    scene.render.filepath = os.path.join(render_dir, os.path.splitext(os.path.basename(path))[0] + ".png")
    bpy.ops.render.render(write_still=True)
    return res


results = []
for f in files:
    try:
        results.append(analyse(f))
    except Exception as ex:  # report, do not crash
        results.append({"file": os.path.basename(f), "error": str(ex)})

with open(out_json, "w") as fh:
    json.dump(results, fh, indent=2)
print("BLENDER_INSPECT_DONE", len(results))
