"""
Генератор спрайтов самоцветов для «Сокровищ Солнца».

Запуск (headless):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/gems.py

Опции после `--`:
    --out DIR        куда писать PNG (по умолчанию assets/gems)
    --only N         отрендерить только камень с индексом N
    --preview        один широкий кадр со всеми камнями в ряд
    --samples N      сэмплов Cycles (по умолчанию 128)
    --size N         размер кадра (по умолчанию 512)
"""

import bpy
import bmesh
import math
import os
import re
import sys
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

# ----------------------------------------------------------------------------
# Конфиг
# ----------------------------------------------------------------------------

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None, cast=str):
    if name not in ARGS:
        return default
    i = ARGS.index(name)
    if cast is bool:
        return True
    return cast(ARGS[i + 1])


OUT_DIR = arg("--out", os.path.join(PROJECT, "assets", "gems"))
ONLY = arg("--only", None, int)
PREVIEW = arg("--preview", False, bool)
SAMPLES = arg("--samples", 128, int)
SIZE = arg("--size", 256, int)

# ----------------------------------------------------------------------------
# Исходные данные (синхронизированы с js/art.js)
# ----------------------------------------------------------------------------

SHAPES = {
    "oct": "M32 6 L68 6 L94 32 L94 68 L68 94 L32 94 L6 68 L6 32 Z",
    "sun": "M50 4 L62 20 L82 14 L80 36 L96 50 L80 64 L82 86 L62 80 L50 96 "
           "L38 80 L18 86 L20 64 L4 50 L20 36 L18 14 L38 20 Z",
    "diamond": "M50 4 L66 18 L96 50 L66 82 L50 96 L34 82 L4 50 L34 18 Z",
    "pent": "M50 4 L94 36 L78 92 L22 92 L6 36 Z",
    "rounded": "M24 6 H76 Q94 6 94 24 V76 Q94 94 76 94 H24 Q6 94 6 76 V24 Q6 6 24 6 Z",
    "hex": "M30 6 H70 L94 50 L70 94 H30 L6 50 Z",
}

GEMS = [
    {
        "name": "Рубин", "shape": "oct",
        "body": ["#ffb49c", "#e13a2f", "#760d13"],
        "glyph_color": "#fff1c4",
        "glyph": ["M52 30c15 0 22 11 18 23-4 13-20 16-26 6-5-9 2-18 10-15 7 2 6 10 1 11"],
    },
    {
        "name": "Солнечный камень", "shape": "sun",
        "body": ["#fff4ae", "#efa916", "#955806"],
        "light": "#f8d272",
        "glyph_color": "#5a3200",
        "glyph": [
            "M50 26v8M50 66v8M26 50h8M66 50h8M33 33l6 6M61 61l6 6M67 33l-6 6M39 61l-6 6",
        ],
        "circles": [(50, 50, 9)],
    },
    {
        "name": "Нефрит", "shape": "diamond",
        "body": ["#c6ffab", "#2ea640", "#08561d"],
        "glyph_color": "#f4ffe0",
        "glyph": ["M28 70h44M34 58h32M39 46h22M44 34h12M50 22v6"],
    },
    {
        "name": "Бирюза", "shape": "pent",
        "body": ["#b3f4ff", "#1e7fca", "#083c72"],
        "glyph_color": "#eafaff",
        "glyph": [
            "M25 46c9-12 17-12 25 0s16 12 25 0M25 62c9-12 17-12 25 0s16 12 25 0",
        ],
    },
    {
        "name": "Аметист", "shape": "rounded",
        "body": ["#f0c0ff", "#8c2fc9", "#46106d"],
        "glyph_color": "#ffeaff",
        "glyph": [
            "M50 28c8 10 14 12 22 22-8 10-14 12-22 22-8-10-14-12-22-22 8-10 14-12 22-22Z",
        ],
        "circles": [(50, 50, 4)],
    },
    {
        "name": "Обсидиан", "shape": "hex",
        "body": ["#ffffff", "#b7c1c6", "#626b72"],
        "light": "#dbe4e8", "mid": "#8d979e", "dark": "#394147",
        "glyph_color": "#31404a",
        "glyph": [
            "M50 27c12 0 20 9 20 21 0 14-10 24-20 24S30 62 30 48c0-12 8-21 20-21Z",
            "M40 45h4M56 45h4M44 60c4 3 8 3 12 0",
        ],
    },
]

