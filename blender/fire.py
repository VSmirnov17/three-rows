"""Огонь в жаровне «Хранителя Солнца»: симуляция Mantaflow (газ с огнём).

Рендер идёт на чёрном фоне, кадры 288×256 PNG. Прозрачность и спрайт-листы
делает tools/pack_fire.py (альфа = max(R,G,B), цвет делится на альфу,
цикл склеивается перекрёстным затуханием).

Запуск без интерфейса (кэш симуляции пишется в <out>/cache, в git не идёт):
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
      --python blender/fire.py -- --out art-src/phase2/fire/calm \
      [--variant calm|flare] [--bake 1-160] [--render 61-120] \
      [--res 96] [--samples 64] [--size 256x384]

Варианты:
  calm  — ровное спокойное горение, из него собирается цикл;
  flare — то же горение, но на кадрах 70–76 топливо и жар источника растут
          втрое и потом возвращаются: высокий сноп и спад.
"""
import argparse
import os
import sys
import time

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--variant", default="calm", choices=["calm", "flare"])
    p.add_argument("--bake", default="1-160")
    p.add_argument("--render", default="61-120")
    p.add_argument("--res", type=int, default=96)
    p.add_argument("--samples", type=int, default=64)
    p.add_argument("--size", default="288x256")
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--fuel", type=float, default=1.6, help="подача топлива")
    p.add_argument("--burn", type=float, default=0.55, help="скорость сгорания")
    p.add_argument("--dist", type=float, default=0.3, help="толщина зоны выброса")
    p.add_argument("--domain", default="1.6x0.7x1.4", help="ширина x глубина x высота домена")
    p.add_argument("--src", default="2.6x1.2", help="растяжение источника по x и y")
    a = p.parse_args(argv)
    a.bake = tuple(int(x) for x in a.bake.split("-"))
    a.render = tuple(int(x) for x in a.render.split("-"))
    a.size = tuple(int(x) for x in a.size.split("x"))
    a.domain = tuple(float(x) for x in a.domain.split("x"))
    a.src = tuple(float(x) for x in a.src.split("x"))
    a.out = os.path.abspath(a.out)
    return a


# Размер домена задаёт --domain; пропорция ширины к высоте совпадает с кадром --size.
# Жар источника в спокойном горении; вспышка умножает его и топливо втрое
BASE_TEMP = 1.5


def setup_scene(a):
    if bpy.app.background:
        sc = bpy.context.scene
        # В стартовой сцене стоят куб, лампа и камера — куб закрыл бы пламя
        for ob in list(sc.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    else:  # в живом Blender — отдельная сцена, остальные не трогаем
        sc = bpy.data.scenes.new("SunFire")
        bpy.context.window.scene = sc
    # Ключи анимации подачи топлива — линейные
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    sc.frame_start, sc.frame_end = a.bake
    sc.render.fps = 24
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.cycles.volume_step_rate = 1.0
    sc.cycles.volume_max_steps = 512
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:  # нет GPU — считаем на CPU
        print("GPU off:", e)
    sc.render.resolution_x, sc.render.resolution_y = a.size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    world = bpy.data.worlds.new("FireWorld")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
    bg.inputs["Strength"].default_value = 0.0
    sc.world = world
    return sc


def link(sc, ob):
    sc.collection.objects.link(ob)
    return ob


def box_mesh(name, w, d, h):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w
        v.co.y *= d
        v.co.z *= h  # начало координат в центре домена
    bm.to_mesh(me)
    bm.free()
    return me


def disc_mesh(name, r, depth, verts=48):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts,
                          radius1=r, radius2=r * 0.85, depth=depth)
    bm.to_mesh(me)
    bm.free()
    return me


def fire_material():
    m = bpy.data.materials.new("FireVolume")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    pv = nt.nodes.new("ShaderNodeVolumePrincipled")
    nt.links.new(pv.outputs[0], out.inputs["Volume"])

    flame = nt.nodes.new("ShaderNodeAttribute")
    flame.attribute_name = "flame"
    dens = nt.nodes.new("ShaderNodeAttribute")
    dens.attribute_name = "density"

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.0, 0.0, 0.0, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (1.0, 0.93, 0.75, 1)
    for pos, col in ((0.12, (0.35, 0.03, 0.0, 1)), (0.35, (0.95, 0.22, 0.02, 1)),
                     (0.6, (1.0, 0.52, 0.08, 1)), (0.82, (1.0, 0.78, 0.35, 1))):
        e = cr.elements.new(pos)
        e.color = col
    nt.links.new(flame.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], pv.inputs["Emission Color"])

    # Яркость ~ flame^1.6: сердцевина горит, кончики язычков тонкие
    shape = nt.nodes.new("ShaderNodeMath")
    shape.operation = "POWER"
    shape.inputs[1].default_value = 1.6
    nt.links.new(flame.outputs["Fac"], shape.inputs[0])
    strength = nt.nodes.new("ShaderNodeMath")
    strength.operation = "MULTIPLY"
    strength.inputs[1].default_value = 28.0
    nt.links.new(shape.outputs[0], strength.inputs[0])
    nt.links.new(strength.outputs[0], pv.inputs["Emission Strength"])

    # Дыма почти нет, чтобы на чёрном фоне не было серой пелены
    dmul = nt.nodes.new("ShaderNodeMath")
    dmul.operation = "MULTIPLY"
    dmul.inputs[1].default_value = 0.04
    nt.links.new(dens.outputs["Fac"], dmul.inputs[0])
    nt.links.new(dmul.outputs[0], pv.inputs["Density"])
    pv.inputs["Color"].default_value = (0.05, 0.04, 0.035, 1)
    pv.inputs["Blackbody Intensity"].default_value = 0.0
    return m


