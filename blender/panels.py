"""
Генератор каменных панелей и рамки игрового поля «Сокровищ Солнца».

Запуск (headless):
    /Applications/Blender.app/Contents/MacOS/Blender --background --python blender/panels.py

Опции после `--`:
    --part NAME    stone | frame | all (по умолчанию all)
    --out DIR      куда писать PNG (по умолчанию assets/ui)
    --samples N    сэмплов Cycles (по умолчанию 128)
"""

import bpy
import bmesh
import math
import os
import shutil
import subprocess
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gems  # noqa: E402
import ui  # noqa: E402  (gradient_material)

PROJECT = gems.PROJECT
OUT_DIR = gems.arg("--out", os.path.join(PROJECT, "assets", "ui"))
SAMPLES = gems.arg("--samples", 128, int)
PART = gems.arg("--part", "all")

gradient_material = ui.gradient_material


def to_webp(png_path, quality=92):
    """Пережимаем PNG в WebP: меньше вес, выше чёткость на Retina."""
    webp = os.path.splitext(png_path)[0] + ".webp"
    exe = shutil.which("cwebp")
    if not exe:
        print("WEBP SKIP (cwebp not found), kept", png_path)
        return
    subprocess.run([exe, "-q", str(quality), "-alpha_q", "100", "-m", "6",
                    "-quiet", png_path, "-o", webp], check=True)
    os.remove(png_path)
    print("WEBP", webp)


# ---------------------------------------------------------------------------
# Материалы
# ---------------------------------------------------------------------------

