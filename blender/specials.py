"""Значки спецкамней «Сокровищ Солнца»: солнце, молния, бомба, тотем.

Значок — объёмный медальон, который ложится в центр таблички и целиком
помещается в клетку (прежние кольца-оверлеи из blender/specials_ring.py
выходили на соседние камни). Вид строго сверху, ортокамера, тёплый ключевой
свет сверху-слева — как у нарисованных табличек. Тёмный контур и светлый
ореол добавляет tools/finish_specials.py.

Фон (рендер в PNG с альфой):
  /Applications/Blender.app/Contents/MacOS/Blender --background \
      --python blender/specials.py -- --out art-src/specials [--only sun]
затем:
  python3 tools/finish_specials.py art-src/specials assets/gems

В живом Blender (через MCP) файл можно выполнить целиком: он соберёт сцену
«SunSpecials», не трогая остальные сцены, и ничего не отрендерит сам.
"""
import math
import os
import sys

import bmesh
import bpy

TYPES = ("sun", "line", "bomb", "totem")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"out": None, "only": None, "size": 512}
    it = iter(argv)
    for a in it:
        if a == "--out":
            opts["out"] = next(it)
        elif a == "--only":
            opts["only"] = next(it)
        elif a == "--size":
            opts["size"] = int(next(it))
    return opts


# ---------- сцена ----------

