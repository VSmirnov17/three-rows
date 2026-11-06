"""
Генератор крупной графики «Сокровищ Солнца»: шаман-идол и листья.

Запуск (headless):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/art.py

Опции после `--`:
    --part NAME    shaman | leaf | all (по умолчанию all)
    --out DIR      куда писать PNG (по умолчанию assets/art)
    --samples N    сэмплов Cycles (по умолчанию 160)
"""

import bpy
import bmesh
import math
import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gems  # noqa: E402
import ui  # noqa: E402  (gradient_material)

PROJECT = gems.PROJECT
OUT_DIR = gems.arg("--out", os.path.join(PROJECT, "assets", "art"))
SAMPLES = gems.arg("--samples", 160, int)
PART = gems.arg("--part", "all")

gradient_material = ui.gradient_material


# ---------------------------------------------------------------------------
# Геометрия: SVG-координаты -> мир (фронтальный рельеф, камера смотрит по +Y)
# ---------------------------------------------------------------------------

class Frame:
    def __init__(self, cx, cy, unit):
        self.cx, self.cy, self.unit = cx, cy, unit

    def pt(self, x, y):
        return ((x - self.cx) / self.unit, (self.cy - y) / self.unit)

    def poly(self, pts):
        return [self.pt(x, y) for x, y in pts]


def prism(name, pts, y0, y1, mat):
    n = len(pts)
    if n < 3:
        return None
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


def shape(name, d, frame, y0, y1, mat, bevel=0.003):
    """Заливка SVG-контура: все замкнутые полилинии выдавливаются."""
    out = []
    for i, line in enumerate(gems.parse_path(d)):
        pts = frame.poly(line)
        if len(pts) > 2 and abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6:
            pts = pts[:-1]
        ob = prism("%s_%d" % (name, i), pts, y0, y1, mat)
        if ob:
            if bevel:
                smooth(ob, bevel)
            out.append(ob)
    return out


def stroke(name, d, frame, y, radius, mat):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    cu.resolution_u = 14
    for line in gems.parse_path(d):
        sp = cu.splines.new("POLY")
        sp.points.add(len(line) - 1)
        for i, (x, yy) in enumerate(line):
            wx, wz = frame.pt(x, yy)
            sp.points[i].co = (wx, y, wz, 1.0)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def smooth(ob, width=0.004, segments=2):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(24)
    return mod


def sphere(name, radius, loc, mat, scale=(1, 1, 1), segments=24, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = scale
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


def cylinder(name, radius, depth, loc, mat, verts=64):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth,
        location=loc, rotation=(math.pi / 2, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    ob.data.shade_flat()
    return ob


def torus(name, major, minor, loc, mat, segs=72, minor_segs=10):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=segs, minor_segments=minor_segs,
        location=loc, rotation=(math.pi / 2, 0, 0))
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


# ---------------------------------------------------------------------------
# Сцена
# ---------------------------------------------------------------------------

def setup_scene(size_x, size_y, ortho, samples):
    sc = gems.reset_scene()
    sc.cycles.samples = samples
    sc.render.resolution_x = size_x
    sc.render.resolution_y = size_y
    sc.render.image_settings.compression = 92

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.035, 0.037, 0.045, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world

    gems.add_light("key", (-1.5, -2.4, 1.9), 1.4, 300, (1.0, 0.96, 0.89))
    gems.add_light("fill", (2.1, -2.0, 0.5), 2.0, 110, (0.82, 0.91, 1.0))
    gems.add_light("rim", (0.5, 2.4, 1.3), 1.2, 260, (1.0, 0.88, 0.70))

    cd = bpy.data.cameras.new("Camera")
    cd.type = "ORTHO"
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("Camera", cd)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -6.0, 0.0)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    sc.camera = cam
    bpy.context.view_layer.update()
    return cam


