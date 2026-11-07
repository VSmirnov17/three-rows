#!/usr/bin/env python3
"""Проверка листа огня: шов цикла и кайма.

  python3 art-src/phase2/fire/check.py assets/fire/fire-calm.webp out.png

(а) средняя разность соседних кадров по всему циклу и на стыке 47→0
    (на стыке должна быть не больше средней ×1,5);
(б) лист «кадр 47 | кадр 0 | кадр 20» на фоне игры #0f1a14 при 300 % —
    смотреть глазами, нет ли серой или чёрной каймы.
"""
import json
import os
import sys

from PIL import Image, ImageChops, ImageStat

sheet_path, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(os.path.dirname(sheet_path), "fire.json")))
sh = Image.open(sheet_path).convert("RGBA")
fw, fh, cols, n = meta["fw"], meta["fh"], meta["cols"], meta["frames"]
frames = [sh.crop(((i % cols) * fw, (i // cols) * fh, (i % cols + 1) * fw, (i // cols + 1) * fh)) for i in range(n)]
bg = Image.new("RGBA", (fw, fh), (15, 26, 20, 255))
flat = [Image.alpha_composite(bg, f).convert("L") for f in frames]
diffs = [ImageStat.Stat(ImageChops.difference(flat[i], flat[(i + 1) % n])).mean[0] for i in range(n)]
mean = sum(diffs[:-1]) / (n - 1)
seam = diffs[-1]
print("средняя разность соседних кадров: %.2f, на стыке %d→0: %.2f (%.2f×)" % (mean, n - 1, seam, seam / mean))
k = 3
W = Image.new("RGBA", (fw * k * 3 + 20, fh * k), (15, 26, 20, 255))
for j, i in enumerate((n - 1, 0, 20)):
    W.alpha_composite(Image.alpha_composite(bg, frames[i]).resize((fw * k, fh * k), Image.NEAREST), (j * (fw * k + 10), 0))
W.convert("RGB").save(out)
sys.exit(0 if seam <= mean * 1.5 else 1)
