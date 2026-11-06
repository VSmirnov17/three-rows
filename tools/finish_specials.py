"""Доводка значков спецкамней после рендера blender/specials.py.

Добавляет тёмный контур (как у нарисованных табличек) и светлый ореол своего
цвета для каждого типа, обрезает и укладывает в квадрат 256×256.
Нужен Pillow.

usage: python3 tools/finish_specials.py SRC_DIR OUT_DIR [--preview GEMS_DIR PREVIEW.png]
"""
import os
import sys

from PIL import Image, ImageFilter

GLOW = {
    "sun": (255, 244, 200),
    "line": (190, 230, 255),
    "bomb": (255, 190, 120),
    "totem": (200, 255, 215),
}
OUTLINE = 7     # px при рендере 512
HALO = 22       # px
SIZE = 256


def finish(path):
    b = Image.open(path).convert("RGBA")
    t = os.path.basename(path)[len("special-"):-len(".png")]
    a = b.split()[3]
    grown = a.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    outline = Image.new("RGBA", b.size, (28, 12, 4, 0))
    outline.putalpha(grown)
    halo_a = a.filter(ImageFilter.MaxFilter(OUTLINE * 2 + 1 + HALO)).filter(ImageFilter.GaussianBlur(HALO / 2))
    halo_a = halo_a.point(lambda v: min(255, int(v * 1.7)))
    halo = Image.new("RGBA", b.size, GLOW.get(t, (255, 244, 200)) + (0,))
    halo.putalpha(halo_a)
    res = Image.alpha_composite(Image.alpha_composite(halo, outline), b)
    bbox = res.split()[3].point(lambda v: 255 if v > 10 else 0).getbbox()
    res = res.crop(bbox)
    side = max(res.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.alpha_composite(res, ((side - res.size[0]) // 2, (side - res.size[1]) // 2))
    return t, sq.resize((SIZE, SIZE), Image.LANCZOS)


def preview(badges, gems_dir, out, scale=0.72):
    gems = [Image.open(os.path.join(gems_dir, f"gem-{i}.png")).convert("RGBA") for i in range(6)]
    rows = list(badges.items())
    W = 10 + 6 * 160
    H = 10 + len(rows) * 120
    img = Image.new("RGB", (W, H), (14, 36, 28))
    for r, (t, bd) in enumerate(rows):
        for i, g in enumerate(gems):
            for k, px in enumerate((101, 48)):
                tile = g.resize((px, px), Image.LANCZOS)
                s = round(px * scale)
                tile.alpha_composite(bd.resize((s, s), Image.LANCZOS), ((px - s) // 2, (px - s) // 2))
                x = 10 + i * 160 + (0 if k == 0 else 106)
                y = 10 + r * 120 + (0 if k == 0 else 26)
                img.paste(tile, (x, y), tile)
    img.save(out)


def main():
    src, out = sys.argv[1], sys.argv[2]
    badges = {}
    for name in sorted(os.listdir(src)):
        if name.startswith("special-") and name.endswith(".png"):
            t, img = finish(os.path.join(src, name))
            img.save(os.path.join(out, f"special-{t}.png"), optimize=True)
            badges[t] = img
            print("saved", t)
    if "--preview" in sys.argv:
        i = sys.argv.index("--preview")
        preview(badges, sys.argv[i + 1], sys.argv[i + 2])


if __name__ == "__main__":
    main()
