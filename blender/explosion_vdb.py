"""Взрыв камня-бомбы из готовой симуляции EmberGen (VDB, лицензия CC0).

Источник: «Ground Explosion» из бесплатного набора JangaFX
https://jangafx.com/software/embergen/download/free-vdb-animations/
(CC0 — Public Domain). Архив `GroundExplosionVDB.zip`, 200 кадров
`ground_explosion_0000.vdb … _0199.vdb`, поля `flames` и `density`.
В git не кладётся (около 1,2 ГБ): скачать и распаковать вне проекта.

В отличие от огня жаровен (blender/fire_vdb.py) здесь нужен дым:
тёмное «обсидиановое» облако с огненными краями. Поэтому рендер идёт
с прозрачным фоном в EXR (линейный, альфа умножена), а затем тут же
переводится в PNG RGBA 8 бит:
  C — цвет с умноженной альфой, A — плотность дыма; яркость C
  сжимается мягким коленом (--knee) по каждому каналу;
  огонь светится сильнее, чем закрывает фон (C > A), поэтому
  альфа A' = max(A, max(C)), цвет без альфы = C / A', гамма sRGB.
Так края чистые на тёмном поле: ни тёмной, ни белой каймы.
Лист собирает tools/pack_strike.py.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python blender/explosion_vdb.py -- --vdb <папка с ground_explosion_*.vdb> \
      --out <папка кадров> [--frames 8-100] [--step 4] [--size 256] [--samples 24] \
      [--elev 90] [--scale 1.7] [--glow 0.05] [--knee 0.6] [--only N]

Значения по умолчанию — утверждённые для образца (art-src/phase2/PROMPTS.md, «Шаг 5»).

--elev — угол камеры над землёй (90 — сверху), --scale — ширина кадра
ортокамеры в метрах (симуляция уменьшена в 100 раз), --only N — один кадр VDB.
"""
import argparse
import glob
import math
import os
import struct
import sys
import time
import zlib

import bpy
import numpy as np

GROUND_Z = -1.6        # низ симуляции после масштаба 0.01


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--vdb", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--frames", default="8-100", help="первый-последний кадр VDB (номера файлов)")
    p.add_argument("--step", type=int, default=4, help="брать каждый N-й кадр")
    p.add_argument("--size", type=int, default=256)
    p.add_argument("--samples", type=int, default=24)
    p.add_argument("--elev", type=float, default=90.0, help="угол камеры над землёй, градусы")
    p.add_argument("--scale", type=float, default=1.7, help="ширина кадра ортокамеры")
    p.add_argument("--aim", type=float, default=0.55, help="высота точки прицела над землёй")
    p.add_argument("--glow", type=float, default=0.05, help="яркость пламени")
    p.add_argument("--range", type=float, default=4.0, help="flames, которому отвечает конец градиента")
    p.add_argument("--smoke", type=float, default=6.0, help="плотность дыма")
    p.add_argument("--yaw", type=float, default=-55.0, help="поворот симуляции вокруг вертикали, градусы")
    p.add_argument("--squash", type=float, default=0.72, help="сжатие по X кадра после поворота (облако круглее)")
    p.add_argument("--albedo", type=float, default=0.18, help="светлота дыма")
    p.add_argument("--ambient", type=float, default=0.8, help="сила света мира")
    p.add_argument("--knee", type=float, default=0.6, help="выше этой яркости — мягкое сжатие (см. --tone)")
    p.add_argument("--tone", default="channel", help="колено: channel — по каналам, hue — с сохранением оттенка")
    p.add_argument("--top", default="1.0,0.36,0.08", help="цвет конца градиента пламени (линейный RGB)")
    p.add_argument("--list", help="номера кадров VDB через запятую (вместо --frames/--step)")
    p.add_argument("--exposure", type=float, default=1.0, help="множитель цвета перед гаммой")
    p.add_argument("--only", type=int, help="отрендерить один кадр (номер VDB)")
    a = p.parse_args(argv)
    a.frames = tuple(int(x) for x in a.frames.split("-"))
    a.out = os.path.abspath(a.out)
    a.vdb = os.path.abspath(a.vdb)
    return a