def stone_nodes(name, dark, mid, light, crack, speck, scale=7.0, bump=0.0,
                albedo=False, vein_amt=0.30):
    """Процедурный камень: пятна, прожилки, мелкая крошка."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nodes, links = nt.nodes, nt.links
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)

    coord = nodes.new("ShaderNodeTexCoord")
    coord.location = (-1600, 200)

    # крупные пятна породы
    noise = nodes.new("ShaderNodeTexNoise")
    noise.location = (-1400, 320)
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 9.0
    noise.inputs["Roughness"].default_value = 0.58
    links.new(coord.outputs["Generated"], noise.inputs["Vector"])

    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-1180, 320)
    ramp.color_ramp.interpolation = "EASE"
    e0, e1 = ramp.color_ramp.elements
    e0.position, e0.color = 0.24, (*gems.srgb(dark), 1.0)
    e1.position, e1.color = 0.82, (*gems.srgb(light), 1.0)
    ramp.color_ramp.elements.new(0.52).color = (*gems.srgb(mid), 1.0)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    # тёмные прожилки по границам ячеек
    vor = nodes.new("ShaderNodeTexVoronoi")
    vor.location = (-1400, 20)
    vor.feature = "DISTANCE_TO_EDGE"
    vor.inputs["Scale"].default_value = scale * 1.35
    vor.inputs["Randomness"].default_value = 0.9
    links.new(coord.outputs["Generated"], vor.inputs["Vector"])

    vein = nodes.new("ShaderNodeValToRGB")
    vein.location = (-1180, 20)
    vein.color_ramp.interpolation = "EASE"
    v0, v1 = vein.color_ramp.elements
    v0.position, v0.color = 0.0, (*gems.srgb(crack), 1.0)
    v1.position, v1.color = 0.032, (1.0, 1.0, 1.0, 1.0)
    links.new(vor.outputs["Distance"], vein.inputs["Fac"])

    mix1 = nodes.new("ShaderNodeMixRGB")
    mix1.location = (-920, 220)
    mix1.blend_type = "MULTIPLY"
    mix1.inputs["Factor"].default_value = vein_amt
    links.new(ramp.outputs["Color"], mix1.inputs["Color1"])
    links.new(vein.outputs["Color"], mix1.inputs["Color2"])

    # мелкая крошка
    grain = nodes.new("ShaderNodeTexNoise")
    grain.location = (-1400, -280)
    grain.inputs["Scale"].default_value = scale * 22.0
    grain.inputs["Detail"].default_value = 3.0
    grain.inputs["Roughness"].default_value = 0.5
    links.new(coord.outputs["Generated"], grain.inputs["Vector"])

    speck_ramp = nodes.new("ShaderNodeValToRGB")
    speck_ramp.location = (-1180, -280)
    speck_ramp.color_ramp.interpolation = "CONSTANT"
    s0, s1 = speck_ramp.color_ramp.elements
    s0.position, s0.color = 0.0, (0.5, 0.5, 0.5, 1.0)
    s1.position, s1.color = 0.72, (*gems.srgb(speck), 1.0)
    links.new(grain.outputs["Fac"], speck_ramp.inputs["Fac"])

    mix2 = nodes.new("ShaderNodeMixRGB")
    mix2.location = (-700, 120)
    mix2.blend_type = "OVERLAY"
    mix2.inputs["Factor"].default_value = 0.14
    links.new(mix1.outputs["Color"], mix2.inputs["Color1"])
    links.new(speck_ramp.outputs["Color"], mix2.inputs["Color2"])

    if bump:
        bmp = nodes.new("ShaderNodeBump")
        bmp.location = (-500, -220)
        bmp.inputs["Strength"].default_value = bump
        bmp.inputs["Distance"].default_value = 0.004
        links.new(grain.outputs["Fac"], bmp.inputs["Height"])

    if albedo:
        if bsdf:
            nodes.remove(bsdf)
        em = nodes.new("ShaderNodeEmission")
        em.location = (-400, 120)
        em.inputs["Strength"].default_value = 1.0
        links.new(mix2.outputs["Color"], em.inputs["Color"])
        links.new(em.outputs[0], out.inputs["Surface"])
    elif bsdf:
        links.new(mix2.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.78
        if "Coat Weight" in bsdf.inputs:
            bsdf.inputs["Coat Weight"].default_value = 0.0
        if bump:
            links.new(bmp.outputs["Normal"], bsdf.inputs["Normal"])
        links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat


def frame_stone():
    return stone_nodes("panel_stone", "#3a3428", "#57503d", "#6f6650",
                       "#221d15", "#7d7358", scale=5.0, bump=0.4)


def frame_gold():
    return gradient_material("panel_gold", "#fff2bc", "#e8c063", "#7a4c0c",
                             roughness=0.22, coat=0.5, metallic=0.3, span=0.55)


# ---------------------------------------------------------------------------
# Геометрия
# ---------------------------------------------------------------------------

def rrect(w, h, r, seg=10):
    """Замкнутый контур скруглённого прямоугольника в плоскости XZ."""
    hw, hh = w * 0.5, h * 0.5
    r = max(0.0005, min(r, hw, hh))
    pts = []
    corners = ((hw - r, hh - r, 0.0), (-hw + r, hh - r, 90.0),
               (-hw + r, -hh + r, 180.0), (hw - r, -hh + r, 270.0))
    for cx, cz, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90.0 * i / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    pts.pop()  # последняя точка совпадает с первой
    return pts


def ring_mesh(name, outer, inner, depth, mat):
    """Плоское кольцо из двух контуров, выдавленное по Y."""
    n = len(outer)
    y0, y1 = -depth * 0.5, depth * 0.5
    verts = []
    for layer in (y0, y1):
        for x, z in outer:
            verts.append((x, layer, z))
        for x, z in inner:
            verts.append((x, layer, z))

    faces = []
    for i in range(n):
        j = (i + 1) % n
        o0, o1 = i, j
        i0, i1 = n + i, n + j
        bo0, bo1 = 2 * n + i, 2 * n + j
        bi0, bi1 = 3 * n + i, 3 * n + j
        faces.append((o0, o1, i1, i0))          # передняя грань
        faces.append((bi0, bi1, bo1, bo0))      # задняя грань
        faces.append((o0, bo0, bo1, o1))        # внешняя стенка
        faces.append((i0, i1, bi1, bi0))        # внутренняя стенка

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()

    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    return ob


def bevel(ob, width=0.004, segments=3):
    mod = ob.modifiers.new("Bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(30)
    ob.data.shade_smooth()
    return mod


def diamond(name, size, loc, mat, depth=0.012, bevel_w=0.0025):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.scale = (size, depth, size)
    ob.rotation_euler = (0.0, math.radians(45), 0.0)
    ob.data.materials.append(mat)
    bevel(ob, bevel_w, 2)
    return ob


def stud(name, radius, loc, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12,
                                         radius=radius, location=loc)
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    ob.data.shade_smooth()
    return ob


# ---------------------------------------------------------------------------
# Рамка поля
# ---------------------------------------------------------------------------

def build_frame():
    m_stone = frame_stone()
    m_gold = frame_gold()

    outer = rrect(1.0, 1.0, 0.050, 12)
    inner = rrect(0.928, 0.928, 0.032, 12)

    band = ring_mesh("frame_band", outer, inner, 0.038, m_stone)
    bevel(band, 0.010, 4)

    objs = [band]

    # золотые канты по внешнему и внутреннему краю
    for name, w, r, depth, y in (
        ("frame_gold_out", 0.986, 0.046, 0.014, -0.022),
        ("frame_gold_in", 0.940, 0.036, 0.014, -0.022),
    ):
        ring = ring_mesh(name, rrect(w, w, r, 12),
                         rrect(w - 0.006, w - 0.006, max(r - 0.003, 0.004), 12),
                         depth, m_gold)
        ring.location = (0.0, y, 0.0)
        bevel(ring, 0.0016, 2)
        objs.append(ring)

    # угловые ромбы
    off = 0.5 - 0.030
    for sx in (-1, 1):
        for sz in (-1, 1):
            objs.append(diamond("frame_corner_%d%d" % (sx, sz), 0.046,
                                (sx * off, -0.032, sz * off), m_gold))
            objs.append(stud("frame_stud_%d%d" % (sx, sz), 0.0060,
                             (sx * off, -0.046, sz * off), m_gold))

    # заклёпки посередине сторон
    for i, (x, z) in enumerate(((0, 0.5 - 0.024), (0, -0.5 + 0.024),
                                (-0.5 + 0.024, 0), (0.5 - 0.024, 0))):
        objs.append(stud("frame_mid_%d" % i, 0.0055, (x, -0.028, z), m_gold))

    return objs


def render_frame():
    sc = gems.reset_scene()
    sc.cycles.samples = SAMPLES
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 1280
    sc.render.film_transparent = True

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.03, 0.032, 0.04, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    sc.world = world

    gems.add_light("key", (-1.5, -2.4, 1.9), 1.6, 420, (1.0, 0.96, 0.89))
    gems.add_light("fill", (2.1, -2.0, 0.4), 2.2, 120, (0.82, 0.91, 1.0))
    gems.add_light("rim", (0.5, 2.4, 1.2), 1.4, 260, (1.0, 0.88, 0.70))
    gems.add_light("top", (0.0, -1.0, 2.6), 1.6, 90, (1.0, 1.0, 1.0))

    cd = bpy.data.cameras.new("Camera")
    cd.type = "ORTHO"
    cd.ortho_scale = 1.0
    cam = bpy.data.objects.new("Camera", cd)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -6.0, 0.0)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    sc.camera = cam
    bpy.context.view_layer.update()

    build_frame()
    png = os.path.join(OUT_DIR, "board-frame.png")
    gems.render(png)
    to_webp(png, 92)


# ---------------------------------------------------------------------------
# Бесшовная текстура камня для панелей
# ---------------------------------------------------------------------------

def render_stone():
    sc = gems.reset_scene()
    sc.cycles.samples = 48
    sc.render.resolution_x = 768
    sc.render.resolution_y = 768
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    bg.inputs["Strength"].default_value = 0.0
    sc.world = world

    bpy.ops.mesh.primitive_plane_add(size=2.0, location=(0, 0, 0),
                                     rotation=(math.pi / 2, 0, 0))
    plane = bpy.context.object
    plane.name = "stone_plane"
    mat = stone_nodes("panel_albedo", "#2a251c", "#3d372a", "#524a38",
                      "#18140e", "#665c48", scale=8.0, albedo=True, vein_amt=0.12)
    plane.data.materials.append(mat)

    cd = bpy.data.cameras.new("Camera")
    cd.type = "ORTHO"
    cd.ortho_scale = 2.0
    cam = bpy.data.objects.new("Camera", cd)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -6.0, 0.0)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    sc.camera = cam
    bpy.context.view_layer.update()

    png = os.path.join(OUT_DIR, "stone.png")
    gems.render(png)
    to_webp(png, 88)


def main():
    if PART in ("frame", "all"):
        render_frame()
    if PART in ("stone", "all"):
        render_stone()


if __name__ == "__main__":
    main()
