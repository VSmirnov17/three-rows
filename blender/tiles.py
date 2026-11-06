"""
Камни-плитки «Сокровищ Солнца»: эмалевые таблички в золотой оправе.

Каждый из шести камней — толстая плитка со своим силуэтом: тёмная подложка
даёт контур, золотая рамка с фаской и заклёпками держит выпуклую эмаль,
на эмали — рельефный глиф, а в центре — кабошон-«глаз» с мягким свечением.
Силуэты подобраны так, чтобы камни различались даже в оттенках серого.

Запуск (headless):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/tiles.py

Опции после `--`:
    --only N       отрендерить только камень с индексом N
    --preview      один широкий кадр со всеми камнями (assets/gems/_preview_all.png)
    --samples N    сэмплов Cycles (по умолчанию 128)
    --size N       сторона кадра в пикселях (по умолчанию 256)
    --out DIR      куда писать PNG (по умолчанию assets/gems)

Старый набор (огранённые камни из blender/gems.py) лежит в assets/gems/classic/.
"""

import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

_ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(name, default=None, cast=str):
    if name not in _ARGS:
        return default
    if cast is bool:
        return True
    return cast(_ARGS[_ARGS.index(name) + 1])


ONLY = _arg("--only", None, int)
PREVIEW = _arg("--preview", False, bool)
SAMPLES = _arg("--samples", 128, int)
SIZE = _arg("--size", 256, int)

# gems.py разбирает свои опции при импорте, поэтому прячем наши аргументы
# перед импортом общих помощников (сцена, свет, камера, подгонка размера).
if "--" in sys.argv:
    sys.argv = sys.argv[:sys.argv.index("--")]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gems  # noqa: E402

gems.SAMPLES = SAMPLES
gems.SIZE = SIZE
OUT_DIR = _arg("--out", os.path.join(gems.PROJECT, "assets", "gems"))

N = 192           # точек по периметру
OUTLINE = 0.030   # ширина тёмного контура
FRAME_IN = 0.112  # внутренний край золотой рамки
ENAMEL_Z = 0.034  # высота края эмали
DOME = 0.032      # выпуклость эмали

# ---------------------------------------------------------------------------
# Силуэты: функции знакового расстояния в нормированных координатах (~±0.5)
# ---------------------------------------------------------------------------


def sd_circle(p, c, r):
    return math.hypot(p[0] - c[0], p[1] - c[1]) - r