def setup_scene(a):
    sc = bpy.context.scene
    for ob in list(sc.objects):  # стартовые куб, лампа и камера
        bpy.data.objects.remove(ob, do_unlink=True)
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.cycles.volume_step_rate = 1.0
    sc.cycles.volume_max_steps = 512
    sc.cycles.max_bounces = 4
    sc.cycles.volume_bounces = 1
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:
        print("GPU off:", e)
    sc.render.resolution_x = sc.render.resolution_y = a.size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    st = sc.render.image_settings
    st.file_format = "OPEN_EXR"
    st.color_mode = "RGBA"
    st.color_depth = "16"
    st.exr_codec = "ZIP"
    # Слабый холодный свет мира: дым читается тёмно-сливовым, а не провалом
    world = bpy.data.worlds.new("BlastWorld")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0.11, 0.09, 0.12, 1)
    bg.inputs["Strength"].default_value = a.ambient
    sc.world = world
    return sc


def blast_material(a):
    m = bpy.data.materials.new("BlastVDB")
    m.use_nodes = True
    m.cycles.volume_interpolation = "CUBIC"
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    nt.links.new(pv.outputs[0], out.inputs["Volume"])

    flame = nt.nodes.new("ShaderNodeAttribute")
    flame.attribute_name = "flames"
    norm = nt.nodes.new("ShaderNodeMath")
    norm.operation = "DIVIDE"
    norm.use_clamp = True
    norm.inputs[1].default_value = a.range
    nt.links.new(flame.outputs["Fac"], norm.inputs[0])
    # Пламя: тёмно-красный → #ff8a3d → светло-оранжевый, без жёлто-белого
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "B_SPLINE"
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.0, 0.0, 0.0, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = tuple(float(x) for x in a.top.split(",")) + (1,)
    for pos, col in ((0.1, (0.20, 0.02, 0.005, 1)), (0.3, (0.70, 0.09, 0.012, 1)),
                     (0.6, (1.0, 0.25, 0.046, 1))):   # 0.6 ≈ #ff8a3d в линейном
        cr.elements.new(pos).color = col
    nt.links.new(norm.outputs[0], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], pv.inputs["Emission Color"])
    st = nt.nodes.new("ShaderNodeMath")
    st.operation = "MULTIPLY"
    st.inputs[1].default_value = a.glow
    nt.links.new(flame.outputs["Fac"], st.inputs[0])
    nt.links.new(st.outputs[0], pv.inputs["Emission Strength"])

    dens = nt.nodes.new("ShaderNodeAttribute")
    dens.attribute_name = "density"
    dm = nt.nodes.new("ShaderNodeMath")
    dm.operation = "MULTIPLY"
    dm.inputs[1].default_value = a.smoke
    nt.links.new(dens.outputs["Fac"], dm.inputs[0])
    nt.links.new(dm.outputs[0], pv.inputs["Density"])
    # Обсидиановый дым: почти чёрный с лиловым отливом (#1a1418)
    k = a.albedo / 0.010
    pv.inputs["Color"].default_value = (0.010 * k, 0.007 * k, 0.009 * k, 1)
    pv.inputs["Blackbody Intensity"].default_value = 0.0
    return m


