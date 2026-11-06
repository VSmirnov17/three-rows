"""
Генератор UI-графики «Сокровищ Солнца»: солнечный медальон.

Запуск (headless):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/ui.py

Опции после `--`:
    --out DIR      куда писать PNG (по умолчанию assets/ui)
    --samples N    сэмплов Cycles (по умолчанию 192)
    --size N       размер кадра (по умолчанию 512)
"""

import bpy
import bmesh
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gems  # noqa: E402  (общие материалы, свет, рендер)

PROJECT = gems.PROJECT
ARGS = gems.ARGS

OUT_DIR = gems.arg("--out", os.path.join(PROJECT, "assets", "ui"))
SAMPLES = gems.arg("--samples", 192, int)
SIZE = gems.arg("--size", 384, int)

# ---------------------------------------------------------------------------
# Палитра
# ---------------------------------------------------------------------------

GOLD = "#f0c877"
GOLD_DARK = "#9a6a1e"
GOLD_LIGHT = "#ffe7a6"
JADE = ("#7ae8b0", "#2aa779", "#0a4a3a")
JADE_DARK = "#0e2a20"


def gradient_material(name, light, mid, dark, roughness=0.22, coat=0.35,
                      metallic=0.0, emission=0.0, span=0.62,
                      offset=(-0.22, 0.0, 0.26)):
    """Радиальный градиент в объектных координатах: свет сверху-слева."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    coord = nodes.new("ShaderNodeTexCoord")
    coord.location = (-1200, 200)
    sub = nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = offset
    sub.location = (-1000, 200)
    length = nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    length.location = (-820, 200)
    mapr = nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = 0.0
    mapr.inputs["From Max"].default_value = span
    mapr.location = (-640, 200)

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-460, 200)
    ramp.color_ramp.interpolation = "EASE"
    e0, e1 = ramp.color_ramp.elements[0], ramp.color_ramp.elements[1]
    e0.position, e0.color = 0.0, (*gems.srgb(light), 1.0)
    e1.position, e1.color = 1.0, (*gems.srgb(dark), 1.0)
    ramp.color_ramp.elements.new(0.44).color = (*gems.srgb(mid), 1.0)

    links.new(coord.outputs["Object"], sub.inputs[0])
    links.new(sub.outputs["Vector"], length.inputs[0])
    links.new(length.outputs["Value"], mapr.inputs["Value"])
    links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["IOR"].default_value = 1.55
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
    if emission:
        if "Emission Color" in bsdf.inputs:
            links.new(ramp.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = emission
    return mat


# ---------------------------------------------------------------------------
# Примитивы в плоскости XZ (медальон смотрит на камеру по -Y)
# ---------------------------------------------------------------------------

def svg_pt(x, y):
    return ((x - 100.0) / 200.0, (100.0 - y) / 200.0)


def smooth(ob, width=0.004, segments=2):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(24)
    return mod


def cylinder(name, radius, depth, y, mat, verts=96):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth,
        location=(0.0, y, 0.0), rotation=(math.pi / 2, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    ob.data.shade_flat()
    return ob


def torus(name, major, minor, y, mat, major_segments=96, minor_segments=12):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=major_segments, minor_segments=minor_segments,
        location=(0.0, y, 0.0), rotation=(math.pi / 2, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


def sphere(name, radius, loc, mat, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


def prism(name, pts, y0, y1, mat):
    """Выдавленный контур: pts — [(x, z), ...] в плоскости XZ."""
    n = len(pts)
    verts = [(x, y0, z) for x, z in pts] + [(x, y1, z) for x, z in pts]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
    faces.append(tuple(range(n - 1, -1, -1)))
    faces.append(tuple(range(n, 2 * n)))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_flat()
    me.materials.append(mat)
    return ob


def curve(name, paths, y, radius, mat):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    cu.resolution_u = 16
    for pts in paths:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for i, (x, z) in enumerate(pts):
            sp.points[i].co = (x, y, z, 1.0)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def circle_pts(cx, cy, r, n=64, scale=1.0):
    out = []
    for i in range(n):
        a = i / n * math.tau
        x, z = svg_pt(cx + math.cos(a) * r, cy + math.sin(a) * r)
        out.append((x * scale, z * scale))
    return out


# ---------------------------------------------------------------------------
# Медальон
# ---------------------------------------------------------------------------

def build_medallion():
    gold = gradient_material("ui_gold", GOLD_LIGHT, GOLD, "#7a4f0e",
                             roughness=0.24, coat=0.5, metallic=0.35)
    gold_dark = gems.make_material("ui_gold_dark", gems.srgb(GOLD_DARK),
                                   metallic=0.3, roughness=0.42)
    jade = gradient_material("ui_jade", JADE[0], JADE[1], JADE[2],
                             roughness=0.18, coat=0.5, span=0.34)
    jade_back = gradient_material("ui_jade_back", "#2c6a52", JADE_DARK, "#061a14",
                                  roughness=0.34, coat=0.25, span=0.52)

    objs = []

    # тёмная подложка
    back = cylinder("back", 0.470, 0.11, 0.055, jade_back, verts=128)
    smooth(back, 0.010, 3)
    objs.append(back)

    # лучи: 20 треугольных призм
    for i in range(20):
        a = math.radians(i * 18)
        ca, sa = math.cos(a), math.sin(a)
        tip = (0.470, 0.0)
        b1 = (0.352, 0.040)
        b2 = (0.352, -0.040)
        pts = []
        for r, w in (tip, b1, b2):
            pts.append((r * ca - w * sa, r * sa + w * ca))
        ray = prism("ray_%d" % i, pts, -0.028, 0.030, gold)
        smooth(ray, 0.005, 2)
        objs.append(ray)

    # внешний золотой обод
    objs.append(torus("ring_outer", 0.360, 0.022, -0.020, gold))

    # тонкое кольцо по краю
    objs.append(torus("ring_edge", 0.392, 0.006, -0.030, gold, 128, 8))

    # 24 заклёпки
    for i in range(24):
        a = (i / 24) * math.tau
        x, z = svg_pt(100 + math.cos(a) * 66, 100 + math.sin(a) * 66)
        objs.append(sphere("stud_%d" % i, 0.0135, (x, -0.032, z), gold))

    # нефритовая шайба
    disc = cylinder("jade_disc", 0.265, 0.10, -0.030, jade, verts=128)
    smooth(disc, 0.012, 3)
    objs.append(disc)

    # внутреннее кольцо
    objs.append(torus("ring_inner", 0.210, 0.0075, -0.078, gold, 128, 8))

    # лик: глаза
    for sx in (87, 113):
        x, z = svg_pt(sx, 92)
        eye = sphere("eye_%d" % sx, 0.028, (x, -0.086, z), gold, 24, 14)
        eye.scale = (1.0, 0.55, 1.0)
        objs.append(eye)

    # улыбка — квадратичная кривая, как в SVG
    smile_pts = [svg_pt(*p) for p in
                 gems._quad((82.0, 112.0), (100.0, 130.0), (118.0, 112.0), 26)]
    smile = curve("smile", [smile_pts], -0.084, 0.0115, gold)
    objs.append(smile)

    # нос-ромб
    nose = prism("nose", [
        svg_pt(100, 62), svg_pt(106, 71), svg_pt(100, 80), svg_pt(94, 71),
    ], -0.090, -0.070, gold)
    smooth(nose, 0.003, 2)
    objs.append(nose)

    # боковые ромбы
    for cx in (59, 159):
        pts = [svg_pt(cx, 94), svg_pt(cx + 9, 100), svg_pt(cx, 106), svg_pt(cx - 9, 100)]
        side = prism("side_%d" % cx, pts, -0.090, -0.070, gold)
        smooth(side, 0.003, 2)
        objs.append(side)

    return objs


def setup_camera(ortho=1.02):
    cd = bpy.data.cameras.new("Camera")
    cd.type = "ORTHO"
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("Camera", cd)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -6.0, 0.0)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def setup_lights():
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.035, 0.037, 0.045, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    gems.add_light("key", (-1.6, -2.4, 1.9), 1.6, 300, (1.0, 0.96, 0.89))
    gems.add_light("fill", (2.2, -2.0, 0.4), 2.2, 95, (0.82, 0.91, 1.0))
    gems.add_light("rim", (0.6, 2.4, 1.2), 1.4, 220, (1.0, 0.88, 0.70))
    gems.add_light("top", (0.0, -1.0, 2.8), 1.6, 90, (1.0, 1.0, 1.0))


def main():
    sc = gems.reset_scene()
    sc.cycles.samples = SAMPLES
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    setup_lights()
    setup_camera()
    build_medallion()
    gems.render(os.path.join(OUT_DIR, "sun-emblem.png"))


if __name__ == "__main__":
    main()
