#!/usr/bin/env python3
"""Режет лист кочек мха Codex -> assets/gems/moss-{a,b}.webp.

Лист — art-src/phase3/moss/v1/image.png: слева сидящий идол (a), справа
голова в ступенчатом уборе (b). Вокруг фигур Codex оставляет полупрозрачную
дымку (альфа до ~50): альфа <= 60 -> 0, >= 240 -> 255, между — растянута.
Каждая кочка обрезается по альфе, кладётся в квадрат с полями 4 % и сжимается
до 256×256. Запуск из корня игры: python3 tools/pack_moss.py (нужен Pillow).
"""
from pathlib import Path
from PIL import Image

SRC = Path('art-src/phase3/moss/v1/image.png')
OUT = Path('assets/gems')
SIZE = 256
LO, HI = 60, 240


def clamp(v):
    if v <= LO:
        return 0
    if v >= HI:
        return 255
    return round((v - LO) * 255 / (HI - LO))


def spans(alpha):
    w, h = alpha.size
    cols = [max(alpha.getpixel((x, y)) for y in range(0, h, 4)) for x in range(w)]
    out, start = [], None
    for x, v in enumerate(cols + [0]):
        if v > 0 and start is None:
            start = x
        elif v == 0 and start is not None:
            if x - start > 100:
                out.append((start, x))
            start = None
    return out


def main():
    src = Image.open(SRC).convert('RGBA')
    src.putalpha(src.getchannel('A').point(clamp))
    parts = spans(src.getchannel('A'))
    assert len(parts) == 2, 'ожидалось две кочки, найдено %d' % len(parts)
    for name, (x0, x1) in zip('ab', parts):
        crop = src.crop((x0, 0, x1, src.height))
        crop = crop.crop(crop.getchannel('A').getbbox())
        side = round(max(crop.size) * 1.08)
        sq = Image.new('RGBA', (side, side))
        sq.paste(crop, ((side - crop.width) // 2, (side - crop.height) // 2))
        sq.resize((SIZE, SIZE), Image.LANCZOS).save(OUT / ('moss-%s.webp' % name), quality=88, method=6)
        print('moss-%s.webp' % name)


if __name__ == '__main__':
    main()
