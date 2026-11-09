#!/usr/bin/env python3
"""Сборка спрайт-листа удара бомбы из кадров blender/explosion_vdb.py.

Кадры уже RGBA без умножения на альфу (дым — настоящая альфа, огонь —
max(альфа, яркость)), поэтому альфу здесь не пересчитываем, в отличие
от tools/pack_fire.py.

Лист — одна строка кадров: CSS листает её одной анимацией
background-position со steps() (css/fx.css). Кадр обрезается
симметрично вокруг места взрыва (центр тяжести альфы первых кадров),
поэтому центр узла .fx-bomb — точка удара. Между кадрами — прозрачные
поля (--pad), чтобы при масштабе соседний кадр не просвечивал.

Нужен только Pillow и cwebp (/opt/homebrew/bin/cwebp).

  python3 tools/pack_strike.py <кадры> assets/fx/bomb.webp --json assets/fx/bomb.json \
      [--width 256] [--q 74] [--preview out.webp]
  python3 tools/pack_strike.py --check      # число кадров и размер листа, выход 0 — в норме
"""
import argparse
import glob
import json
import math
import os
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEF_SHEET = os.path.join(ROOT, "assets", "fx", "bomb.webp")
DEF_JSON = os.path.join(ROOT, "assets", "fx", "bomb.json")
MAX_FRAMES = 24
MAX_KB = 400
MAX_FRAME_PX = 256
THR = 10              # альфа, с которой пиксель считается облаком
PREVIEW_BG = (15, 26, 20)


def load_frames(src):
    files = sorted(glob.glob(os.path.join(src, "f_*.png")))
    if not files:
        sys.exit("нет кадров f_*.png в " + src)
    return [Image.open(f).convert("RGBA") for f in files]


