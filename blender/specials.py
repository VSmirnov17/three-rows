"""
Оверлеи спецкамней «Сокровищ Солнца»: молния, солнце, бомба и тотем.

Это прозрачные рамки, которые кладутся поверх обычного цветного камня:
центр кадра (~55%) оставлен пустым, чтобы цвет камня читался даже на 45 px,
а кольцо, лучи и гребни прижаты к краям.

Запуск (headless):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/specials.py

Опции после `--`:
    --only TYPE    отрендерить только line | sun | bomb | totem
    --samples N    сэмплов Cycles (по умолчанию 128)
    --size N       размер кадра (по умолчанию 256)
    --out DIR      куда писать PNG (по умолчанию assets/gems)
"""

import math
import os
import sys

import bpy
import numpy as np

_ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def _arg(name, default=None, cast=str):
    if name not in _ARGS:
        return default
    return cast(_ARGS[_ARGS.index(name) + 1])


ONLY = _arg("--only")
SAMPLES = _arg("--samples", 128, int)
SIZE = _arg("--size", 256, int)

# gems.py разбирает свои опции при импорте (--only там — число), поэтому
# прячем наши аргументы перед импортом общих помощников.
if "--" in sys.argv:
    sys.argv = sys.argv[:sys.argv.index("--")]
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gems  # noqa: E402
import ui    # noqa: E402  (примитивы в плоскости XZ, фронтальная камера, свет)

OUT_DIR = _arg("--out", os.path.join(gems.PROJECT, "assets", "gems"))
TYPES = ("line", "sun", "bomb", "totem")

# ---------------------------------------------------------------------------
# Палитра
# ---------------------------------------------------------------------------

GOLD = ("#ffe7a6", "#d9a441", "#7a4f0e")
JADE = ("#7ae8b0", "#2aa779", "#0a4a3a")
JADE_SHADOW = "#0e2a20"


def gold(name="gold", emission=0.0):
    return ui.gradient_material(name, *GOLD, roughness=0.24, coat=0.5,
                                metallic=0.35, emission=emission)


def glow(name, hex_color, strength):
    c = gems.srgb(hex_color)
    return gems.make_material(name, c, roughness=0.3, emission=(c, strength))


def polar(r, deg):
    a = math.radians(deg)
    return (r * math.cos(a), r * math.sin(a))


def rot(pts, deg, offset=(0.0, 0.0)):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(offset[0] + x * ca - z * sa, offset[1] + x * sa + z * ca) for x, z in pts]


def spike(name, deg, r0, r1, half, y0, y1, mat, bevel=0.004):
    """Треугольный луч от радиуса r0 к острию r1 под углом deg."""
    pts = rot([(r1, 0.0), (r0, half), (r0, -half)], deg)
    ob = ui.prism(name, pts, y0, y1, mat)
    ui.smooth(ob, bevel, 2)
    return ob


# ---------------------------------------------------------------------------
# Молния: заряженное кольцо и крест из четырёх стрел-молний
# ---------------------------------------------------------------------------

def build_line():
    g = gold("line_gold", emission=0.2)
    core = glow("line_core", "#ffeeb8", 3.0)
    hot = glow("line_hot", "#ffd77a", 2.2)

    ui.torus("ring", 0.400, 0.017, 0.0, g, 128, 16)

    # молния вдоль оси +X: жирный зигзаг от края центра к стреле
    zig = [(0.255, 0.0), (0.305, 0.050), (0.330, -0.040), (0.385, 0.010)]
    head = [(0.499, 0.0), (0.360, 0.098), (0.388, 0.0), (0.360, -0.098)]
    head_core = [(0.462, 0.0), (0.388, 0.052), (0.404, 0.0), (0.388, -0.052)]
    for i, deg in enumerate((0, 90, 180, 270)):
        pts = rot(zig, deg)
        ui.curve("bolt_%d" % i, [pts], -0.010, 0.024, g)
        ui.curve("bolt_core_%d" % i, [pts], -0.034, 0.010, core)
        ob = ui.prism("head_%d" % i, rot(head, deg), -0.030, 0.026, g)
        ui.smooth(ob, 0.006, 2)
        ui.prism("head_core_%d" % i, rot(head_core, deg), -0.046, -0.026, hot)

    # искры на диагоналях кольца
    for i, deg in enumerate((45, 135, 225, 315)):
        x, z = polar(0.400, deg)
        ui.sphere("spark_%d" % i, 0.022, (x, -0.024, z), core, 16, 10)


# ---------------------------------------------------------------------------
# Солнце: корона из острых лучей и солнечный диск-гребень сверху
# ---------------------------------------------------------------------------