def setup_scene(size=512):
    sc = bpy.data.scenes.get("SunSpecials") or bpy.data.scenes.new("SunSpecials")
    if not bpy.app.background:
        bpy.context.window.scene = sc
    for o in list(sc.collection.all_objects):
        bpy.data.objects.remove(o, do_unlink=True)
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = -0.6

    w = bpy.data.worlds.get("SunSpecialsWorld") or bpy.data.worlds.new("SunSpecialsWorld")
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.55, 0.45, 0.30, 1)  # тёплое окружение — золоту есть что отражать
    bg.inputs[1].default_value = 1.1
    sc.world = w

    cam_d = bpy.data.cameras.new("SpCam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 2.3
    cam = bpy.data.objects.new("SpCam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = (0, 0, 10)
    sc.camera = cam

    tgt = bpy.data.objects.new("SpTarget", None)
    sc.collection.objects.link(tgt)
    for name, loc, power, color, size_ in (
        ("SpKey", (-3.2, 3.2, 4.5), 650, (1.0, 0.9, 0.75), 2.5),
        ("SpFill", (3.5, -2.5, 3.5), 380, (0.75, 0.85, 1.0), 4),
        ("SpTop", (0, 0, 6), 220, (1, 1, 1), 6),
    ):
        d = bpy.data.lights.new(name, "AREA")
        d.energy, d.color, d.size = power, color, size_
        o = bpy.data.objects.new(name, d)
        sc.collection.objects.link(o)
        o.location = loc
        c = o.constraints.new("TRACK_TO")
        c.target, c.track_axis, c.up_axis = tgt, "TRACK_NEGATIVE_Z", "UP_Y"
    return sc


def mat(name, base, metal=0.0, rough=0.4, emit=None, emit_str=0.0, coat=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    p.inputs["Base Color"].default_value = (*base, 1)
    p.inputs["Metallic"].default_value = metal
    p.inputs["Roughness"].default_value = rough
    if "Coat Weight" in p.inputs:
        p.inputs["Coat Weight"].default_value = coat
    if emit:
        p.inputs["Emission Color"].default_value = (*emit, 1)
        p.inputs["Emission Strength"].default_value = emit_str
    return m


def materials():
    return {
        "gold": mat("SpGold", (1.0, 0.50, 0.07), 1.0, 0.32),
        "gold_d": mat("SpGoldDeep", (0.75, 0.30, 0.03), 1.0, 0.34),
        "sun_jewel": mat("SpSunJewel", (0.85, 0.06, 0.01), 0.0, 0.08, (1.0, 0.22, 0.02), 0.6, 1.0),
        "volt": mat("SpVolt", (0.02, 0.38, 0.95), 0.0, 0.10, (0.10, 0.55, 1.0), 0.9, 1.0),
        "obsidian": mat("SpObsidian", (0.035, 0.02, 0.06), 0.1, 0.28, None, 0.0, 0.35),
        "ember": mat("SpEmber", (0.95, 0.12, 0.01), 0.0, 0.10, (1.0, 0.25, 0.02), 1.1, 1.0),
        "spark": mat("SpSpark", (1.0, 0.6, 0.1), 0.0, 0.2, (1.0, 0.55, 0.08), 3.0),
        "jade": mat("SpJade", (0.01, 0.26, 0.12), 0.0, 0.25, None, 0.0, 0.5),
        "feather_r": mat("SpFeatherRed", (0.62, 0.02, 0.01), 0.0, 0.4, None, 0.0, 0.2),
        "feather_t": mat("SpFeatherTeal", (0.0, 0.30, 0.38), 0.0, 0.4, None, 0.0, 0.2),
        "eye": mat("SpTotemEye", (0.90, 0.08, 0.02), 0.0, 0.08, (1.0, 0.2, 0.02), 0.8, 1.0),
    }


# ---------- примитивы без bpy.ops (работают и в фоне) ----------

def _obj(sc, name, bm, material, root, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for f in me.polygons:
            f.use_smooth = True
    o = bpy.data.objects.new(name, me)
    o.data.materials.append(material)
    sc.collection.objects.link(o)
    o.parent = root
    return o


def bevel(o, w=0.03, seg=3):
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments, m.limit_method = w, seg, "ANGLE"
    return o


def prism(sc, name, pts, depth, z0, material, root):
    bm = bmesh.new()
    vb = [bm.verts.new((x, y, z0)) for x, y in pts]
    vt = [bm.verts.new((x, y, z0 + depth)) for x, y in pts]
    bm.faces.new(vb[::-1])
    bm.faces.new(vt)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((vb[i], vb[j], vt[j], vt[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(sc, name, bm, material, root)


def cyl(sc, name, r, depth, z0, material, root, verts=64):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=depth)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, z0 + depth / 2))
    return _obj(sc, name, bm, material, root)


def sphere(sc, name, r, loc, material, root, scale=(1, 1, 1), faceted=False):
    bm = bmesh.new()
    if faceted:
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=loc)
    return _obj(sc, name, bm, material, root, smooth=not faceted)


def box(sc, name, size, loc, material, root):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=loc)
    return _obj(sc, name, bm, material, root)


def rivets(sc, prefix, n, radius, z, r, material, root, phase=0.0):
    for k in range(n):
        a = phase + k * 2 * math.pi / n
        sphere(sc, f"{prefix}{k}", r, (radius * math.cos(a), radius * math.sin(a), z), material, root)


# ---------- значки ----------

def build_sun(sc, M, root):
    """Солнечный камень: 8 гранёных лучей, диск с заклёпками, огранённый рубин."""
    for i in range(8):
        a = i * math.pi / 4 + math.pi / 8
        L = 0.93 if i % 2 == 0 else 0.83
        w, br = 0.30, 0.46
        ca, sa = math.cos(a), math.sin(a)
        left = (br * math.cos(a - w), br * math.sin(a - w))
        right = (br * math.cos(a + w), br * math.sin(a + w))
        mid, tip = (br * 0.98 * ca, br * 0.98 * sa), (L * ca, L * sa)
        bm = bmesh.new()
        bl, bt, brr = bm.verts.new((*left, 0)), bm.verts.new((*tip, 0)), bm.verts.new((*right, 0))
        tl, tr = bm.verts.new((*left, 0.10)), bm.verts.new((*right, 0.10))
        rm, rt = bm.verts.new((*mid, 0.26)), bm.verts.new((*tip, 0.10))
        for f in ((brr, bt, bl), (tl, rm, rt), (rm, tr, rt), (bl, bt, rt, tl), (bt, brr, tr, rt), (brr, bl, tl, rm, tr)):
            bm.faces.new(f)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bevel(_obj(sc, f"sun_ray{i}", bm, M["gold"] if i % 2 == 0 else M["gold_d"], root), 0.02, 2)
    bevel(cyl(sc, "sun_disc", 0.52, 0.22, 0.0, M["gold"], root), 0.06, 4)
    bevel(cyl(sc, "sun_ring", 0.40, 0.06, 0.22, M["gold_d"], root), 0.025, 3)
    bevel(cyl(sc, "sun_inner", 0.34, 0.05, 0.24, M["gold"], root), 0.02, 3)
    rivets(sc, "sun_rivet", 16, 0.465, 0.21, 0.04, M["gold"], root)
    sphere(sc, "sun_jewel", 0.25, (0, 0, 0.30), M["sun_jewel"], root, (1, 1, 0.6), faceted=True)


def build_line(sc, M, root):
    """Молния: крест из четырёх стрелок с голубой светящейся вставкой."""
    arrow = [(0.30, -0.09), (0.62, -0.09), (0.62, -0.24), (0.97, 0.0), (0.62, 0.24), (0.62, 0.09), (0.30, 0.09)]
    inlay = [(0.40, -0.035), (0.66, -0.035), (0.66, -0.11), (0.85, 0.0), (0.66, 0.11), (0.66, 0.035), (0.40, 0.035)]
    for i in range(4):
        a = i * math.pi / 2
        rot = lambda p: (p[0] * math.cos(a) - p[1] * math.sin(a), p[0] * math.sin(a) + p[1] * math.cos(a))
        bevel(prism(sc, f"line_arrow{i}", [rot(p) for p in arrow], 0.17, 0.0, M["gold"], root), 0.035, 3)
        bevel(prism(sc, f"line_inlay{i}", [rot(p) for p in inlay], 0.04, 0.17, M["volt"], root), 0.01, 2)
    bevel(cyl(sc, "line_disc", 0.42, 0.22, 0.0, M["gold"], root), 0.06, 4)
    bevel(cyl(sc, "line_ring", 0.32, 0.05, 0.22, M["gold_d"], root), 0.02, 3)
    rivets(sc, "line_rivet", 12, 0.375, 0.21, 0.036, M["gold"], root, phase=math.pi / 12)
    sphere(sc, "line_jewel", 0.24, (0, 0, 0.30), M["volt"], root, (1, 1, 0.6), faceted=True)


def build_bomb(sc, M, root):
    """Бомба: обсидиановая сфера, золотой пояс с заклёпками, тлеющий глаз и фитиль с искрой."""
    sphere(sc, "bomb_core", 0.66, (0, -0.04, 0.0), M["obsidian"], root, (1, 1, 0.7))
    rh = 0.47
    z_band = math.sqrt(max(0.0, 0.66 ** 2 - rh ** 2)) * 0.7
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=rh + 0.05, radius2=rh + 0.02, depth=0.08)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, -0.04, z_band))
    band = _obj(sc, "bomb_band", bm, M["gold"], root)
    band.modifiers.new("Solid", "SOLIDIFY").thickness = 0.05
    bevel(band, 0.015, 2)
    for k in range(8):
        a = k * math.pi / 4 + math.pi / 8
        sphere(sc, f"bomb_rivet{k}", 0.045, ((rh + 0.035) * math.cos(a), -0.04 + (rh + 0.035) * math.sin(a), z_band + 0.04), M["gold"], root)
    bevel(cyl(sc, "bomb_eye_set", 0.21, 0.08, 0.40, M["gold"], root), 0.03, 3).location.y = -0.04
    sphere(sc, "bomb_eye", 0.17, (0, -0.04, 0.50), M["ember"], root, (1, 1, 0.55), faceted=True)
    # фитиль: золотая трубка вверх-вправо и искра
    fuse = prism(sc, "bomb_fuse", [(0.36, 0.30), (0.30, 0.36), (0.58, 0.64), (0.64, 0.58)], 0.12, 0.10, M["gold_d"], root)
    bevel(fuse, 0.025, 2)
    bevel(cyl(sc, "bomb_fuse_cap", 0.09, 0.10, 0.12, M["gold"], root), 0.02, 2).location = (0.34, 0.30, 0.0)
    sphere(sc, "bomb_spark", 0.10, (0.66, 0.66, 0.26), M["spark"], root)
    for k, (dx, dy) in enumerate(((0.15, 0.0), (0.0, 0.15), (0.11, 0.11), (-0.04, 0.13), (0.13, -0.04))):
        sphere(sc, f"bomb_spark_bit{k}", 0.028, (0.66 + dx, 0.66 + dy, 0.26), M["spark"], root)