def z_material(name, low, mid, high, z0, z1, roughness=0.3, coat=0.3):
    """Вертикальный градиент по объектной Z: низ -> верх."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    mapr = nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = z0
    mapr.inputs["From Max"].default_value = z1
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    e0, e1 = ramp.color_ramp.elements[0], ramp.color_ramp.elements[1]
    e0.position, e0.color = 0.0, (*gems.srgb(low), 1.0)
    e1.position, e1.color = 1.0, (*gems.srgb(high), 1.0)
    ramp.color_ramp.elements.new(0.5).color = (*gems.srgb(mid), 1.0)

    links.new(coord.outputs["Object"], sep.inputs["Vector"])
    links.new(sep.outputs["Z"], mapr.inputs["Value"])
    links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    bsdf.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    return mat


def glow_material(name, inner, outer, radius, strength=2.2):
    """Мягкое свечение: плоский диск с радиальной прозрачностью."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")

    coord = nodes.new("ShaderNodeTexCoord")
    ln = nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    mapr = nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = 0.0
    mapr.inputs["From Max"].default_value = radius

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    e0, e1 = ramp.color_ramp.elements
    e0.position, e0.color = 0.0, (*gems.srgb(inner), 1.0)
    e1.position, e1.color = 1.0, (*gems.srgb(outer), 1.0)

    alpha = nodes.new("ShaderNodeValToRGB")
    alpha.color_ramp.interpolation = "EASE"
    a0, a1 = alpha.color_ramp.elements
    a0.position, a0.color = 0.0, (1, 1, 1, 1)
    a1.position, a1.color = 1.0, (0, 0, 0, 1)
    alpha.color_ramp.elements.new(0.18).color = (1, 1, 1, 1)

    em = nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    tr = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")

    links.new(coord.outputs["Object"], ln.inputs[0])
    links.new(ln.outputs["Value"], mapr.inputs["Value"])
    links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    links.new(mapr.outputs["Result"], alpha.inputs["Fac"])
    links.new(ramp.outputs["Color"], em.inputs["Color"])
    links.new(alpha.outputs["Color"], mix.inputs["Fac"])
    links.new(tr.outputs[0], mix.inputs[1])
    links.new(em.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs["Surface"])
    return mat


def flat_disc(name, radius, loc, mat, n=72):
    verts = [(math.cos(i / n * math.tau) * radius, 0.0,
              math.sin(i / n * math.tau) * radius) for i in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [tuple(range(n))])
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    me.materials.append(mat)
    return ob


def materials():
    return {
        "jade": gradient_material("sh_jade", "#3fc48c", "#12855f", "#04372a",
                                  roughness=0.18, coat=0.5, span=0.22,
                                  offset=(-0.05, 0.0, 0.06)),
        "jade_arm": z_material("sh_jade_arm", "#0a3a2a", "#1c7a55", "#4cc48c",
                               -0.42, -0.18, roughness=0.24, coat=0.35),
        "gold": gradient_material("sh_gold", "#ffeaa8", "#e0b45a", "#6a420a",
                                  roughness=0.22, coat=0.5, metallic=0.4, span=0.55),
        "feather": z_material("sh_feather", "#052a1b", "#156b40", "#4fbb6f",
                              -0.05, 0.55, roughness=0.32, coat=0.28),
        "stone": gradient_material("sh_stone", "#7a8370", "#4e5748", "#2c352b",
                                   roughness=0.55, span=0.55),
        "spirit": gradient_material("sh_spirit", "#d9a4ff", "#8b3fd0", "#4a1478",
                                    roughness=0.2, coat=0.5, span=0.4,
                                    offset=(-0.03, 0.0, 0.04)),
        "orb": gradient_material("sh_orb", "#f0a11a", "#c25a00", "#5e1e00",
                                 roughness=0.4, coat=0.08, emission=0.2, span=0.22,
                                 offset=(-0.02, 0.0, 0.03)),
        "dark": gradient_material("sh_dark", "#123d2c", "#071f16", "#03100a",
                                  roughness=0.55, span=0.6),
        "eye": gems.make_material("sh_eye", gems.srgb("#ffe08a"), roughness=0.28),
        "pupil": gems.make_material("sh_pupil", gems.srgb("#241505"), roughness=0.35),
        "mouth": gems.make_material("sh_mouth", gems.srgb("#5e1a12"), roughness=0.35,
                                    coat=0.4),
    }


# ---------------------------------------------------------------------------
# Шаман
# ---------------------------------------------------------------------------

