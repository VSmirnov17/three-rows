#!/usr/bin/env python3
"""Значки спецкамней из картинок Codex (этап 2, шаг 4).

Исходники: art-src/phase2/specials/src/
  sheet.png — лист 2×2: молния (не используется), солнце, бомба, тотем;
  line.png  — молния второго образца (бирюзовый крест), её и берём.
Результат: assets/gems/special-{line,sun,bomb,totem}.png, 256×256, альфа.

Что делает: режет лист по четвертям, обрезает по непрозрачному, альфу ≥ 250
доводит до 255 (у Codex внутри рисунка 250–254), кладёт в квадрат с полями 4 %,
добавляет тёмный контур ~3 px и мягкую тёмную подложку, чтобы золотой значок
не сливался с золотым камнем. Нужен только Pillow.

Запуск из корня игры:
  python3 tools/pack_specials.py
  python3 tools/pack_specials.py --src art-src/phase2/specials/src --out assets/gems
"""
import argparse
import os

from PIL import Image, ImageFilter

SIZE = 256
# Линия раздела листа: значки верхнего ряда кончаются выше 588 px,
# а искра фитиля бомбы и перья тотема заходят выше середины (623).
SPLIT_X, SPLIT_Y = 630, 588
SHEET_CELLS = {'sun': 1, 'bomb': 2, 'totem': 3}  # 0 — старая молния


def solid_alpha(img):
    r, g, b, a = img.split()
    return Image.merge('RGBA', (r, g, b, a.point(lambda v: 255 if v >= 250 else v)))


def trim(img):
    box = img.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    return img.crop(box)


def finish(img):
    img = solid_alpha(trim(img))
    side = int(max(img.size) * 1.08)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
    sq = sq.resize((SIZE, SIZE), Image.LANCZOS)

    alpha = sq.getchannel('A')
    ring = alpha.filter(ImageFilter.MaxFilter(7))
    shade = (alpha.filter(ImageFilter.MaxFilter(13))
             .filter(ImageFilter.GaussianBlur(5))
             .point(lambda v: int(v * 0.75)))

    def flat(v):
        return Image.new('L', (SIZE, SIZE), v)

    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(Image.merge('RGBA', (flat(12), flat(12), flat(12), shade)))
    out.alpha_composite(Image.merge('RGBA', (flat(26), flat(16), flat(10), ring)))
    out.alpha_composite(sq)
    return out


def sheet_cell(sheet, index):
    w, h = sheet.size
    xs = [(0, SPLIT_X), (SPLIT_X, w)]
    ys = [(0, SPLIT_Y), (SPLIT_Y, h)]
    x0, x1 = xs[index % 2]
    y0, y1 = ys[index // 2]
    return sheet.crop((x0, y0, x1, y1))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--src', default='art-src/phase2/specials/src')
    ap.add_argument('--out', default='assets/gems')
    args = ap.parse_args()

    sheet = Image.open(os.path.join(args.src, 'sheet.png')).convert('RGBA')
    icons = {name: sheet_cell(sheet, i) for name, i in SHEET_CELLS.items()}
    icons['line'] = Image.open(os.path.join(args.src, 'line.png')).convert('RGBA')

    os.makedirs(args.out, exist_ok=True)
    for name in ('line', 'sun', 'bomb', 'totem'):
        path = os.path.join(args.out, f'special-{name}.png')
        finish(icons[name]).save(path, optimize=True)
        print(f'{path}  {os.path.getsize(path) // 1024} КБ')


if __name__ == '__main__':
    main()
