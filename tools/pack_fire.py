#!/usr/bin/env python3
"""Сборка спрайт-листа огня из кадров Blender (blender/fire.py).

Кадры отрендерены на чёрном фоне. Для каждого кадра:
  альфа a = max(R, G, B) / 255, цвет = RGB / a, потом гамма альфы a^0.85,
  чтобы тонкие язычки не таяли на тёмном фоне.
Для цикла (--loop N --fade K) берутся N + K кадров. Первые K кадров
смешиваются с хвостом: out[i] = lerp(f[N+i], f[i], (i+1)/(K+1)), поэтому
за последним кадром цикла плавно следует первый.

Нужен только Pillow и cwebp (/opt/homebrew/bin/cwebp).

  python3 tools/pack_fire.py art-src/phase2/fire/calm assets/fire/fire-calm.webp \
      --loop 48 --fade 12 [--cols 8] [--q 80] [--preview out.gif]
  python3 tools/pack_fire.py art-src/phase2/fire/flare assets/fire/fire-flare.webp \
      --frames 32
"""
import argparse
import glob
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageMath

ALPHA_GAMMA = 0.85
PREVIEW_BG = (15, 26, 20)  # тёмно-зелёный фон игры


def load_frames(src):
    files = sorted(glob.glob(os.path.join(src, "f_*.png")))
    if not files:
        sys.exit("нет кадров f_*.png в " + src)
    return [Image.open(f).convert("RGB") for f in files]


def make_loop(frames, n, k):
    if len(frames) < n + k:
        sys.exit("для цикла нужно %d кадров, есть %d" % (n + k, len(frames)))
    out = []
    for i in range(n):
        if i < k:
            w = (i + 1) / (k + 1)
            out.append(Image.blend(frames[n + i], frames[i], w))
        else:
            out.append(frames[i])
    return out


def to_rgba(im):
    r, g, b = im.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    chans = []
    for c in (r, g, b):
        chans.append(ImageMath.lambda_eval(
            lambda e: e["convert"](e["min"](e["c"] * 255.0 / e["max"](e["m"], 1.0), 255.0), "L"),
            c=c.convert("F"), m=mx.convert("F")))
    alpha = mx.point(lambda v: round(255.0 * (v / 255.0) ** ALPHA_GAMMA))
    return Image.merge("RGBA", (*chans, alpha))


def crop_union(frames, pad=4, thr=8):
    """Обрезка всех кадров по общей рамке пламени (альфа > thr)."""
    box = None
    for f in frames:
        b = f.getchannel("A").point(lambda v: 255 if v > thr else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]),
                                         max(box[2], b[2]), max(box[3], b[3]))
    w, h = frames[0].size
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(w, box[2] + pad), min(h, box[3] + pad))
    return [f.crop(box) for f in frames], box


def sheet(frames, cols):
    fw, fh = frames[0].size
    rows = (len(frames) + cols - 1) // cols
    out = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out.paste(f, ((i % cols) * fw, (i // cols) * fh))
    return out


def preview(frames, path, fps):
    bg = Image.new("RGBA", frames[0].size, PREVIEW_BG + (255,))
    shown = [Image.alpha_composite(bg, f).convert("RGB") for f in frames]
    shown[0].save(path, save_all=True, append_images=shown[1:],
                  duration=round(1000 / fps), loop=0)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("out")
    p.add_argument("--loop", type=int, help="длина цикла N")
    p.add_argument("--fade", type=int, default=12, help="кадров на склейку K")
    p.add_argument("--frames", type=int, help="без цикла: взять первые N кадров")
    p.add_argument("--cols", type=int, default=8)
    p.add_argument("--q", type=int, default=80)
    p.add_argument("--fps", type=int, default=24)
    p.add_argument("--preview", help="анимированный GIF/WebP на фоне игры")
    p.add_argument("--crop", action="store_true", help="обрезать по общей рамке пламени")
    p.add_argument("--width", type=int, help="ширина кадра после обрезки")
    a = p.parse_args()

    frames = load_frames(a.src)
    if a.loop:
        frames = make_loop(frames, a.loop, a.fade)
    elif a.frames:
        frames = frames[:a.frames]
    rgba = [to_rgba(f) for f in frames]
    if a.crop:
        rgba, box = crop_union(rgba)
        print("рамка пламени в исходном кадре:", box)
    if a.width:
        w, h = rgba[0].size
        size = (a.width, round(h * a.width / w))
        rgba = [f.resize(size, Image.LANCZOS) for f in rgba]

    if a.preview:
        preview(rgba, a.preview, a.fps)

    sh = sheet(rgba, a.cols)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "sheet.png")
        sh.save(png)
        subprocess.run(["cwebp", "-quiet", "-q", str(a.q), "-alpha_q", "85", "-m", "6",
                        png, "-o", a.out], check=True)
    fw, fh = rgba[0].size
    print("%s: %d кадров %dx%d, сетка %d×%d, лист %dx%d, %.0f КБ" % (
        a.out, len(rgba), fw, fh, a.cols, (len(rgba) + a.cols - 1) // a.cols,
        sh.size[0], sh.size[1], os.path.getsize(a.out) / 1024))


if __name__ == "__main__":
    main()
