#!/usr/bin/env python3
"""Сборка слоёв живого фона из картин Codex (шаг 3).

Исходники: art-src/phase2/backdrop/src/{plate,moon,clouds}.png.
Результат: assets/backdrop/land<N>/
  plate.webp       плита (картина целиком, q 86)
  water.webp       плитка «струй»: высокие частоты водопада, бесшовная по вертикали
  water-mask.webp  белая картинка, вся информация в альфе: где вода видна
  moon.webp        луна 256x256, круглая альфа, вшиты brightness(.92) и размытие
  clouds.webp      облака: постоянный бледно-серо-голубой цвет, альфа по яркости
  backdrop.json    размеры и геометрия для CSS/JS

Алгоритмы — как в пробнике art-src/phase2/backdrop/make_spike.py, но только
на Pillow (в системном python3 numpy нет).

  python3 tools/pack_backdrop.py --land 1 [--src DIR] [--out DIR]
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageMath, ImageStat

# вырезка воды из плиты (пиксели плиты)
WX0, WX1, WY0, WY1 = 20, 170, 0, 905
# кусок вырезки, из которого делается плитка струй
TEX_Y0, TEX_Y1 = 150, 750
TEX_STRETCH = 1.3
SEAM = 120            # строк на склейку «конец -> начало»
MASK_FADE_TOP, MASK_FADE_BOTTOM = 40, 60
MOON_SIZE = 256
# CSS blur(.6px) в пробнике шёл по диску ~100 px; в картинке 256 px это ~1,5 px
MOON_BLUR = 1.5
MOON_BRIGHTNESS = 0.92
CLOUD_COLOR = (190, 205, 225)
CLOUD_POWER = 0.8
CLOUD_PERCENTILE = 0.999
Q_PLATE, Q_TEX, Q_CLOUDS = 86, 85, 85


def lum_mean(im):
    """Яркость как (R+G+B)/3, как в пробнике (numpy mean), 8 бит."""
    r, g, b = (c.convert("F") for c in im.split())
    f = ImageMath.lambda_eval(lambda e: (e["r"] + e["g"] + e["b"]) / 3.0, r=r, g=g, b=b)
    return f.convert("L")


def clamp01_point(lo, span):
    """LUT: clip((v - lo) / span, 0, 1) * 255."""
    return lambda v: int(round(min(max((v - lo) / span, 0.0), 1.0) * 255))


def make_mask(plate):
    crop = plate.crop((WX0, WY0, WX1, WY1))
    r, _, b = crop.split()
    blur = lum_mean(crop).filter(ImageFilter.GaussianBlur(10))
    bright = blur.point(clamp01_point(45, 40))
    # синева (B - R + 5) / 30; subtract с offset даёт clip(B - R + 5, 0, 255)
    bluish = ImageChops.subtract(b, r, 1.0, 5).point(clamp01_point(0, 30))
    m = ImageChops.multiply(bright, bluish).filter(ImageFilter.GaussianBlur(6))
    w, h = m.size
    # затухание: сверху 40 px, снизу 60 px
    fade = Image.new("L", (w, h), 255)
    px = fade.load()
    for y in range(h):
        k = min(max(y / MASK_FADE_TOP, 0.0), 1.0) * min(max((h - y) / MASK_FADE_BOTTOM, 0.0), 1.0)
        v = int(round(255 * k))
        for x in range(w):
            px[x, y] = v
    m = ImageChops.multiply(m, fade)
    mask = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    mask.putalpha(m)
    return mask


def make_tex(plate):
    crop = plate.crop((WX0, WY0, WX1, WY1))
    seg = crop.crop((0, TEX_Y0, crop.width, TEX_Y1))
    low = seg.filter(ImageFilter.GaussianBlur(7))
    bands = []
    for s, l in zip(seg.split(), low.split()):
        hp = ImageMath.lambda_eval(
            lambda e: e["convert"](e["min"](e["max"]((e["s"] - e["l"]) * 2.2 + 8.0, 0.0), 255.0), "L"),
            s=s.convert("F"), l=l.convert("F"))
        bands.append(hp)
    hp = Image.merge("RGB", bands)
    tex = hp.resize((seg.width, int(seg.height * TEX_STRETCH)), Image.BICUBIC)
    top = tex.crop((0, 0, tex.width, SEAM))
    body = tex.crop((0, SEAM, tex.width, tex.height))
    # последние SEAM строк тела плавно переходят в первые SEAM строк (потом отброшенные)
    ramp = Image.linear_gradient("L").resize((tex.width, SEAM), Image.BILINEAR)
    tail = body.crop((0, body.height - SEAM, body.width, body.height))
    tail = Image.composite(top, tail, ramp)  # ramp 0 -> хвост, 255 -> верх
    body.paste(tail, (0, body.height - SEAM))
    return body


def row_diff(im, y0, y1):
    """Средняя |разность| строк y0 и y1 (по яркости)."""
    g = im.convert("L")
    a = g.crop((0, y0, g.width, y0 + 1))
    b = g.crop((0, y1, g.width, y1 + 1))
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]


def seam_numbers(tex):
    h = tex.height
    g = tex.convert("L")
    adj = ImageChops.difference(g.crop((0, 0, g.width, h - 1)), g.crop((0, 1, g.width, h)))
    adj_mean = ImageStat.Stat(adj).mean[0]
    seam = row_diff(tex, h - 1, 0)
    # те же разности, но только рядом со швом (±30 строк): сравнение с тем же рисунком
    near = [row_diff(tex, y, y + 1) for y in list(range(h - 31, h - 1)) + list(range(0, 30))]
    return seam, adj_mean, sum(near) / len(near)


def make_moon(src):
    moon = Image.open(src).convert("RGBA")
    al = moon.getchannel("A")
    x0, y0, x1, y1 = al.point(lambda v: 255 if v > 128 else 0).getbbox()
    xmin, xmax, ymin, ymax = x0, x1 - 1, y0, y1 - 1
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    r = (xmax - xmin + ymax - ymin) / 4
    S = 4
    big = Image.new("L", (moon.width * S, moon.height * S), 0)
    ImageDraw.Draw(big).ellipse(((cx - r + 1.5) * S, (cy - r + 1.5) * S,
                                 (cx + r - 1.5) * S, (cy + r - 1.5) * S), fill=255)
    moon.putalpha(big.resize(moon.size, Image.LANCZOS))
    bb = (int(cx - r - 4), int(cy - r - 4), int(cx + r + 4), int(cy + r + 4))
    moon = moon.crop(bb).resize((MOON_SIZE, MOON_SIZE), Image.LANCZOS)
    # размытие с предумножением альфы, чтобы не было тёмной каймы
    a = moon.getchannel("A")
    pre = [ImageChops.multiply(c, a).filter(ImageFilter.GaussianBlur(MOON_BLUR))
           for c in moon.convert("RGB").split()]
    a_b = a.filter(ImageFilter.GaussianBlur(MOON_BLUR))
    chans = []
    for c in pre:
        un = ImageMath.lambda_eval(
            lambda e: e["convert"](e["min"](e["c"] * 255.0 / e["max"](e["a"], 1.0) * MOON_BRIGHTNESS, 255.0), "L"),
            c=c.convert("F"), a=a_b.convert("F"))
        chans.append(un)
    out = Image.merge("RGB", chans)
    out.putalpha(a_b)
    return out


def make_clouds(src):
    im = Image.open(src).convert("RGB")
    r, g, b = im.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), b)
    hist = mx.histogram()
    total = sum(hist)
    acc, p = 0, 255
    for i, n in enumerate(hist):
        acc += n
        if acc >= total * CLOUD_PERCENTILE:
            p = max(i, 1)
            break
    alpha = mx.point(lambda v: int(round(255 * min(v / p, 1.0) ** CLOUD_POWER)))
    alpha = alpha.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    out = Image.new("RGBA", alpha.size, CLOUD_COLOR + (0,))
    out.putalpha(alpha)
    return out


def save(im, path, **kw):
    im.save(path, "WEBP", method=6, **kw)
    return os.path.getsize(path)


def check_sheet(out_dir, mask, tex, moon, clouds, path):
    bg = (13, 27, 46)
    pad = 16
    # маска: альфа поверх тёмного фона, рядом сама плитка струй двумя копиями
    mw, mh = mask.size
    mask_view = Image.new("RGB", (mw, mh), bg)
    mask_view.paste(Image.new("RGB", (mw, mh), (255, 255, 255)), (0, 0), mask.getchannel("A"))
    tile2 = Image.new("RGB", (tex.width, tex.height * 2))
    tile2.paste(tex, (0, 0))
    tile2.paste(tex, (0, tex.height))
    moon_view = Image.new("RGB", moon.size, bg)
    moon_view.paste(moon, (0, 0), moon)
    cw, ch = clouds.size
    clouds_view = Image.new("RGB", (cw, ch), bg)
    clouds_view.paste(clouds, (0, 0), clouds)
    H = max(mh, tile2.height) + 2 * pad
    W = mw + tex.width + max(moon.width, clouds.width) + 4 * pad
    sheet = Image.new("RGB", (W, H), (40, 40, 40))
    x = pad
    sheet.paste(mask_view, (x, pad)); x += mw + pad
    sheet.paste(tile2, (x, pad)); x += tex.width + pad
    sheet.paste(moon_view, (x, pad))
    sheet.paste(clouds_view, (x, pad + moon.height + pad))
    # линия на стыке двух копий плитки (метка рядом, не поверх)
    d = ImageDraw.Draw(sheet)
    ys = pad + tex.height
    d.line([(x - pad - tex.width - 6, ys), (x - pad - tex.width - 1, ys)], fill=(255, 80, 80), width=1)
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--land", type=int, default=1)
    ap.add_argument("--src", default="art-src/phase2/backdrop/src")
    ap.add_argument("--out", default=None)
    ap.add_argument("--check", default="art-src/phase2/backdrop/check.png")
    a = ap.parse_args()
    out = a.out or "assets/backdrop/land%d" % a.land
    os.makedirs(out, exist_ok=True)

    plate = Image.open(os.path.join(a.src, "plate.png")).convert("RGB")
    W, H = plate.size
    mask = make_mask(plate)
    tex = make_tex(plate)
    moon = make_moon(os.path.join(a.src, "moon.png"))
    clouds = make_clouds(os.path.join(a.src, "clouds.png"))

    sizes = {
        "plate.webp": save(plate, os.path.join(out, "plate.webp"), quality=Q_PLATE),
        "water.webp": save(tex, os.path.join(out, "water.webp"), quality=Q_TEX),
        "water-mask.webp": save(mask, os.path.join(out, "water-mask.webp"), lossless=True),
        "moon.webp": save(moon, os.path.join(out, "moon.webp"), quality=88, alpha_quality=95),
        "clouds.webp": save(clouds, os.path.join(out, "clouds.webp"), quality=Q_CLOUDS, alpha_quality=90),
    }
    cw, ch = clouds.size
    geom = {
        "plate": [W, H],
        "wf": {"x": round(WX0 / W, 6), "y": round(WY0 / H, 6),
               "w": round((WX1 - WX0) / W, 6), "h": round((WY1 - WY0) / H, 6)},
        "tile": round(tex.height / H, 6),
        "moon": MOON_SIZE,
        "clouds": [cw, ch],
    }
    jp = os.path.join(out, "backdrop.json")
    with open(jp, "w") as f:
        json.dump(geom, f, ensure_ascii=False)
        f.write("\n")
    sizes["backdrop.json"] = os.path.getsize(jp)

    seam, adj, near = seam_numbers(tex)
    print(json.dumps(geom, ensure_ascii=False))
    total = 0
    for k, v in sizes.items():
        total += v
        print("%-18s %7.1f КБ" % (k, v / 1024))
    print("%-18s %7.1f КБ" % ("всего", total / 1024))
    print("шов струй: стык %.2f; среднее соседних строк: по всей плитке %.2f (отношение %.2f), "
          "рядом со швом %.2f (отношение %.2f); предел 1.5" % (seam, adj, seam / adj, near, seam / near))
    if a.check:
        os.makedirs(os.path.dirname(a.check) or ".", exist_ok=True)
        check_sheet(out, mask, tex, moon, clouds, a.check)
        print("лист проверки:", a.check)
    if total > 450 * 1024:
        sys.exit("бюджет 450 КБ превышен")


if __name__ == "__main__":
    main()