def build_sun():
    g = gold("sun_gold", emission=0.35)
    rays = ui.gradient_material("sun_rays", "#fff3c0", "#f2b33a", "#a8560c",
                                roughness=0.22, coat=0.5, metallic=0.3,
                                emission=0.8, span=0.55, offset=(0.0, 0.0, 0.0))
    core = glow("sun_core", "#ffe9a0", 3.5)

    ui.torus("ring", 0.360, 0.020, 0.0, g, 128, 14)

    n = 16
    for i in range(n):
        deg = 90 + i * 360.0 / n
        if i == 0:
            continue  # сверху — гребень
        long_ray = i % 2 == 0
        r1 = 0.499 if long_ray else 0.450
        spike("ray_%d" % i, deg, 0.350, r1, 0.062 if long_ray else 0.046,
              -0.020, 0.020, rays)

    # гребень: солнечный диск с лучиками
    cx, cz = 0.0, 0.392
    disc = ui.cylinder("crest_disc", 0.064, 0.05, -0.035, g, verts=64)
    disc.location = (cx, -0.035, cz)
    ui.smooth(disc, 0.012, 3)
    ui.sphere("crest_core", 0.034, (cx, -0.066, cz), core, 20, 12)
    for i in range(12):
        deg = 90 + i * 30
        ob = spike("crest_ray_%d" % i, deg, 0.058, 0.106, 0.020,
                   -0.040, -0.010, rays, 0.003)
        ob.location = (cx, 0.0, cz)


# ---------------------------------------------------------------------------
# Бомба: тёмное каменное кольцо, золотые шипы и тлеющий фитиль
# ---------------------------------------------------------------------------

def build_bomb():
    stone = ui.gradient_material("bomb_stone", "#5d6660", "#2a302d", "#0b0f0d",
                                 roughness=0.55, coat=0.15, span=0.5,
                                 offset=(-0.2, 0.0, 0.25))
    g = gold("bomb_gold", emission=0.12)
    ember = glow("bomb_ember", "#ff3c00", 0.9)
    ember_hot = glow("bomb_ember_hot", "#ff8a10", 1.8)
    fuse_mat = ui.gradient_material("bomb_fuse", "#c7a77a", "#7a5a34", "#3a2612",
                                    roughness=0.7, coat=0.0, span=0.5)

    ui.torus("ring", 0.395, 0.056, 0.0, stone, 128, 18)
    ui.torus("ring_band", 0.395, 0.013, -0.054, g, 128, 8)
    for i in range(12):
        x, z = polar(0.395, i * 30 + 15)
        ui.sphere("stud_%d" % i, 0.013, (x, -0.060, z), g, 12, 8)

    for i, deg in enumerate((0, 90, 135, 180, 225, 270, 315)):
        spike("spike_%d" % i, deg, 0.420, 0.499, 0.058, -0.024, 0.024, g, 0.005)

    # фитиль в правом верхнем углу
    base = polar(0.430, 45)
    ob = ui.cylinder("fuse_cap", 0.048, 0.07, -0.03, g, verts=32)
    ob.location = (base[0], -0.02, base[1])
    ob.rotation_euler = (math.pi / 2, math.radians(45), 0.0)
    ui.smooth(ob, 0.006, 2)
    fuse = [base, (0.345, 0.370), (0.360, 0.405), (0.395, 0.418)]
    ui.curve("fuse", [fuse], -0.040, 0.016, fuse_mat)
    ui.sphere("ember", 0.048, (0.420, -0.050, 0.425), ember, 24, 14)
    ui.sphere("ember_hot", 0.026, (0.414, -0.092, 0.432), ember_hot, 16, 10)
    for i, (x, z, r) in enumerate(((0.484, 0.484, 0.012), (0.486, 0.360, 0.010),
                                    (0.352, 0.488, 0.010))):
        ui.sphere("spark_%d" % i, r, (x, -0.06, z), ember_hot, 10, 6)


# ---------------------------------------------------------------------------
# Тотем: резной каменный лик с перьями сверху и золотые крылья по бокам
# ---------------------------------------------------------------------------