# ----------------------------------------------------------------------------
# SVG path -> полилинии
# ----------------------------------------------------------------------------

TOKEN_RE = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:[eE][-+]?\d+)?")


def _cubic(p0, p1, p2, p3, n=18):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


def _quad(p0, p1, p2, n=10):
    out = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        out.append((
            u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
            u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
        ))
    return out


def parse_path(d):
    """Возвращает список полилиний [(x, y), ...] в координатах SVG."""
    toks = TOKEN_RE.findall(d)
    i = 0
    cur = (0.0, 0.0)
    start = (0.0, 0.0)
    prev_ctrl = None
    prev_cmd = ""
    cmd = None
    lines = []
    line = [cur]

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            i += 1
            if cmd in "Zz":
                if len(line) > 1:
                    lines.append(line)
                line = [start]
                cur = start
                prev_ctrl = None
                prev_cmd = "Z"
                continue
        rel = cmd.islower()
        c = cmd.upper()

        if c == "M":
            x, y = num(), num()
            if rel:
                x, y = cur[0] + x, cur[1] + y
            if len(line) > 1:
                lines.append(line)
            cur = (x, y)
            start = cur
            line = [cur]
            prev_ctrl = None
            cmd = "l" if rel else "L"
        elif c == "L":
            x, y = num(), num()
            if rel:
                x, y = cur[0] + x, cur[1] + y
            cur = (x, y)
            line.append(cur)
            prev_ctrl = None
        elif c == "H":
            x = num()
            if rel:
                x = cur[0] + x
            cur = (x, cur[1])
            line.append(cur)
            prev_ctrl = None
        elif c == "V":
            y = num()
            if rel:
                y = cur[1] + y
            cur = (cur[0], y)
            line.append(cur)
            prev_ctrl = None
        elif c == "C":
            p1 = (num(), num())
            p2 = (num(), num())
            p3 = (num(), num())
            if rel:
                p1 = (cur[0] + p1[0], cur[1] + p1[1])
                p2 = (cur[0] + p2[0], cur[1] + p2[1])
                p3 = (cur[0] + p3[0], cur[1] + p3[1])
            line.extend(_cubic(cur, p1, p2, p3))
            prev_ctrl = p2
            cur = p3
        elif c == "S":
            p2 = (num(), num())
            p3 = (num(), num())
            if rel:
                p2 = (cur[0] + p2[0], cur[1] + p2[1])
                p3 = (cur[0] + p3[0], cur[1] + p3[1])
            if prev_cmd in ("C", "S") and prev_ctrl:
                p1 = (2 * cur[0] - prev_ctrl[0], 2 * cur[1] - prev_ctrl[1])
            else:
                p1 = cur
            line.extend(_cubic(cur, p1, p2, p3))
            prev_ctrl = p2
            cur = p3
        elif c == "Q":
            p1 = (num(), num())
            p2 = (num(), num())
            if rel:
                p1 = (cur[0] + p1[0], cur[1] + p1[1])
                p2 = (cur[0] + p2[0], cur[1] + p2[1])
            line.extend(_quad(cur, p1, p2))
            prev_ctrl = p1
            cur = p2
        elif c == "T":
            p2 = (num(), num())
            if rel:
                p2 = (cur[0] + p2[0], cur[1] + p2[1])
            if prev_cmd in ("Q", "T") and prev_ctrl:
                p1 = (2 * cur[0] - prev_ctrl[0], 2 * cur[1] - prev_ctrl[1])
            else:
                p1 = cur
            line.extend(_quad(cur, p1, p2))
            prev_ctrl = p1
            cur = p2
        else:
            raise ValueError("Неизвестная команда пути: %r" % cmd)
        prev_cmd = c
        prev_ctrl = prev_ctrl if c in ("C", "S", "Q", "T") else None

    if len(line) > 1:
        lines.append(line)
    return lines