def dome(name, center, rx, ry, rz, mat, taper=0.28, segments=48, rings=28):
    """Яйцевидная голова: сфера, суженная книзу."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=1.0, location=center)
    ob = bpy.context.object
    ob.name = name
    for v in ob.data.vertices:
        t = (v.co.z + 1.0) * 0.5
        s = 1.0 - taper * (1.0 - t) ** 2
        v.co.x *= rx * s
        v.co.y *= ry
        v.co.z *= rz
    ob.data.shade_smooth()
    ob.data.materials.append(mat)
    return ob


def poly_curve(name, pts, radius, mat):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, (x, y, z) in enumerate(pts):
        sp.points[i].co = (x, y, z, 1.0)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def strip(name, f, base_xy, angle_deg, length, width, y0, mat,
          bulge=0.022, thick=0.006, n=24):
    """Изогнутая полоса-лист: профиль шириной sin, выгиб к камере."""
    a = math.radians(angle_deg)
    dx, dz = math.sin(a), math.cos(a)
    bx, bz = f.pt(*base_xy)

    verts = []
    for k in range(n + 1):
        t = k / n
        w = width * (math.sin(math.pi * t) ** 0.5)
        y = y0 + bulge * math.sin(math.pi * t)
        cx, cz = bx + dx * length * t, bz + dz * length * t
        px, pz = dz, -dx
        verts.append((cx - px * w * 0.5, y, cz - pz * w * 0.5))
        verts.append((cx + px * w * 0.5, y, cz + pz * w * 0.5))

    faces = [(2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2) for k in range(n)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    mod = ob.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thick
    mod.offset = 0.0
    return ob


def feather(name, f, base_xy, angle_deg, length, width, y0, mat, rib_mat, tip_mat):
    """Изогнутое перо: полоса с жилкой и золотым ромбом."""
    a = math.radians(angle_deg)
    dx, dz = math.sin(a), math.cos(a)
    bx, bz = f.pt(*base_xy)

    objs = [strip(name, f, base_xy, angle_deg, length, width, y0, mat)]

    rib = []
    for k in range(13):
        t = k / 12
        rib.append((bx + dx * length * t,
                    y0 - 0.004 + 0.022 * math.sin(math.pi * t),
                    bz + dz * length * t))
    objs.append(poly_curve(name + "_rib", rib, 0.0017, rib_mat))

    t = 0.90
    cx, cz = bx + dx * length * t, bz + dz * length * t
    px, pz = dz, -dx
    yt = y0 + 0.022 * math.sin(math.pi * t)
    pts = [(cx + dx * 0.016, cz + dz * 0.016),
           (cx + px * 0.007, cz + pz * 0.007),
           (cx - dx * 0.016, cz - dz * 0.016),
           (cx - px * 0.007, cz - pz * 0.007)]
    tip = prism(name + "_tip", pts, yt - 0.012, yt - 0.003, tip_mat)
    smooth(tip, 0.0025)
    objs.append(tip)
    return objs


def build_shaman():
    f = Frame(120.0, 160.0, 240.0)
    m = materials()
    objs = []

    # --- тёмная подложка-реликварий -------------------------------------
    disc = cylinder("sh_back", 0.4667, 0.06, (0, 0.115, 0.0167), m["dark"], verts=128)
    smooth(disc, 0.014, 4)
    objs.append(disc)
    objs.append(torus("sh_back_ring", 0.4667, 0.0050, (0, 0.080, 0.0167),
                      m["gold"], 128, 10))
    objs.append(torus("sh_back_ring2", 0.4290, 0.0022, (0, 0.077, 0.0167),
                      m["gold"], 128, 8))
    for i in range(24):
        a = (i / 24) * math.tau
        objs.append(sphere("sh_stud_%d" % i, 0.0072,
                           (math.cos(a) * 0.406, 0.075, 0.0167 + math.sin(a) * 0.406),
                           m["gold"], segments=16, rings=8))

    # --- перья ----------------------------------------------------------
    for i in range(-4, 5):
        objs += feather("sh_feather_%d" % i, f, (120, 158), i * 15.0,
                        (120 - abs(i) * 7) / 240.0, 20.0 / 240.0,
                        0.052 + 0.0025 * abs(i),
                        m["feather"], m["dark"], m["gold"])

    # --- голова ---------------------------------------------------------
    head = shape("sh_head", "M92 142 Q120 129 148 142 L149 186 Q120 213 91 186Z",
                 f, -0.020, -0.052, m["jade"], 0.019)
    for ob in head:
        for mod in ob.modifiers:
            if mod.type == "BEVEL":
                mod.segments = 4
    objs += head
    objs.append(stroke("sh_head_line",
                       "M92 142 Q120 129 148 142 L149 186 Q120 213 91 186Z",
                       f, -0.056, 0.0032, m["gold"]))

    # лобная повязка
    objs += shape("sh_brow", "M82 130 Q120 112 158 130 L154 146 Q120 128 86 146Z",
                  f, -0.030, -0.070, m["gold"], 0.005)
    objs.append(stroke("sh_brow_edge", "M86 146 Q120 128 154 146", f, -0.073, 0.0035,
                       m["dark"]))
    bx, bz = f.pt(120, 128)
    objs.append(sphere("sh_brow_gem", 0.019, (bx, -0.075, bz), m["gold"],
                       scale=(1, 0.55, 1.25)))

    # глаза как у медальона: круглые золотые
    for x in (109, 131):
        wx, wz = f.pt(x, 160)
        ring = sphere("sh_socket_%d" % x, 0.0290, (wx, -0.058, wz), m["dark"],
                      segments=24, rings=14)
        ring.scale = (1.0, 0.35, 1.05)
        objs.append(ring)
        eye = sphere("sh_eye_%d" % x, 0.0248, (wx, -0.064, wz), m["eye"],
                     segments=28, rings=16)
        eye.scale = (1.0, 0.55, 1.05)
        objs.append(eye)
        pupil = sphere("sh_pupil_%d" % x, 0.0095, (wx, -0.082, wz), m["pupil"],
                       segments=20, rings=12)
        pupil.scale = (1.0, 0.5, 1.0)
        objs.append(pupil)
        objs.append(sphere("sh_glint_%d" % x, 0.0034,
                           (wx - 0.005, -0.087, wz + 0.007), m["eye"],
                           segments=10, rings=6))

    # нос и рот
    nose = prism("sh_nose", [f.pt(120, 168), f.pt(114, 179), f.pt(120, 183),
                             f.pt(126, 179)], -0.068, -0.081, m["dark"])
    smooth(nose, 0.003)
    objs.append(nose)
    objs += shape("sh_mouth", "M104 184 Q120 201 136 184 Q120 190 104 184Z",
                  f, -0.060, -0.070, m["mouth"], 0.002)
    lx, lz = f.pt(120, 197)
    objs.append(sphere("sh_labret", 0.0085, (lx, -0.058, lz), m["gold"],
                       scale=(1, 0.7, 1)))

    # уши-диски
    for x in (86, 154):
        wx, wz = f.pt(x, 174)
        objs.append(cylinder("sh_ear_%d" % x, 0.0375, 0.030, (wx, -0.052, wz),
                             m["gold"], 48))
        objs.append(cylinder("sh_ear_in_%d" % x, 0.0170, 0.012, (wx, -0.068, wz),
                             m["jade_arm"], 32))

    # ожерелье
    objs.append(stroke("sh_neck", "M96 206 Q120 220 144 206", f, -0.060, 0.013,
                       m["gold"]))
    objs.append(sphere("sh_bead", 0.018, (*f.pt(120, 217), -0.072), m["gold"],
                       scale=(1, 0.7, 1)))

    # руки
    objs.append(stroke("sh_arm_l", "M97 210 Q74 224 78 250", f, -0.020, 0.033,
                       m["jade_arm"]))
    objs.append(stroke("sh_arm_r", "M143 210 Q166 224 162 250", f, -0.020, 0.033,
                       m["jade_arm"]))
    for x, y in ((78, 252), (162, 252)):
        wx, wz = f.pt(x, y)
        objs.append(sphere("sh_hand_%d" % x, 0.042, (wx, -0.036, wz), m["gold"],
                           scale=(1, 0.78, 1)))

    # солнечный шар
    ox, oz = f.pt(120, 248)
    objs.append(sphere("sh_orb", 0.1125, (ox, -0.050, oz), m["orb"],
                       segments=40, rings=24))
    objs.append(flat_disc("sh_orb_glow", 0.170, (ox, -0.030, oz),
                          glow_material("sh_glow", "#ffe9a8", "#ff8a1e", 0.170,
                                        strength=0.7)))
    objs.append(torus("sh_orb_ring", 0.0865, 0.0058, (ox, -0.166, oz),
                      m["gold"], 96, 10))
    objs.append(torus("sh_orb_ring2", 0.0740, 0.0022, (ox, -0.172, oz),
                      m["gold"], 96, 8))
    for i in range(12):
        a = (i / 12) * math.tau + math.pi / 12
        objs.append(sphere("sh_orb_stud_%d" % i, 0.0072,
                           (ox + math.cos(a) * 0.0995, -0.160,
                            oz + math.sin(a) * 0.0995),
                           m["gold"], segments=16, rings=8))

    # каменное основание
    objs += shape("sh_base", "M40 280 Q120 261 200 280 L192 306 Q120 320 48 306Z",
                  f, -0.005, 0.045, m["stone"], 0.010)
    objs.append(stroke("sh_base_line", "M62 294h24M118 292h30M166 296h18",
                       f, -0.014, 0.003, m["gold"]))

    # дух-хранитель
    sx, sz = f.pt(48, 240)
    objs.append(sphere("sh_spirit", 0.080, (sx, -0.030, sz), m["spirit"],
                       scale=(1.05, 0.62, 0.92)))
    for dx in (-0.055, 0.055):
        horn = [(sx + dx * 0.30, sz + 0.030), (sx + dx, sz + 0.125),
                (sx + dx * 1.30, sz + 0.005)]
        ob = prism("sh_horn_%.2f" % dx, horn, -0.030, 0.004, m["spirit"])
        smooth(ob, 0.003)
        objs.append(ob)
    for dx in (-0.027, 0.027):
        objs.append(sphere("sh_spirit_eye_%.2f" % dx, 0.0135,
                           (sx + dx, -0.082, sz + 0.018), m["eye"],
                           segments=16, rings=10))
    objs.append(poly_curve("sh_spirit_mouth",
                           [(sx - 0.022, -0.082, sz - 0.022),
                            (sx, -0.084, sz - 0.030),
                            (sx + 0.022, -0.082, sz - 0.022)],
                           0.004, m["pupil"]))

    return objs


# ---------------------------------------------------------------------------
# Лист
# ---------------------------------------------------------------------------

def build_leaf():
    f = Frame(60.0, 100.0, 240.0)
    leaf = gradient_material("lf_body", "#1c5a38", "#0f3a24", "#061a10",
                             roughness=0.45, coat=0.2, span=0.55)
    vein = gems.make_material("lf_vein", gems.srgb("#071e13"), roughness=0.5)

    objs = []
    for ob in shape("lf_body", "M60 3C98 58 114 122 60 197 6 122 22 58 60 3Z",
                    f, -0.03, 0.03, leaf, 0.012):
        objs.append(ob)

    for d, r in (
        ("M60 20v166", 0.0035),
        ("M60 54C82 76 88 102 60 128", 0.0025),
        ("M60 96C38 76 32 50 60 26", 0.0025),
        ("M60 130C80 148 86 166 62 182", 0.0022),
    ):
        objs.append(stroke("lf_vein", d, f, -0.032, r, vein))
    return objs


# ---------------------------------------------------------------------------
# Фон: пирамиды и джунгли
# ---------------------------------------------------------------------------

def box(name, dims, loc, mat, rot_z=0.0, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = dims
    ob.rotation_euler = (0.0, 0.0, rot_z)
    ob.data.materials.append(mat)
    if bevel:
        smooth(ob, bevel)
    return ob


def ziggurat(name, cx, base_z, base_w, height, tiers, mat, rot_deg=24.0):
    objs = []
    a = math.radians(rot_deg)
    tier_h = height / tiers
    for i in range(tiers):
        t = i / max(tiers - 1, 1)
        w = base_w * (1.0 - 0.70 * t)
        z = base_z + tier_h * (i + 0.5)
        objs.append(box("%s_%d" % (name, i), (w, w, tier_h * 1.15),
                        (cx, 0.0, z), mat, a, bevel=0.004))
    return objs


def bush(name, f, center_xy, count, length, mat, y=0.0, spread=86.0, width=0.05):
    objs = []
    for i in range(count):
        a = -spread * 0.5 + spread * i / max(count - 1, 1)
        ln = length * (0.70 + 0.30 * math.cos(math.radians(a)))
        objs.append(strip("%s_%d" % (name, i), f, center_xy, a, ln, width,
                          y, mat, bulge=0.035, thick=0.004, n=14))
    return objs


def vine(name, f, top_xy, length, sway, mat, leaf_mat, leaves=7, y=-0.02):
    bx, bz = f.pt(*top_xy)
    pts = []
    for k in range(17):
        t = k / 16
        pts.append((bx + sway * math.sin(t * math.pi * 1.25), y, bz - length * t))
    objs = [poly_curve(name, pts, 0.0032, mat)]
    for k in range(leaves):
        t = 0.18 + 0.78 * k / max(leaves - 1, 1)
        x = bx + sway * math.sin(t * math.pi * 1.25)
        z = bz - length * t
        side = 1 if k % 2 else -1
        ang = 90 + side * (58 + 8 * math.sin(k))
        objs.append(strip("%s_l%d" % (name, k),
                          f, (800 + x * 1000, 500 - z * 1000), ang,
                          0.055 + 0.02 * math.sin(k * 1.7), 0.032, y - 0.006,
                          leaf_mat, bulge=0.008, thick=0.003, n=8))
    return objs


def build_background():
    f = Frame(800.0, 500.0, 1000.0)
    stone = gradient_material("bg_stone", "#3a4a3a", "#1f2b22", "#0a110c",
                              roughness=0.9, coat=0.0, span=1.2,
                              offset=(-0.25, 0.0, 0.25))
    dark = gradient_material("bg_dark", "#1a2a1e", "#0c1811", "#040a06",
                             roughness=0.8, span=0.9)
    leaf = z_material("bg_leaf", "#020c07", "#061a10", "#0f3320",
                      -0.55, 0.12, roughness=0.88, coat=0.0)

    objs = []

    objs += ziggurat("bg_pyr_l", -0.60, -0.52, 0.58, 0.54, 7, stone, 27)
    objs += ziggurat("bg_pyr_r", 0.64, -0.52, 0.50, 0.46, 6, stone, -23)
    objs += ziggurat("bg_pyr_c", 0.02, -0.52, 0.36, 0.24, 4, stone, 13)

    # храм на центральной пирамиде
    objs.append(box("bg_temple", (0.12, 0.12, 0.10), (0.02, 0.0, -0.250),
                    stone, 0.23, bevel=0.003))
    objs.append(box("bg_door", (0.044, 0.020, 0.058), (0.02, -0.120, -0.264),
                    dark, 0.23))

    # листва у оснований
    for i, (x, y, n, ln) in enumerate((
        (40, 980, 7, 0.20), (230, 990, 6, 0.15),
        (600, 985, 7, 0.17), (780, 975, 6, 0.20),
        (960, 995, 7, 0.16), (1180, 985, 6, 0.19),
        (1380, 990, 7, 0.17), (1540, 975, 6, 0.21),
    )):
        objs += bush("bg_bush_%d" % i, f, (x, y), n, ln, leaf, y=-0.30)

    # лианы в верхних углах
    objs += vine("bg_vine_a", f, (60, -20), 0.34, 0.05, leaf, leaf, 7, y=-0.02)
    objs += vine("bg_vine_b", f, (250, -40), 0.22, -0.04, leaf, leaf, 5, y=-0.02)
    objs += vine("bg_vine_c", f, (1400, -30), 0.28, -0.05, leaf, leaf, 6, y=-0.02)
    objs += vine("bg_vine_d", f, (1570, -10), 0.36, 0.04, leaf, leaf, 7, y=-0.02)

    return objs


# ---------------------------------------------------------------------------
# Рендер
# ---------------------------------------------------------------------------

def render_shaman():
    setup_scene(400, 533, ortho=1.45, samples=SAMPLES)
    build_shaman()
    gems.render(os.path.join(OUT_DIR, "shaman.png"))


def render_background():
    setup_scene(1000, 625, ortho=1.7, samples=SAMPLES)
    sc = bpy.context.scene
    for name in ("key", "fill", "rim"):
        ob = bpy.data.objects.get(name)
        if ob:
            bpy.data.objects.remove(ob, do_unlink=True)

    old = sc.camera
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    cd = bpy.data.cameras.new("BGCam")
    cd.type = "ORTHO"
    cd.ortho_scale = 1.7
    cam = bpy.data.objects.new("BGCam", cd)
    bpy.context.collection.objects.link(cam)
    cam.location = (1.15, -6.0, 0.85)
    d = Vector((0.0, 0.0, -0.10)) - Vector(cam.location)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    bpy.context.view_layer.update()

    gems.add_light("sun", (1.8, -1.6, -0.05), 1.8, 55, (1.0, 0.82, 0.58),
                   target=(-0.2, 0.0, -0.22))
    gems.add_light("cool", (-1.6, -1.8, 0.0), 2.2, 26, (0.52, 0.74, 1.0))
    gems.add_light("rim", (0.2, 2.0, 0.1), 1.6, 120, (1.0, 0.84, 0.60))
    build_background()
    gems.render(os.path.join(OUT_DIR, "jungle.png"))


def render_leaf():
    setup_scene(240, 400, ortho=0.92, samples=SAMPLES)
    build_leaf()
    gems.render(os.path.join(OUT_DIR, "leaf.png"))


def main():
    if PART in ("shaman", "all"):
        render_shaman()
    if PART in ("leaf", "all"):
        render_leaf()
    if PART in ("background", "all"):
        render_background()


if __name__ == "__main__":
    main()
