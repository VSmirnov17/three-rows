"""Огонь в жаровне из готовой симуляции EmberGen (VDB, лицензия CC0).

Источник: «Small Camp Fire» из бесплатного набора JangaFX
https://jangafx.com/software/embergen/download/free-vdb-animations/
(CC0 — Public Domain). Архив `SmallCampfireVDB.zip`, 200 кадров
`smallCampfire_0000.vdb … _0199.vdb`, поля `flames` и `density`.
В git не кладётся (около 400 МБ): скачать и распаковать вне проекта.

Рендер идёт на чёрном фоне, дым выключен, светится только поле `flames`.
Прозрачность и спрайт-листы делает tools/pack_fire.py.

  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python blender/fire_vdb.py -- --vdb <папка с smallCampfire_*.vdb> \
      --out <папка кадров> [--render 60-131] [--size 448x384] [--samples 64] \
      [--center 0x-1.2] [--scale 1.3] [--glow 6] [--speed 1]

--center и --scale задают кадр ортокамеры (в метрах после масштаба 0.01):
центр по X и Z и ширину кадра. --speed > 1 берёт каждый n-й кадр VDB
(огонь быстрее), < 1 не поддерживается.
"""
import argparse
import glob
import os
import sys
import time

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--vdb", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--render", default="60-131", help="кадры VDB (номера файлов)")
    p.add_argument("--size", default="448x384")
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--center", default="0x-1.2", help="центр кадра X x Z")
    p.add_argument("--scale", type=float, default=1.3, help="ширина кадра")
    p.add_argument("--glow", type=float, default=6.0, help="яркость пламени")
    p.add_argument("--smoke", type=float, default=0.0, help="плотность дыма (0 — нет)")
    p.add_argument("--only", type=int, help="отрендерить один кадр (номер VDB)")
    p.add_argument("--view", default="Standard", help="преобразование цвета: Standard, AgX")
    p.add_argument("--range", type=float, default=1.0, help="значение flames, которому отвечает конец градиента")
    a = p.parse_args(argv)
    a.render = tuple(int(x) for x in a.render.split("-"))
    a.size = tuple(int(x) for x in a.size.split("x"))
    a.center = tuple(float(x) for x in a.center.split("x"))
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
    sc.cycles.volume_step_rate = 0.5
    sc.cycles.volume_max_steps = 1024
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:
        print("GPU off:", e)
    sc.render.resolution_x, sc.render.resolution_y = a.size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = a.view
    sc.view_settings.look = "None"
    world = bpy.data.worlds.new("FireWorld")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
    bg.inputs["Strength"].default_value = 0.0
    sc.world = world
    return sc


def fire_material(a):
    m = bpy.data.materials.new("FireVDB")
    m.use_nodes = True
    m.cycles.volume_interpolation = "CUBIC"  # без ступенек на краях языков
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
    # Цвет пламени: тёмно-красные кончики → оранжевое тело → жёлто-белая сердцевина
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "B_SPLINE"
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.0, 0.0, 0.0, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (1.0, 0.95, 0.8, 1)
    for pos, col in ((0.08, (0.25, 0.02, 0.0, 1)), (0.25, (0.85, 0.16, 0.01, 1)),
                     (0.5, (1.0, 0.42, 0.04, 1)), (0.75, (1.0, 0.72, 0.25, 1))):
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
    pv.inputs["Color"].default_value = (0.04, 0.035, 0.03, 1)
    pv.inputs["Blackbody Intensity"].default_value = 0.0
    return m


def build(sc, a):
    files = sorted(glob.glob(os.path.join(a.vdb, "*.vdb")))
    if not files:
        sys.exit("нет .vdb в " + a.vdb)
    vol = bpy.data.volumes.new("Campfire")
    vol.filepath = files[0]
    vol.is_sequence = True
    vol.frame_duration = len(files)
    vol.frame_start = 1          # кадр сцены 1 = файл _0000
    vol.sequence_mode = "CLIP"
    ob = bpy.data.objects.new("Campfire", vol)
    sc.collection.objects.link(ob)
    ob.scale = (0.01, 0.01, 0.01)
    vol.materials.append(fire_material(a))

    cam_data = bpy.data.cameras.new("FireCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = a.scale * max(1.0, a.size[1] / a.size[0])
    cam = bpy.data.objects.new("FireCam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (a.center[0], -10, a.center[1])
    cam.rotation_euler = (1.5707963, 0, 0)
    sc.camera = cam


def render(sc, a):
    t = time.time()
    first, last = (a.only, a.only) if a.only is not None else a.render
    # Номер файла VDB n соответствует кадру сцены n + 1
    sc.frame_start, sc.frame_end = first + 1, last + 1
    sc.render.filepath = os.path.join(a.out, "f_")
    bpy.ops.render.render(animation=True)
    print("RENDER", last - first + 1, "frames", round(time.time() - t, 1), "s")


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    sc = setup_scene(a)
    build(sc, a)
    render(sc, a)


main()