# ----------------------------------------------------------------------------
# Сцена
# ----------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8
    sc.cycles.transmission_bounces = 6
    sc.render.film_transparent = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    sc.render.image_settings.compression = 92
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Khronos PBR Neutral"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    sc.view_settings.gamma = 1.0
    return sc


def make_material(name, base, metallic=0.0, roughness=0.3, transmission=0.0,
                  ior=1.5, coat=0.0, coat_roughness=0.05, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["IOR"].default_value = ior
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    elif "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = transmission
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    if emission:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission[0], 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission[1]
    return mat


def srgb(hex_color):
    h = hex_color.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    # sRGB -> linear
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def gem_material(idx, boost=1.0):
    """Цвет камня — радиальный градиент в объектных координатах (свет сверху-слева),
    как в исходной SVG-графике, плюс физческий блик сверху."""
    gem = GEMS[idx]
    mat = bpy.data.materials.new("gem_%d_%d" % (idx, int(boost * 100)))
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    coord = nodes.new("ShaderNodeTexCoord")
    coord.location = (-1200, 200)

    # расстояние от точки «света» в плоскости камня
    sub = nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (-0.28, 0.30, 0.0)
    sub.location = (-1000, 200)

    length = nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    length.location = (-820, 200)

    mapr = nodes.new("ShaderNodeMapRange")
    mapr.inputs["From Min"].default_value = 0.0
    mapr.inputs["From Max"].default_value = 0.95
    mapr.inputs["To Min"].default_value = 0.0
    mapr.inputs["To Max"].default_value = 1.0
    mapr.location = (-640, 200)

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-460, 200)
    ramp.color_ramp.interpolation = "EASE"

    def col(hex_color):
        r, g, b = srgb(hex_color)
        return (min(1.0, r * boost), min(1.0, g * boost), min(1.0, b * boost), 1.0)

    def mix(h1, h2, t):
        a, b = srgb(h1), srgb(h2)
        return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))

    e0 = ramp.color_ramp.elements[0]
    e1 = ramp.color_ramp.elements[1]
    e0.position = 0.0
    e0.color = col(gem.get("light", gem["body"][0]))
    e1.position = 1.0
    e1.color = (*mix(gem.get("mid", gem["body"][1]), gem.get("dark", gem["body"][2]), 0.62), 1.0)
    mid = ramp.color_ramp.elements.new(0.42)
    mid.color = col(gem.get("mid", gem["body"][1]))

    links.new(coord.outputs["Object"], sub.inputs[0])
    links.new(sub.outputs["Vector"], length.inputs[0])
    links.new(length.outputs["Value"], mapr.inputs["Value"])
    links.new(mapr.outputs["Result"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.19
    bsdf.inputs["IOR"].default_value = 1.72
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = 0.04
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.14
        bsdf.inputs["Coat Roughness"].default_value = 0.10
    return mat


# ----------------------------------------------------------------------------
# Геометрия
# ----------------------------------------------------------------------------

def to_uv(points, scale=1.0):
    """SVG (0..100, y вниз) -> Blender (центр в 0, y вверх), ширина ~1."""
    return [((x - 50.0) / 100.0 * scale, (50.0 - y) / 100.0 * scale) for x, y in points]


def signed_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return a * 0.5


def loft(name, profile, levels, mat, alt_mat=None, alt_mod=2):
    """levels: [(z, scale), ...] снизу вверх. alt_mat красит каждую alt_mod-ю колонку."""
    if signed_area(profile) < 0:
        profile = list(reversed(profile))
    n = len(profile)
    verts = []
    for z, s in levels:
        for x, y in profile:
            verts.append((x * s, y * s, z))
    faces = []
    face_mats = []
    for i in range(len(levels) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n):
            k = (j + 1) % n
            faces.append((a + j, a + k, b + k, b + j))
            face_mats.append(1 if (alt_mat and j % alt_mod == 0) else 0)
    faces.append(tuple(range(n - 1, -1, -1)))
    face_mats.append(0)
    top = (len(levels) - 1) * n
    faces.append(tuple(range(top, top + n)))
    face_mats.append(0)

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
    if alt_mat:
        me.materials.append(alt_mat)
        for i, poly in enumerate(me.polygons):
            poly.material_index = face_mats[i]
    return ob


def add_bevel(ob, width=0.008, segments=1, material=None):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(18)
    if material is not None:
        mod.material = material
    return mod


def ring_loft(name, profile, sections, mat, edge_mat=None):
    """Оправа-обод: sections = [(z, внешний_масштаб, внутренний_масштаб), ...]."""
    if signed_area(profile) < 0:
        profile = list(reversed(profile))
    n = len(profile)
    verts = []
    for z, so, si in sections:
        for x, y in profile:
            verts.append((x * so, y * so, z))
        for x, y in profile:
            verts.append((x * si, y * si, z))

    def o(i, j):
        return i * 2 * n + j % n

    def inner(i, j):
        return i * 2 * n + n + j % n

    faces = []
    for i in range(len(sections) - 1):
        for j in range(n):
            faces.append((o(i, j), o(i, j + 1), o(i + 1, j + 1), o(i + 1, j)))
            faces.append((inner(i, j + 1), inner(i, j), inner(i + 1, j), inner(i + 1, j + 1)))
    last = len(sections) - 1
    for j in range(n):
        faces.append((o(0, j + 1), o(0, j), inner(0, j), inner(0, j + 1)))
        faces.append((o(last, j), o(last, j + 1), inner(last, j + 1), inner(last, j)))

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
    if edge_mat:
        me.materials.append(edge_mat)
    return ob


def bezel_curve(name, profile, z, radius, mat):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    sp.points.add(len(profile) - 1)
    for i, (x, y) in enumerate(profile):
        sp.points[i].co = (x, y, z, 1.0)
    sp.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def glyph_lines(gem):
    """Все штрихи глифа в координатах Blender (без масштаба)."""
    lines = []
    for d in gem["glyph"]:
        for line in parse_path(d):
            lines.append(to_uv(line))
    for cx, cy, r in gem.get("circles", []):
        pts = []
        for i in range(48):
            a = i / 48 * math.tau
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        lines.append(to_uv(pts))
    return lines


def glyph_curve(name, gem, z, radius, mat, fit=0.20):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    cu.resolution_u = 12

    lines = glyph_lines(gem)
    xs = [x for line in lines for x, _ in line]
    ys = [y for line in lines for _, y in line]
    cx = (min(xs) + max(xs)) / 2.0
    cy = (min(ys) + max(ys)) / 2.0
    half = max(max(xs) - min(xs), max(ys) - min(ys)) / 2.0 or 1.0
    s = fit / half

    def add(points):
        sp = cu.splines.new("POLY")
        sp.points.add(len(points) - 1)
        for i, (x, y) in enumerate(points):
            sp.points[i].co = ((x - cx) * s, (y - cy) * s, z, 1.0)

    for line in lines:
        add(line)

    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def build_gem(idx):
    gem = GEMS[idx]
    profile = to_uv(parse_path(SHAPES[gem["shape"]])[0])

    gold = make_material("gold_%d" % idx, srgb("#f3c669"), metallic=0.25, roughness=0.26,
                         coat=0.7, coat_roughness=0.05)
    gold_edge = make_material("gold_edge_%d" % idx, srgb("#ffe6a8"), metallic=0.25,
                              roughness=0.18, coat=0.6,
                              emission=(srgb("#ffe6a8"), 0.25))
    gold_dark = make_material("gold_dark_%d" % idx, srgb("#a26c20"), metallic=0.25, roughness=0.45)
    stone = gem_material(idx)
    stone_alt = gem_material(idx, boost=1.30)
    stone_edge = make_material("edge_%d" % idx, srgb(gem["body"][0]),
                               metallic=0.0, roughness=0.18, coat=0.4,
                               emission=(srgb(gem["body"][0]), 0.18))
    inlay = make_material("inlay_%d" % idx, srgb(gem["glyph_color"]),
                          metallic=0.55, roughness=0.32, coat=0.25,
                          emission=(srgb(gem["glyph_color"]), 0.18))

    objs = []

    # подложка-оправа
    objs.append(loft("plate_%d" % idx, profile, [
        (-0.19, 0.66), (-0.17, 0.84), (-0.06, 0.99), (-0.02, 1.0),
    ], gold_dark))

    # камень: павильон снизу + огранённая корона
    if gem["shape"] in ("sun",):
        # звёздчатые силуэты лучше читаются плоской «плиткой» с фаской
        levels = [
            (-0.10, 0.94), (-0.06, 1.00), (0.10, 1.00), (0.145, 0.94),
        ]
        glyph_z = 0.145
        glyph_fit = 0.25
    else:
        levels = [
            (-0.36, 0.06),
            (-0.22, 0.55),
            (-0.03, 0.92),
            (0.00, 1.00),
            (0.04, 1.00),
            (0.15, 0.93),
            (0.28, 0.76),
            (0.38, 0.54),
            (0.395, 0.48),
        ]
        glyph_z = 0.395
        glyph_fit = 0.16

    stone_ob = loft("stone_%d" % idx, profile, levels, stone,
                    alt_mat=stone_alt, alt_mod=2)
    stone_ob.data.materials.append(stone_edge)
    add_bevel(stone_ob, 0.008, material=2)
    objs.append(stone_ob)

    # золотой ободок по рундисту
    bez_r = 0.032 if gem["shape"] == "sun" else 0.046
    bez = bezel_curve("bezel_%d" % idx, [(x * 1.005, y * 1.005) for x, y in profile],
                      0.020, bez_r, gold)
    objs.append(bez)

    # гравировка-инкрустация на площадке
    objs.append(glyph_curve("glyph_%d" % idx, gem, glyph_z, 0.011, inlay, fit=glyph_fit))

    return objs


# ----------------------------------------------------------------------------
# Свет и камера
# ----------------------------------------------------------------------------

def add_light(name, loc, size, energy, color=(1, 1, 1), target=(0, 0, 0.2)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.size = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def setup_studio():
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.030, 0.032, 0.040, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    bpy.context.scene.world = world

    add_light("key", (-1.6, -1.5, 2.2), 1.10, 140, (1.0, 0.97, 0.92))
    add_light("fill", (2.1, -1.1, 1.0), 2.60, 95, (0.82, 0.91, 1.0))
    add_light("rim", (0.5, 2.2, 1.4), 0.80, 190, (1.0, 0.88, 0.70))


def setup_camera(target=(0, 0, 0.16), ortho=1.24, az_deg=-40, elev_deg=48):
    cd = bpy.data.cameras.new("Camera")
    cd.type = "ORTHO"
    cd.ortho_scale = ortho
    cam = bpy.data.objects.new("Camera", cd)
    bpy.context.collection.objects.link(cam)
    elev = math.radians(elev_deg)
    az = math.radians(az_deg)
    d = 6.0
    loc = (d * math.cos(elev) * math.cos(az),
           d * math.cos(elev) * math.sin(az),
           d * math.sin(elev))
    cam.location = loc
    dv = Vector(target) - Vector(loc)
    cam.rotation_euler = dv.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    bpy.context.view_layer.update()
    return cam


def projected_bbox(objs, cam):
    """Габарит реального силуэта в нормализованных координатах кадра (0..1).

    Считается по вершинам вычисленной геометрии (с модификаторами и bevel
    кривых), а не по углам bounding box — иначе габарит завышается.
    """
    sc = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for ob in objs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            co = world_to_camera_view(sc, cam, mw @ v.co)
            xs.append(co.x)
            ys.append(co.y)
        ev.to_mesh_clear()
    return min(xs), min(ys), max(xs), max(ys)


def silhouette_area(objs, cam, res=80):
    """Доля кадра, занятая силуэтом (по альфа-каналу быстрого рендера)."""
    sc = bpy.context.scene
    keep = (sc.render.resolution_x, sc.render.resolution_y,
            sc.cycles.samples, sc.render.filepath, sc.render.image_settings.file_format)
    path = os.path.join(bpy.app.tempdir or "/tmp", "_silhouette.png")
    try:
        sc.render.resolution_x = res
        sc.render.resolution_y = res
        sc.cycles.samples = 1
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path, check_existing=False)
        px = list(img.pixels)
        n = sum(1 for i in range(3, len(px), 4) if px[i] > 0.5)
        area = n / float(res * res)
        bpy.data.images.remove(img)
        return area
    finally:
        sc.render.resolution_x, sc.render.resolution_y = keep[0], keep[1]
        sc.cycles.samples = keep[2]
        sc.render.filepath = keep[3]
        sc.render.image_settings.file_format = keep[4]


def shift_objs(objs, vec):
    for ob in objs:
        ob.location += vec


def fit_gem(objs, cam, target=0.88, area=0.47, center=(0.5, 0.5),
            max_size=0.94, iters=3):
    """Приводит камни к одному оптическому размеру.

    Сначала габарит подгоняется под target кадра, затем масштаб правится по
    площади силуэта — иначе компактные силуэты (нефрит) выглядят крупнее
    звёздчатых (солнечный камень).
    """
    ortho = cam.data.ortho_scale
    sc = bpy.context.scene
    aspect = sc.render.resolution_x / max(sc.render.resolution_y, 1)
    if aspect >= 1.0:
        frame_w, frame_h = ortho, ortho / aspect
    else:
        frame_w, frame_h = ortho * aspect, ortho
    rot = cam.rotation_euler.to_matrix()
    right = rot @ Vector((1.0, 0.0, 0.0))
    up = rot @ Vector((0.0, 1.0, 0.0))

    def recenter():
        x0, y0, x1, y1 = projected_bbox(objs, cam)
        dx = (center[0] - (x0 + x1) / 2.0) * frame_w
        dy = (center[1] - (y0 + y1) / 2.0) * frame_h
        shift_objs(objs, right * dx + up * dy)
        bpy.context.view_layer.update()

    def scale_by(s):
        for ob in objs:
            ob.location = ob.location * s
            ob.scale = ob.scale * s
        bpy.context.view_layer.update()

    for _ in range(iters):
        x0, y0, x1, y1 = projected_bbox(objs, cam)
        scale_by(target / max(x1 - x0, y1 - y0, 1e-6))
        recenter()

    # выравнивание по площади силуэта
    measured = silhouette_area(objs, cam)
    if measured > 0:
        s = min((area / measured) ** 0.5, max_size / target)
        scale_by(s)
        recenter()


# ----------------------------------------------------------------------------
# Рендер
# ----------------------------------------------------------------------------

def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDERED", path)


def main():
    reset_scene()
    setup_studio()

    if PREVIEW:
        cam = setup_camera(target=(0, 0, 0.10), ortho=6.0, az_deg=-40)
        bpy.context.scene.render.resolution_x = SIZE * 6
        bpy.context.scene.render.resolution_y = SIZE
        rot = cam.rotation_euler.to_matrix()
        right = rot @ Vector((1.0, 0.0, 0.0))
        objs = []
        for i in range(len(GEMS)):
            part = build_gem(i)
            fit_gem(part, cam, target=0.82, center=(0.5, 0.5))
            shift_objs(part, right * (i - 2.5) * 1.0)
            objs += part
        bpy.context.view_layer.update()
        render(os.path.join(OUT_DIR, "_preview_all.png"))
        return

    if ONLY is not None:
        cam = setup_camera()
        objs = build_gem(ONLY)
        fit_gem(objs, cam)
        render(os.path.join(OUT_DIR, "gem-%d.png" % ONLY))
        return

    for i in range(len(GEMS)):
        # чистим объекты предыдущего камня
        for ob in [o for o in bpy.data.objects if o.type in {"MESH", "CURVE"}]:
            bpy.data.objects.remove(ob, do_unlink=True)
        cam = setup_camera()
        objs = build_gem(i)
        fit_gem(objs, cam)
        render(os.path.join(OUT_DIR, "gem-%d.png" % i))


if __name__ == "__main__":
    main()