def alpha_points(im):
    """Пиксели облака: (x, y, a) с альфой больше THR."""
    w, _ = im.size
    a = im.getchannel("A")
    data = a.get_flattened_data() if hasattr(a, "get_flattened_data") else a.getdata()
    return [(i % w, i // w, v) for i, v in enumerate(data) if v > THR], w


def origin_of(frames, first=6):
    """Место взрыва — центр тяжести альфы первых кадров (в пикселях)."""
    s = sx = sy = 0.0
    for im in frames[:first]:
        pts, _ = alpha_points(im)
        for x, y, v in pts:
            s += v
            sx += v * x
            sy += v * y
    return sx / s, sy / s


def reach(frames, ox, oy):
    """Наибольшее удаление облака от места взрыва по всем кадрам (px)."""
    r = 0.0
    for im in frames:
        b = im.getchannel("A").point(lambda v: 255 if v > THR else 0).getbbox()
        if b:
            r = max(r, ox - b[0], b[2] - ox, oy - b[1], b[3] - oy)
    return r


def span_of(im, ox, oy):
    """Поперечник облака (по альфе > THR) в долях кадра: среднее X и Y."""
    b = im.getchannel("A").point(lambda v: 255 if v > THR else 0).getbbox()
    if not b:
        return 0.0
    w, h = im.size
    return ((b[2] - b[0]) / w + (b[3] - b[1]) / h) / 2


def crop_centered(frames, ox, oy, half):
    """Квадрат 2·half вокруг (ox, oy); вне исходного кадра — прозрачно."""
    side = int(math.ceil(half * 2))
    out = []
    for im in frames:
        c = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        c.paste(im, (int(round(side / 2 - ox)), int(round(side / 2 - oy))))
        out.append(c)
    return out


def border_alpha(im):
    """Наибольшая альфа на рамке кадра: облако не должно упираться в край."""
    a = im.getchannel("A")
    w, h = a.size
    edges = [a.crop((0, 0, w, 1)), a.crop((0, h - 1, w, h)), a.crop((0, 0, 1, h)), a.crop((w - 1, 0, w, h))]
    return max(e.getextrema()[1] for e in edges)


def strip(frames):
    fw, fh = frames[0].size
    out = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.paste(f, (i * fw, 0))
    return out


def preview(frames, path, fps):
    bg = Image.new("RGBA", frames[0].size, PREVIEW_BG + (255,))
    shown = [Image.alpha_composite(bg, f).convert("RGB") for f in frames]
    shown[0].save(path, save_all=True, append_images=shown[1:], duration=round(1000 / fps), loop=0)


def check(sheet, meta_path):
    """Лист на месте, кадров не больше 24, размер не больше 400 КБ, сетка сходится с json."""
    ok = True
    if not os.path.exists(sheet) or not os.path.exists(meta_path):
        print("нет", sheet if not os.path.exists(sheet) else meta_path)
        return 1
    meta = json.load(open(meta_path, encoding="utf-8"))
    kb = os.path.getsize(sheet) / 1024
    w, h = Image.open(sheet).size
    n = meta["frames"]
    print("%s: %d кадров %dx%d, лист %dx%d, %.0f КБ" % (os.path.relpath(sheet, ROOT), n, meta["fw"], meta["fh"], w, h, kb))
    if n > MAX_FRAMES:
        print("кадров больше", MAX_FRAMES)
        ok = False
    if kb > MAX_KB:
        print("лист больше %d КБ" % MAX_KB)
        ok = False
    if meta["fw"] > MAX_FRAME_PX or meta["fh"] > MAX_FRAME_PX:
        print("кадр больше %d px" % MAX_FRAME_PX)
        ok = False
    if (w, h) != (meta["fw"] * n, meta["fh"]):
        print("размер листа не сходится с json: ждали %dx%d" % (meta["fw"] * n, meta["fh"]))
        ok = False
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src", nargs="?")
    p.add_argument("out", nargs="?", default=DEF_SHEET)
    p.add_argument("--json", default=DEF_JSON)
    p.add_argument("--check", action="store_true", help="только проверить готовый лист")
    p.add_argument("--width", type=int, default=MAX_FRAME_PX, help="сторона кадра в листе")
    p.add_argument("--pad", type=int, default=3, help="прозрачное поле вокруг облака, px исходника")
    p.add_argument("--q", type=int, default=74)
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--peak", default="8-15", help="кадры, по которым мерить поперечник облака")
    p.add_argument("--preview", help="анимированный GIF/WebP на фоне игры")
    p.add_argument("--source", default="EmberGen Ground Explosion (JangaFX), CC0")
    a = p.parse_args()

    if a.check:
        sys.exit(check(a.out, a.json))
    if not a.src:
        p.error("нужна папка кадров")

    frames = load_frames(a.src)
    if len(frames) > MAX_FRAMES:
        sys.exit("кадров %d, можно не больше %d" % (len(frames), MAX_FRAMES))
    src_edge = max(border_alpha(f) for f in frames)
    if src_edge > 2 * THR:
        print("ВНИМАНИЕ: облако обрезано краем кадра рендера (альфа %d) — больше --scale в рендере" % src_edge)
    ox, oy = origin_of(frames)
    half = reach(frames, ox, oy) + a.pad
    print("место взрыва в кадре рендера: (%.1f, %.1f), полуширина %.1f px" % (ox, oy, half))
    frames = crop_centered(frames, ox, oy, half)
    side = frames[0].size[0]
    if side > a.width:
        frames = [f.resize((a.width, a.width), Image.LANCZOS) for f in frames]
    edge = max(border_alpha(f) for f in frames)
    if edge > THR:
        print("ВНИМАНИЕ: облако упирается в край кадра (альфа %d) — шире кадр рендера (--scale)" % edge)

    p0, p1 = (int(x) for x in a.peak.split("-"))
    spans = sorted(span_of(f, 0, 0) for f in frames[p0:p1 + 1])
    span = round(spans[len(spans) // 2], 3)

    if a.preview:
        preview(frames, a.preview, a.fps)

    sh = strip(frames)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "sheet.png")
        sh.save(png)
        subprocess.run(["cwebp", "-quiet", "-q", str(a.q), "-alpha_q", "85", "-m", "6",
                        png, "-o", a.out], check=True)
    fw, fh = frames[0].size
    meta = {"src": os.path.basename(a.out), "frames": len(frames), "fw": fw, "fh": fh,
            "fps": a.fps, "span": span, "source": a.source}
    with open(a.json, "w", encoding="utf-8") as fp:
        json.dump(meta, fp, ensure_ascii=False, indent=2)
        fp.write("\n")
    print("json:", json.dumps(meta, ensure_ascii=False))
    print("поперечник облака на пике: %.3f кадра — узел шире 3 клеток в %.2f раза" % (span, 1 / span))
    sys.exit(check(a.out, a.json))


if __name__ == "__main__":
    main()