def build(sc, a):
    DOM_W, DOM_D, DOM_H = a.domain
    dom = link(sc, bpy.data.objects.new("FireDomain", box_mesh("FireDomainMesh", DOM_W, DOM_D, DOM_H)))
    dom.location = (0, 0, DOM_H / 2)  # низ домена на z=0
    src = link(sc, bpy.data.objects.new("FireSource", disc_mesh("FireSourceMesh", 0.2, 0.05)))
    src.location = (0, 0, 0.1)
    src.scale = (a.src[0], a.src[1], 1.0)  # широкое основание, как жар в чаше
    src.hide_render = True       # в кадре только пламя

    md = dom.modifiers.new("Fluid", "FLUID")
    md.fluid_type = "DOMAIN"
    d = md.domain_settings
    d.domain_type = "GAS"
    d.resolution_max = a.res
    d.use_adaptive_domain = False
    d.alpha = 0.6          # плотность почти не тянет вверх
    d.beta = 1.8           # жар тянет вверх — высокий язык
    d.vorticity = 0.4
    d.burning_rate = a.burn
    d.flame_smoke = 0.15
    d.flame_vorticity = 0.9
    d.flame_ignition = 1.5
    d.flame_max_temp = 3.0
    d.use_dissolve_smoke = True
    d.dissolve_speed = 12
    d.use_noise = True
    d.noise_scale = 2
    d.noise_strength = 1.5
    d.cache_type = "ALL"
    d.cache_directory = os.path.join(a.out, "cache")
    d.cache_frame_start, d.cache_frame_end = a.bake
    dom.data.materials.append(fire_material())

    mf = src.modifiers.new("Fluid", "FLUID")
    mf.fluid_type = "FLOW"
    f = mf.flow_settings
    f.flow_type = "FIRE"
    f.flow_behavior = "INFLOW"
    f.flow_source = "MESH"
    f.surface_distance = a.dist
    f.fuel_amount = a.fuel
    f.temperature = BASE_TEMP
    f.subframes = 2
    f.use_initial_velocity = True
    f.velocity_normal = 1.2
    # Неровная подача топлива — язычки пламени живут сами по себе
    tex = bpy.data.textures.new("FireFlowNoise", "CLOUDS")
    tex.noise_scale = 0.45
    tex.noise_depth = 2
    f.use_texture = True
    f.noise_texture = tex
    f.texture_map_type = "AUTO"
    f.texture_size = 1.0
    f.texture_offset = 0.0
    f.keyframe_insert("texture_offset", frame=a.bake[0])
    f.texture_offset = (a.bake[1] - a.bake[0]) * 0.03
    f.keyframe_insert("texture_offset", frame=a.bake[1])

    if a.variant == "flare":
        for frame, k in ((69, 1.0), (71, 3.0), (75, 3.0), (79, 1.0)):
            fuel, temp = a.fuel * k, BASE_TEMP * k
            f.fuel_amount, f.temperature = fuel, temp
            f.keyframe_insert("fuel_amount", frame=frame)
            f.keyframe_insert("temperature", frame=frame)

    cam_data = bpy.data.cameras.new("FireCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(DOM_W, DOM_H)
    cam = link(sc, bpy.data.objects.new("FireCam", cam_data))
    cam.location = (0, -5, DOM_H / 2)
    cam.rotation_euler = (1.5707963, 0, 0)
    sc.camera = cam
    return dom


def bake(sc, dom):
    t = time.time()
    win = bpy.context.window
    override = {"scene": sc, "object": dom, "active_object": dom}
    if win:
        override["window"] = win
    with bpy.context.temp_override(**override):
        r = bpy.ops.fluid.bake_all()
    print("BAKE", r, round(time.time() - t, 1), "s")


def render(sc, a):
    t = time.time()
    sc.frame_start, sc.frame_end = a.render
    sc.render.filepath = os.path.join(a.out, "f_")
    override = {"scene": sc}
    if bpy.context.window:
        override["window"] = bpy.context.window
    with bpy.context.temp_override(**override):
        bpy.ops.render.render(animation=True, scene=sc.name)
    n = a.render[1] - a.render[0] + 1
    print("RENDER", n, "frames", round(time.time() - t, 1), "s")


def main():
    a = parse_args()
    os.makedirs(a.out, exist_ok=True)
    sc = setup_scene(a)
    dom = build(sc, a)
    bake(sc, dom)
    if not a.no_render:
        render(sc, a)


main()
