#!/usr/bin/env python3
"""Режет лист валунов Codex на три спрайта: assets/gems/boulder-{3,2,1}.webp.

Лист — art-src/phase3/boulders/v2/image.png: слева направо прочность 3, 2, 1
(целый, две трещины, весь в трещинах). Прозрачность внутри камня у Codex
250–254, поэтому альфа >= 250 -> 255, <= 8 -> 0. Каждый валун обрезается
по альфе, кладётся в квадрат с полями 4 % и сжимается до 256×256.
Запуск из корня игры: python3 tools/pack_boulders.py (нужен Pillow).
"""
from pathlib import Path
from PIL import Image

SRC = Path('art-src/phase3/boulders/v2/image.png')
OUT = Path('assets/gems')
SIZE = 256


def spans(alpha):
    w, h = alpha.size
    cols = [max(alpha.getpixel((x, y)) for y in range(0, h, 4)) for x in range(w)]
    out, start = [], None
    for x, v in enumerate(cols + [0]):
        if v > 8 and start is None:
            start = x
        elif v <= 8 and start is not None:
            if x - start > 100:
                out.append((start, x))
            start = None
    return out


def main():
    src = Image.open(SRC).convert('RGBA')
    parts = spans(src.getchannel('A'))
    assert len(parts) == 3, 'ожидалось три валуна, найдено %d' % len(parts)
    for hp, (x0, x1) in zip((3, 2, 1), parts):
        crop = src.crop((x0, 0, x1, src.height))
        alpha = crop.getchannel('A').point(lambda v: 255 if v >= 250 else (0 if v <= 8 else v))
        crop.putalpha(alpha)
        crop = crop.crop(alpha.point(lambda v: 255 if v > 8 else 0).getbbox())
        side = int(max(crop.size) * 1.08)
        sq = Image.new('RGBA', (side, side))
        sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2), crop)
        path = OUT / ('boulder-%d.webp' % hp)
        sq.resize((SIZE, SIZE), Image.LANCZOS).save(path, 'WEBP', quality=88, method=6)
        print(path, path.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