def build_totem(sc, M, root):
    """Тотем: нефритовая маска в золотой рамке, глаза-рубины, золотой оскал, веер перьев."""
    # перья позади маски
    for k, ang in enumerate((-56, -28, 0, 28, 56)):
        a = math.radians(90 + ang)
        cx, cy = 0.50 * math.cos(a), 0.20 + 0.50 * math.sin(a)
        f = sphere(sc, f"totem_feather{k}", 0.22, (0, 0, 0), M["feather_r"] if k % 2 == 0 else M["feather_t"], root, (0.42, 1.0, 0.18))
        f.location = (cx, cy, 0.0)
        f.rotation_euler = (0, 0, a - math.pi / 2)
    bevel(box(sc, "totem_band", (0.98, 0.14, 0.12), (0, 0.38, 0.10), M["gold_d"], root), 0.04, 3)
    rivets_line = [(-0.36 + k * 0.18, 0.38) for k in range(5)]
    for k, (x, y) in enumerate(rivets_line):
        sphere(sc, f"totem_band_rivet{k}", 0.035, (x, y, 0.17), M["gold"], root)
    frame = bevel(box(sc, "totem_frame", (0.92, 1.00, 0.16), (0, -0.08, 0.06), M["gold"], root), 0.12, 4)
    face = bevel(box(sc, "totem_face", (0.76, 0.84, 0.16), (0, -0.08, 0.14), M["jade"], root), 0.10, 4)
    _ = frame, face
    for side in (-1, 1):
        bevel(cyl(sc, f"totem_eye_ring{side}", 0.12, 0.06, 0.22, M["gold"], root), 0.02, 2).location.x = side * 0.18
        sphere(sc, f"totem_eye{side}", 0.08, (side * 0.18, 0.0, 0.30), M["eye"], root, (1, 1, 0.6), faceted=True)
        bevel(box(sc, f"totem_brow{side}", (0.22, 0.05, 0.05), (side * 0.18, 0.15, 0.25), M["gold_d"], root), 0.015, 2)
    bevel(box(sc, "totem_mouth", (0.42, 0.11, 0.06), (0, -0.30, 0.24), M["gold"], root), 0.02, 2)
    for k in range(4):
        bevel(box(sc, f"totem_tooth{k}", (0.05, 0.07, 0.04), (-0.135 + k * 0.09, -0.30, 0.285), M["obsidian"], root), 0.008, 1)
    bevel(box(sc, "totem_nose", (0.08, 0.14, 0.06), (0, -0.12, 0.25), M["gold_d"], root), 0.02, 2)


BUILDERS = {"sun": build_sun, "line": build_line, "bomb": build_bomb, "totem": build_totem}


def build_all(sc):
    M = materials()
    roots = {}
    for i, t in enumerate(TYPES):
        root = bpy.data.objects.new(f"SP_{t}", None)
        sc.collection.objects.link(root)
        BUILDERS[t](sc, M, root)
        roots[t] = root
    return roots


def show_only(sc, roots, t):
    for name, root in roots.items():
        for child in root.children:
            child.hide_render = child.hide_viewport = name != t


def main():
    opts = parse_args()
    sc = setup_scene(opts["size"])
    roots = build_all(sc)
    if not opts["out"]:
        show_only(sc, roots, opts["only"] or "sun")
        print("SunSpecials собрана:", ", ".join(TYPES))
        return
    os.makedirs(opts["out"], exist_ok=True)
    for t in TYPES:
        if opts["only"] and t != opts["only"]:
            continue
        show_only(sc, roots, t)
        sc.render.filepath = os.path.join(os.path.abspath(opts["out"]), f"special-{t}.png")
        bpy.ops.render.render(write_still=True, scene=sc.name)
        print("rendered", sc.render.filepath)


if __name__ == "__main__":
    main()
