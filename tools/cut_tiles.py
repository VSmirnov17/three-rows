"""Вырезает 6 табличек из листа 3x2 с непрозрачным размытым фоном.

Фон каждой ячейки — гладкое свечение, у табличек чёткий тёмный контур.
Заливка идёт от краёв ячейки по соседним пикселям с малой разницей цвета
и останавливается на контуре. Остальное — табличка.

usage: python cut_tiles.py SHEET OUT_DIR [--area 0.52] [--size 256] [--step 9]
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

args = sys.argv[1:]
sheet_path, out_dir = args[0], args[1]
opt = dict(zip(args[2::2], args[3::2]))
AREA = float(opt.get("--area", 0.52))
SIZE = int(opt.get("--size", 256))
STEP = float(opt.get("--step", 9))
MAXDIM = 0.94

img = Image.open(sheet_path).convert("RGB")
W, H = img.size
cw, ch = W // 3, H // 2
rgb_all = np.asarray(img).astype(np.int16)


def background_mask(rgb):
    h, w, _ = rgb.shape
    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            bg[y, x] = True
            q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        p = rgb[y, x]
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx]:
                if np.abs(rgb[ny, nx] - p).sum() <= STEP:
                    bg[ny, nx] = True
                    q.append((ny, nx))
    return bg


for i in range(6):
    r, c = divmod(i, 3)
    cell = rgb_all[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw]
    bg = background_mask(cell)
    fg = ~bg
    # мягкий край: слегка размываем маску и поджимаем на полпикселя
    m = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))
    m = m.filter(ImageFilter.GaussianBlur(0.9))
    rgba = Image.fromarray(cell.astype(np.uint8)).convert("RGBA")
    rgba.putalpha(m)
    bbox = m.point(lambda v: 255 if v > 24 else 0).getbbox()
    tile = rgba.crop(bbox)
    tw, th = tile.size
    # одинаковая видимая площадь, но не больше MAXDIM кадра
    a = np.asarray(tile.split()[3]).astype(np.float32) / 255
    cover = a.sum() / (tw * th)
    side = SIZE * np.sqrt(AREA / cover / (tw * th / max(tw, th) ** 2))
    scale = min(side / max(tw, th), SIZE * MAXDIM / max(tw, th))
    nw, nh = max(1, round(tw * scale)), max(1, round(th * scale))
    tile = tile.resize((nw, nh), Image.LANCZOS)
    frame = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    frame.alpha_composite(tile, ((SIZE - nw) // 2, (SIZE - nh) // 2))
    frame.save(f"{out_dir}/gem-{i}.png", optimize=True)
    vis = (np.asarray(frame.split()[3]) > 127).mean()
    print(f"gem-{i}: bbox={bbox} cover={cover:.2f} -> {nw}x{nh}, area={vis:.2f}")