def build_totem():
    stone = ui.gradient_material("totem_stone", "#e3dcc0", "#8f8a6c", "#3a3c2e",
                                 roughness=0.5, coat=0.25, span=0.20,
                                 offset=(-0.06, 0.0, 0.46))
    g = gold("totem_gold", emission=0.2)
    jade = ui.gradient_material("totem_jade", "#a8ffd0", "#34c48c", "#0f5a44",
                                roughness=0.2, coat=0.5, span=0.20,
                                offset=(0.0, 0.0, 0.40), emission=0.35)
    dark = gems.make_material("totem_dark", gems.srgb(JADE_SHADOW), roughness=0.6)
    eye = glow("totem_eye", "#ffc23a", 4.0)

    # перья-веер за ликом
    pivot = (0.0, 0.300)
    feather = [(0.0, 0.0), (0.080, 0.050), (0.245, 0.0), (0.080, -0.050)]
    for i, deg in enumerate((10, 34, 58, 122, 146, 170)):
        L = (0.95, 1.0, 0.86, 0.86, 1.0, 0.95)[i]
        pts = rot([(x * L, z) for x, z in feather], deg, pivot)
        ob = ui.prism("feather_%d" % i, pts, 0.010, 0.030, jade)
        ui.smooth(ob, 0.004, 2)
        tip = rot([(0.245 * L, 0.0), (0.175 * L, 0.030), (0.175 * L, -0.030)], deg, pivot)
        ui.prism("feather_tip_%d" % i, tip, -0.002, 0.012, g)

    # лик: два яруса резного камня
    lower = ui.prism("face_lower", [(-0.120, 0.265), (0.120, 0.265),
                                    (0.120, 0.350), (-0.120, 0.350)],
                     -0.040, 0.010, stone)
    ui.smooth(lower, 0.010, 2)
    upper = ui.prism("face_upper", [(-0.102, 0.350), (0.102, 0.350),
                                    (0.092, 0.455), (-0.092, 0.455)],
                     -0.040, 0.010, stone)
    ui.smooth(upper, 0.010, 2)
    ui.prism("brow", [(-0.108, 0.412), (0.108, 0.412), (0.098, 0.434),
                      (-0.098, 0.434)], -0.052, -0.036, g)
    ui.prism("band", [(-0.132, 0.342), (0.132, 0.342), (0.132, 0.362),
                      (-0.132, 0.362)], -0.052, -0.036, g)
    for sx in (-0.048, 0.048):
        ui.prism("eye_socket_%d" % (sx > 0),
                 [(sx - 0.032, 0.370), (sx + 0.032, 0.370),
                  (sx + 0.025, 0.404), (sx - 0.025, 0.404)], -0.046, -0.036, dark)
        ui.sphere("eye_%d" % (sx > 0), 0.014, (sx, -0.052, 0.387), eye, 12, 8)
    ui.prism("mouth", [(-0.075, 0.282), (0.075, 0.282), (0.075, 0.326),
                       (-0.075, 0.326)], -0.046, -0.036, dark)
    for i in range(4):
        x = -0.048 + i * 0.032
        ui.prism("tooth_%d" % i, [(x - 0.013, 0.326), (x + 0.013, 0.326),
                                  (x, 0.298)], -0.052, -0.040, g)

    # золотые крылья по бокам: три пера веером, наружу и вверх
    wing = [(0.0, 0.0), (0.045, 0.044), (0.168, 0.0), (0.045, -0.044)]
    for side in (-1, 1):
        root = (side * 0.335, 0.0)
        for j, deg in enumerate((-22, 10, 42)):
            d = deg if side > 0 else 180 - deg
            L = (0.85, 1.0, 0.88)[j]
            pts = rot([(x * L, z) for x, z in wing], d, root)
            ob = ui.prism("wing_%d_%d" % (side, j), pts, -0.020 + j * 0.006,
                          0.016 + j * 0.006, g)
            ui.smooth(ob, 0.004, 2)
            tip = rot([(0.168 * L, 0.0), (0.112 * L, 0.022), (0.112 * L, -0.022)], d, root)
            ui.prism("wing_tip_%d_%d" % (side, j), tip, -0.032 + j * 0.006,
                     -0.018 + j * 0.006, jade)
        boss = ui.cylinder("wing_boss_%d" % side, 0.044, 0.05, -0.03, stone, verts=48)
        boss.location = (root[0], -0.03, root[1])
        ui.smooth(boss, 0.010, 2)
        ui.sphere("wing_gem_%d" % side, 0.020, (root[0], -0.060, root[1]), jade, 14, 8)

    # золотая дуга снизу связывает крылья, не закрывая центр
    arc = [polar(0.400, d) for d in range(-168, -11, 4)]
    ui.curve("arc", [arc], 0.0, 0.016, g)
    x, z = polar(0.400, -90)
    ui.sphere("arc_gem", 0.030, (x, -0.020, z), jade, 18, 10)


BUILDERS = {"line": build_line, "sun": build_sun, "bomb": build_bomb, "totem": build_totem}


# ---------------------------------------------------------------------------
# Пост: тёмно-нефритовая обводка по альфе, чтобы золото читалось на любом камне
# ---------------------------------------------------------------------------

def add_outline(path, radius=None, strength=0.75):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    a = px[..., 3]
    r = radius or max(2, round(SIZE / 110))
    grown = a.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r:
                continue
            grown = np.maximum(grown, np.roll(np.roll(a, dy, 0), dx, 1))
    # пиксели загруженного PNG — в sRGB, альфа не премультиплицирована
    h6 = JADE_SHADOW.lstrip("#")
    sh = np.array([int(h6[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)
    sa = grown * strength
    out_a = a + sa * (1.0 - a)
    safe = np.where(out_a > 1e-6, out_a, 1.0)
    rgb = (px[..., :3] * a[..., None] + sh * (sa * (1.0 - a))[..., None]) / safe[..., None]
    px[..., :3] = rgb
    px[..., 3] = out_a
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def render_type(kind):
    sc = gems.reset_scene()
    sc.cycles.samples = SAMPLES
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    ui.setup_lights()
    ui.setup_camera(ortho=1.0)
    BUILDERS[kind]()
    path = os.path.join(OUT_DIR, "special-%s.png" % kind)
    gems.render(path)
    add_outline(path)


def main():
    kinds = [ONLY] if ONLY else TYPES
    for kind in kinds:
        if kind not in BUILDERS:
            raise SystemExit("unknown special type: %s" % kind)
        render_type(kind)


if __name__ == "__main__":
    main()