def sd_convex(p, pts):
    """Знаковое расстояние до выпуклого многоугольника (вершины против часовой)."""
    inside = True
    best = 1e9
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % n]
        ex, ey = bx - ax, by - ay
        wx, wy = p[0] - ax, p[1] - ay
        t = max(0.0, min(1.0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
        best = min(best, math.hypot(wx - ex * t, wy - ey * t))
        if ex * wy - ey * wx < 0:
            inside = False
    return -best if inside else best


def regular(n, r, start=90.0):
    return [(r * math.cos(math.radians(start + i * 360.0 / n)),
             r * math.sin(math.radians(start + i * 360.0 / n))) for i in range(n)]


def cut_square(h, c):
    return [(h - c, -h), (h, -h + c), (h, h - c), (h - c, h),
            (-h + c, h), (-h, h - c), (-h, -h + c), (-h + c, -h)]


_CUTSQ = cut_square(0.45, 0.10)
_RHOMB = [(0.0, -0.41), (0.36, 0.0), (0.0, 0.41), (-0.36, 0.0)]
_ARCH_BOX = [(-0.27, -0.44), (0.27, -0.44), (0.27, 0.12), (-0.27, 0.12)]

SHAPES = {
    # рубин: квадрат со срезанными углами (неправильный восьмиугольник)
    "cutsq": lambda p: sd_convex(p, _CUTSQ) - 0.04,
    # нефрит: высокий ромб со скруглёнными углами
    "rhomb": lambda p: sd_convex(p, _RHOMB) - 0.075,
    # бирюза: стела — плоский низ, арка сверху
    "arch": lambda p: min(sd_convex(p, _ARCH_BOX), sd_circle(p, (0.0, 0.12), 0.27)) - 0.05,
    # аметист: четырёхлистник
    "quatre": lambda p: min(sd_circle(p, (0.22, 0.0), 0.28), sd_circle(p, (-0.22, 0.0), 0.28),
                            sd_circle(p, (0.0, 0.22), 0.28), sd_circle(p, (0.0, -0.22), 0.28),
                            sd_circle(p, (0.0, 0.0), 0.30)),
    # лунный камень: круглая монета
    "coin": lambda p: sd_circle(p, (0.0, 0.0), 0.47),
    # солнечный камень: монета поменьше, лучи добавляются отдельно
    "sun": lambda p: sd_circle(p, (0.0, 0.0), 0.36),
}


def radius(sdf, ang, d):
    """Расстояние от центра до изолинии sdf = -d вдоль луча ang."""
    ux, uy = math.cos(ang), math.sin(ang)
    t = 0.75
    while t > 0 and sdf((ux * t, uy * t)) > -d:
        t -= 0.01
    lo, hi = t, t + 0.01
    for _ in range(24):
        m = (lo + hi) / 2
        if sdf((ux * m, uy * m)) > -d:
            hi = m
        else:
            lo = m
    return lo


class Outline:
    """Кэш колец силуэта на разных отступах внутрь."""

    def __init__(self, sdf):
        self.sdf = sdf
        self.angles = [i / N * math.tau - math.pi / 2 for i in range(N)]
        self.cache = {}

    def radii(self, d):
        key = round(d, 5)
        if key not in self.cache:
            self.cache[key] = [radius(self.sdf, a, d) for a in self.angles]
        return self.cache[key]

    def ring(self, d, z, scale=1.0):
        return [(math.cos(a) * r * scale, math.sin(a) * r * scale, z)
                for a, r in zip(self.angles, self.radii(d))]

    def radius_at(self, d, ang):
        rs = self.radii(d)
        f = ((ang + math.pi / 2) % math.tau) / math.tau * N
        i = int(f) % N
        t = f - int(f)
        return rs[i] * (1 - t) + rs[(i + 1) % N] * t

    def surface(self, x, y):
        """Высота выпуклой эмали в точке (x, y)."""
        r_in = self.radius_at(FRAME_IN - 0.006, math.atan2(y, x))
        s = min(1.0, math.hypot(x, y) / max(r_in, 1e-6))
        return ENAMEL_Z + DOME * (1.0 - s * s)


# ---------------------------------------------------------------------------
# Меши
# ---------------------------------------------------------------------------


def mesh_object(name, verts, faces, mats, smooth=False, face_mats=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
    else:
        me.shade_flat()
    for m in mats:
        me.materials.append(m)
    if face_mats:
        for poly, fm in zip(me.polygons, face_mats):
            poly.material_index = fm
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def sweep(name, rings, mats, closed=True, cap_first=False, cap_last=False,
          fan_last=None, smooth=False, ring_mats=None):
    """Соединяет кольца по порядку; fan_last=(x, y, z) — веер к точке."""
    n = len(rings[0])
    verts = [v for r in rings for v in r]
    faces, fm = [], []
    count = len(rings) if closed else len(rings) - 1
    for i in range(count):
        a, b = i * n, ((i + 1) % len(rings)) * n
        for j in range(n):
            k = (j + 1) % n
            faces.append((a + j, a + k, b + k, b + j))
            fm.append(ring_mats[i] if ring_mats else 0)
    if cap_first:
        faces.append(tuple(range(n - 1, -1, -1)))
        fm.append(0)
    if cap_last:
        last = (len(rings) - 1) * n
        faces.append(tuple(range(last, last + n)))
        fm.append(0)
    if fan_last is not None:
        c = len(verts)
        verts.append(fan_last)
        last = (len(rings) - 1) * n
        for j in range(n):
            faces.append((last + j, last + (j + 1) % n, c))
            fm.append(ring_mats[-1] if ring_mats else 0)
    return mesh_object(name, verts, faces, mats, smooth=smooth, face_mats=fm)


def prism(name, pts, z0, z1, mat, bevel=0.0):
    n = len(pts)
    verts = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for j in range(n):
        k = (j + 1) % n
        faces.append((j, k, n + k, n + j))
    ob = mesh_object(name, verts, faces, [mat])
    if bevel:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        mod.angle_limit = math.radians(30)
        ob.data.shade_smooth()
        ob.modifiers.new("Smooth", "WEIGHTED_NORMAL").keep_sharp = True
    return ob


def tube(name, paths, radius_, mat):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius_
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    for pts in paths:
        sp = cu.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for i, (x, y, z) in enumerate(pts):
            sp.points[i].co = (x, y, z, 1.0)
        if len(pts) > 2 and pts[0] == pts[-1]:
            sp.use_cyclic_u = True
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    cu.materials.append(mat)
    return ob


def sphere(name, r, loc, mat, squash=1.0, seg=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.scale = (1.0, 1.0, squash)
    return ob


def faceted_jewel(name, r, loc, mat, sides=8):
    """Маленький огранённый камень: павильон, рундист, корона и площадка."""
    cx, cy, cz = loc
    levels = [(-0.02, 0.35), (0.0, 1.0), (0.010, 1.0), (0.030, 0.72), (0.040, 0.48)]
    rings = []
    for z, s in levels:
        rings.append([(cx + math.cos(i / sides * math.tau + math.pi / sides) * r * s,
                       cy + math.sin(i / sides * math.tau + math.pi / sides) * r * s,
                       cz + z * r / 0.08) for i in range(sides)])
    return sweep(name, rings, [mat], closed=False, cap_first=True, cap_last=True)


# ---------------------------------------------------------------------------
# Материалы
# ---------------------------------------------------------------------------

srgb = gems.srgb


def mat_basic(name, hex_color, **kw):
    return gems.make_material(name, srgb(hex_color), **kw)


def enamel_material(name, light, mid, dark, glow, glow_strength):
    """Глянцевая эмаль: градиент от света сверху-слева и мягкое свечение из центра."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")

    coord = nodes.new("ShaderNodeTexCoord")
    sub = nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (-0.22, 0.30, 0.0)
    length = nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    e0, e1 = ramp.color_ramp.elements
    e0.position, e0.color = 0.0, (*srgb(light), 1.0)
    e1.position, e1.color = 0.95, (*srgb(dark), 1.0)
    ramp.color_ramp.elements.new(0.40).color = (*srgb(mid), 1.0)
    links.new(coord.outputs["Object"], sub.inputs[0])
    links.new(sub.outputs["Vector"], length.inputs[0])
    links.new(length.outputs["Value"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])

    # свечение из-под кабошона
    clen = nodes.new("ShaderNodeVectorMath")
    clen.operation = "LENGTH"
    links.new(coord.outputs["Object"], clen.inputs[0])
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.06
    mr.inputs["From Max"].default_value = 0.30
    mr.inputs["To Min"].default_value = glow_strength
    mr.inputs["To Max"].default_value = 0.0
    links.new(clen.outputs["Value"], mr.inputs["Value"])
    bsdf.inputs["Emission Color"].default_value = (*srgb(glow), 1.0)
    links.new(mr.outputs["Result"], bsdf.inputs["Emission Strength"])

    bsdf.inputs["Roughness"].default_value = 0.16
    bsdf.inputs["IOR"].default_value = 1.6
    bsdf.inputs["Coat Weight"].default_value = 0.8
    bsdf.inputs["Coat Roughness"].default_value = 0.04
    return mat


def gold_set(tag):
    return {
        "gold": mat_basic("gold_" + tag, "#f0c060", metallic=0.35, roughness=0.24,
                          coat=0.7, coat_roughness=0.05),
        "gold_hi": mat_basic("gold_hi_" + tag, "#ffe3a0", metallic=0.3, roughness=0.18,
                             coat=0.6, emission=(srgb("#ffe3a0"), 0.22)),
        "outline": mat_basic("outline_" + tag, "#24150a", roughness=0.5, coat=0.3),
    }


# ---------------------------------------------------------------------------
# Описание камней (индексы совпадают с js/art.js GEMS)
# ---------------------------------------------------------------------------

TILES = [
    {   # 0 — Рубин: срезанный квадрат, спираль «глаза ягуара»
        "name": "Рубин", "shape": "cutsq", "glyph": "spiral",
        "enamel": ("#ff9a7e", "#d8262a", "#5e0610"), "glow": "#ff5a3a", "glow_k": 0.55,
        "inlay": "gold", "cab": ("dome", "#ffd27a", "#ffb030", 0.075),
        "rivets": [45, 135, 225, 315],
    },
    {   # 1 — Солнечный камень: монета с венцом из 12 лучей, кольцо и лучики
        "name": "Солнечный камень", "shape": "sun", "glyph": "sunface",
        "enamel": ("#ffe27a", "#f39a12", "#8a3e04"), "glow": "#ffd040", "glow_k": 0.6,
        "inlay": "#7a2a06", "cab": ("facet", "#ff5a2a", "#ff3a10", 0.07),
        "rivets": [], "area": 0.42,
    },
    {   # 2 — Нефрит: высокий ромб, перо
        "name": "Нефрит", "shape": "rhomb", "glyph": "feather",
        "enamel": ("#b8ffa0", "#22a23e", "#064a1a"), "glow": "#7cff80", "glow_k": 0.5,
        "inlay": "#0b3315", "cab": ("dome", "#eaffc0", "#b8ff70", 0.068),
        "rivets": [90, 270],
    },
    {   # 3 — Бирюза: арочная стела, две волны
        "name": "Бирюза", "shape": "arch", "glyph": "waves",
        "enamel": ("#a6efff", "#1a7ad0", "#062e66"), "glow": "#60d8ff", "glow_k": 0.55,
        "inlay": "gold", "cab": ("dome", "#d8fbff", "#80eaff", 0.07), "cab_at": (0.0, -0.02),
        "rivets": [-130, -50, 90],
    },
    {   # 4 — Аметист: четырёхлистник, око с огранённым зрачком
        "name": "Аметист", "shape": "quatre", "glyph": "eye",
        "enamel": ("#f2b8ff", "#8a28c8", "#3a0a5e"), "glow": "#d080ff", "glow_k": 0.55,
        "inlay": "gold", "cab": ("facet", "#ffc8f4", "#ff80e0", 0.075),
        "rivets": [0, 90, 180, 270],
    },
    {   # 5 — Обсидиан (лунный камень): круглая монета, полумесяц
        "name": "Обсидиан", "shape": "coin", "glyph": "crescent",
        "enamel": ("#ffffff", "#b4bec6", "#5a646c"), "glow": "#e8f4ff", "glow_k": 0.35,
        "inlay": "#26323c", "cab": ("dome", "#e8fbff", "#a8e0ff", 0.068),
        "cab_at": (0.075, 0.0),
        "rivets": [0, 60, 120, 180, 240, 300],
    },
]

# ---------------------------------------------------------------------------
# Глифы: штрихи (трубки) и заливки (рельефные пластины)
# ---------------------------------------------------------------------------


def glyph(kind):
    strokes, fills = [], []
    if kind == "spiral":
        pts = []
        turns = 1.35
        for i in range(80):
            t = i / 79
            a = math.pi * 0.5 - t * turns * math.tau
            r = 0.125 + t * 0.15
            pts.append((r * math.cos(a), r * math.sin(a)))
        strokes.append(pts)
    elif kind == "sunface":
        strokes.append([(0.15 * math.cos(i / 48 * math.tau), 0.15 * math.sin(i / 48 * math.tau))
                        for i in range(49)])
    elif kind == "feather":
        strokes.append([(0.0, 0.11), (0.0, 0.30)])
        strokes.append([(0.0, -0.11), (0.0, -0.30)])
        strokes.append([(-0.13, 0.13), (0.0, 0.25), (0.13, 0.13)])
        strokes.append([(-0.12, -0.25), (0.0, -0.14), (0.12, -0.25)])
    elif kind == "waves":
        for y0 in (0.185, -0.225):
            pts = []
            for i in range(49):
                t = i / 48
                x = -0.175 + 0.35 * t
                pts.append((x, y0 + 0.036 * math.sin(t * 3.0 * math.pi)))
            strokes.append(pts)
    elif kind == "eye":
        top, bot = [], []
        for i in range(33):
            t = i / 32
            x = -0.27 + 0.54 * t
            h = 0.15 * math.sin(t * math.pi) ** 0.9
            top.append((x, h))
            bot.append((x, -h))
        strokes.append(top + list(reversed(bot))[1:])
        strokes.append([(-0.035, 0.205), (0.0, 0.26), (0.035, 0.205)])
    elif kind == "crescent":
        r1, r2, a = 0.25, 0.205, 0.105
        xi = (a * a + r1 * r1 - r2 * r2) / (2 * a)
        yi = math.sqrt(max(r1 * r1 - xi * xi, 0.0))
        a1 = math.atan2(yi, xi)
        a2 = math.atan2(yi, xi - a)
        outer = [(r1 * math.cos(a1 + (math.tau - 2 * a1) * i / 40),
                  r1 * math.sin(a1 + (math.tau - 2 * a1) * i / 40)) for i in range(41)]
        inner = [(a + r2 * math.cos(-a2 - (math.tau - 2 * a2) * i / 40),
                  r2 * math.sin(-a2 - (math.tau - 2 * a2) * i / 40)) for i in range(1, 40)]
        fills.append([(x - 0.03, y) for x, y in outer + inner])
    return strokes, fills


# ---------------------------------------------------------------------------
# Сборка плитки
# ---------------------------------------------------------------------------


def build_tile(idx):
    spec = TILES[idx]
    tag = str(idx)
    ol = Outline(SHAPES[spec["shape"]])
    m = gold_set(tag)
    enamel = enamel_material("enamel_" + tag, *spec["enamel"], spec["glow"], spec["glow_k"])
    if spec["inlay"] == "gold":
        inlay = mat_basic("inlay_" + tag, "#ffd877", metallic=0.4, roughness=0.22, coat=0.6,
                          emission=(srgb("#ffd877"), 0.28))
    else:
        inlay = mat_basic("inlay_" + tag, spec["inlay"], metallic=0.2, roughness=0.3, coat=0.6)
    objs = []

    # тёмная подложка — она же контур плитки
    base = sweep("base_" + tag, [ol.ring(0.0, -0.16), ol.ring(0.0, -0.01), ol.ring(0.03, 0.02)],
                 [m["outline"]], closed=False, cap_first=True, cap_last=True)
    mod = base.modifiers.new("Bevel", "BEVEL")
    mod.width, mod.segments = 0.012, 2
    objs.append(base)

    # золотая рамка: сечение с фаской наружу и внутрь
    section = [
        (OUTLINE, -0.02), (OUTLINE, 0.040), (OUTLINE + 0.014, 0.068),
        (OUTLINE + 0.034, 0.082), (FRAME_IN - 0.034, 0.082), (FRAME_IN - 0.012, 0.064),
        (FRAME_IN, 0.040), (FRAME_IN, -0.02),
    ]
    rings = [ol.ring(d, z) for d, z in section]
    ring_mats = [0, 1, 0, 0, 1, 0, 0, 0]
    objs.append(sweep("frame_" + tag, rings, [m["gold"], m["gold_hi"]], closed=True,
                      ring_mats=ring_mats))

    # заклёпки на рамке
    mid_d = (OUTLINE + FRAME_IN) / 2
    for k, deg in enumerate(spec["rivets"]):
        a = math.radians(deg)
        r = ol.radius_at(mid_d, a)
        objs.append(sphere("rivet_%s_%d" % (tag, k), 0.021,
                           (r * math.cos(a), r * math.sin(a), 0.082), m["gold_hi"], squash=0.7,
                           seg=16, rings=8))

    # эмаль: выпуклая подушка, веер к центру
    d_e = FRAME_IN - 0.006
    rings = [ol.ring(d_e, -0.02)]
    for s in (1.0, 0.96, 0.9, 0.8, 0.66, 0.5, 0.32, 0.15):
        rings.append(ol.ring(d_e, ENAMEL_Z + DOME * (1 - s * s), scale=s))
    objs.append(sweep("enamel_" + tag, rings, [enamel], closed=False, cap_first=True,
                      fan_last=(0.0, 0.0, ENAMEL_Z + DOME), smooth=True))

    # глиф
    strokes, fills = glyph(spec["glyph"])
    if strokes:
        paths = [[(x, y, ol.surface(x, y) + 0.004) for x, y in s] for s in strokes]
        objs.append(tube("glyph_" + tag, paths, 0.031, inlay))
    for k, poly in enumerate(fills):
        zs = [ol.surface(x, y) for x, y in poly]
        objs.append(prism("glyph_fill_%s_%d" % (tag, k), poly, min(zs) - 0.01,
                          max(zs) + 0.026, inlay, bevel=0.012))

    # кабошон в золотом гнезде
    kind, c_light, c_glow, cr = spec["cab"]
    cx, cy = spec.get("cab_at", (0.0, 0.0))
    cz = ol.surface(cx, cy)
    if kind == "facet":
        cab = mat_basic("cab_" + tag, c_light, roughness=0.04, coat=1.0, ior=2.0,
                        transmission=0.25, emission=(srgb(c_glow), 0.9))
        objs.append(faceted_jewel("cab_" + tag, cr, (cx, cy, cz + 0.012), cab))
    else:
        cab = mat_basic("cab_" + tag, c_light, roughness=0.06, coat=1.0, ior=1.6,
                        transmission=0.15, emission=(srgb(c_glow), 0.7))
        objs.append(sphere("cab_" + tag, cr, (cx, cy, cz + 0.004), cab, squash=0.62))
    collar = [(cx + (cr + 0.012) * math.cos(i / 48 * math.tau),
               cy + (cr + 0.012) * math.sin(i / 48 * math.tau), cz + 0.006) for i in range(49)]
    objs.append(tube("collar_" + tag, [collar], 0.016, m["gold"]))

    # лучи солнечного камня
    if spec["shape"] == "sun":
        ray_mat = mat_basic("ray_" + tag, "#ffc850", metallic=0.35, roughness=0.22, coat=0.7,
                            emission=(srgb("#ffb030"), 0.25))
        for k in range(12):
            a = math.radians(90 + k * 30)
            r0, r1, half = 0.33, 0.47, 0.072
            ca, sa = math.cos(a), math.sin(a)
            tri = [(r1 * ca, r1 * sa),
                   (r0 * ca - half * sa, r0 * sa + half * ca),
                   (r0 * ca + half * sa, r0 * sa - half * ca)]
            # дно и верх лучей с тёмным контуром: тёмная пластина чуть шире
            pad = 0.022
            tri_o = [(x + ca * pad * (1 if i == 0 else 0.3), y + sa * pad * (1 if i == 0 else 0.3))
                     for i, (x, y) in enumerate(tri)]
            objs.append(prism("ray_o_%s_%d" % (tag, k), tri_o, -0.15, -0.02, m["outline"],
                              bevel=0.008))
            objs.append(prism("ray_%s_%d" % (tag, k), tri, -0.03, 0.05, ray_mat, bevel=0.018))
    return objs


# ---------------------------------------------------------------------------
# Рендер
# ---------------------------------------------------------------------------

AZ, ELEV = -86, 57


def clear():
    for ob in [o for o in bpy.data.objects if o.type in {"MESH", "CURVE"}]:
        bpy.data.objects.remove(ob, do_unlink=True)


def main():
    gems.reset_scene()
    gems.setup_studio()

    if PREVIEW:
        cam = gems.setup_camera(target=(0, 0, 0.0), ortho=6.0, az_deg=AZ, elev_deg=ELEV)
        bpy.context.scene.render.resolution_x = SIZE * 6
        bpy.context.scene.render.resolution_y = SIZE
        right = cam.rotation_euler.to_matrix() @ Vector((1.0, 0.0, 0.0))
        done = []
        for i in range(len(TILES)):
            for ob in done:
                ob.hide_render = True  # площадь силуэта меряем по одной плитке
            part = build_tile(i)
            gems.fit_gem(part, cam, target=0.82, center=(0.5, 0.5))
            gems.shift_objs(part, right * (i - 2.5) * 1.0)
            done += part
        for ob in done:
            ob.hide_render = False
        bpy.context.view_layer.update()
        gems.render(os.path.join(OUT_DIR, "_preview_all.png"))
        return

    for i in ([ONLY] if ONLY is not None else range(len(TILES))):
        clear()
        cam = gems.setup_camera(target=(0, 0, 0.0), az_deg=AZ, elev_deg=ELEV)
        objs = build_tile(i)
        gems.fit_gem(objs, cam, area=TILES[i].get("area", 0.47), max_size=0.90)
        gems.render(os.path.join(OUT_DIR, "gem-%d.png" % i))


if __name__ == "__main__":
    main()