def build(sc, a):
    files = sorted(glob.glob(os.path.join(a.vdb, "*.vdb")))
    if not files:
        sys.exit("нет .vdb в " + a.vdb)
    vol = bpy.data.volumes.new("Blast")
    vol.filepath = files[0]
    vol.is_sequence = True
    vol.frame_duration = len(files)
    vol.frame_start = 1          # кадр сцены 1 = файл _0000
    vol.sequence_mode = "CLIP"
    ob = bpy.data.objects.new("Blast", vol)
    sc.collection.objects.link(ob)
    ob.scale = (0.01, 0.01, 0.01)
    # Сверху облако вытянуто (≈1,5 : 1, ось под 55°): поворачиваем длинной
    # осью вдоль X и сжимаем по X пустышкой-родителем — взрыв круглее.
    ob.rotation_euler = (0, 0, math.radians(a.yaw))
    root = bpy.data.objects.new("BlastRoot", None)
    sc.collection.objects.link(root)
    root.scale = (a.squash, 1.0, 1.0)
    ob.parent = root
    vol.materials.append(blast_material(a))

    # Тёплый свет из сердца взрыва: подсвечивает дым изнутри — «огненные края»
    ld = bpy.data.lights.new("Core", "POINT")
    ld.color = (1.0, 0.45, 0.16)
    ld.energy = 60.0
    ld.shadow_soft_size = 0.5
    lo = bpy.data.objects.new("Core", ld)
    lo.location = (0, 0, GROUND_Z + 0.35)
    sc.collection.objects.link(lo)

    cam_data = bpy.data.cameras.new("BlastCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = a.scale
    cam_data.clip_end = 100
    cam = bpy.data.objects.new("BlastCam", cam_data)
    sc.collection.objects.link(cam)
    e = math.radians(a.elev)
    aim = (0.0, 0.0, GROUND_Z + a.aim)
    cam.location = (aim[0], aim[1] - 10 * math.cos(e), aim[2] + 10 * math.sin(e))
    cam.rotation_euler = (math.pi / 2 - e, 0, 0)
    sc.camera = cam


def srgb(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0.0031308), 1 / 2.4) - 0.055)


def write_png(path, rgba8):
    h, w, _ = rgba8.shape
    raw = b"".join(b"\x00" + rgba8[y].tobytes() for y in range(h))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as fp:
        fp.write(b"\x89PNG\r\n\x1a\n")
        fp.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        fp.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        fp.write(chunk(b"IEND", b""))


def soft(x, k):
    """Мягкое колено: до k как есть, выше плавно к 1."""
    return np.where(x > k, k + (1 - k) * (1 - np.exp(-(x - k) / (1 - k))), x)


def exr_to_png(exr, png, exposure, KNEE, mode):
    """EXR (линейный, альфа умножена) → PNG RGBA 8 бит без умножения, sRGB."""
    img = bpy.data.images.load(exr)
    img.alpha_mode = "CHANNEL_PACKED"   # как в файле, без пересчёта альфы
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    px = px.reshape(h, w, 4)[::-1]       # у Blender строки снизу вверх
    c = np.maximum(px[..., :3] * exposure, 0.0)
    if mode == "hue":
        # Колено по самому яркому каналу, оттенок не меняется
        m = c.max(axis=2, keepdims=True)
        c = np.where(m > 1e-6, c * soft(m, KNEE) / np.maximum(m, 1e-6), 0.0)
    else:
        # Колено по каждому каналу: яркое уходит в жёлто-оранжевое, но синий
        # у пламени мал, и до белого пятна (вспышки) не доходит
        c = soft(c, KNEE)
    a = np.clip(np.maximum(px[..., 3], c.max(axis=2)), 0.0, 1.0)
    straight = np.where(a[..., None] > 1e-4, c / np.maximum(a[..., None], 1e-4), 0.0)
    out = np.empty((h, w, 4), dtype=np.uint8)
    out[..., :3] = np.round(srgb(np.clip(straight, 0, 1)) * 255)
    out[..., 3] = np.round(a * 255)
    out[out[..., 3] == 0, :3] = 0
    write_png(png, out)
    return float((px[..., :3].max(axis=2) > px[..., 3] + 1e-3).mean())


def render(sc, a):
    t = time.time()
    if a.only is not None:
        nums = [a.only]
    elif a.list:
        nums = [int(x) for x in a.list.split(",")]
    else:
        nums = list(range(a.frames[0], a.frames[1] + 1, a.step))
    exr_dir = os.path.join(a.out, "exr")
    os.makedirs(exr_dir, exist_ok=True)
    for i, n in enumerate(nums):
        sc.frame_set(n + 1)              # файл VDB n = кадр сцены n + 1
        exr = os.path.join(exr_dir, "f_%04d.exr" % i)
        sc.render.filepath = exr
        bpy.ops.render.render(write_still=True)
        emit = exr_to_png(exr, os.path.join(a.out, "f_%04d.png" % i), a.exposure, a.knee, a.tone)
        print("FRAME %d (vdb %d) emissive>alpha %.1f%%" % (i, n, emit * 100))
    print("RENDER", len(nums), "frames", round(time.time() - t, 1), "s")


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    sc = setup_scene(a)
    build(sc, a)
    render(sc, a)


main()
