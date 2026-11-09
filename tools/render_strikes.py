#!/usr/bin/env python3
"""Спрайты ударов спецкамней: луч молнии, лучи солнца, нефритовая волна, ядра.

Процедурный рендер без внешних картинок: многооктавный шум со сдвигом
координат (domain warp), горячее ядро, мягкий ореол. Яркость запекается в
альфу (альфа = яркость, цвет — по градиенту), поэтому спрайт рисуется
обычным наложением: на слое #fx (свой контекст наложения) mix-blend-mode
смешивался бы только с пустым слоем.

Нужен только numpy (есть во встроенном Python Blender) и cwebp:

    /Applications/Blender.app/Contents/Resources/5.2/python/bin/python3.13 \
        tools/render_strikes.py assets/fx [--png <папка для PNG>] [--only beam,wave,ray,glow]

Каждый лист — в art-src/phase2/PROMPTS.md, «Шаг 5».
"""
import argparse
import os
import struct
import subprocess
import sys
import tempfile
import zlib

import numpy as np

CWEBP = '/opt/homebrew/bin/cwebp'
SEED = 5


def hex_rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Noise:
    """Гладкий шум на периодической решётке (ровно интерполированный, 3D)."""

    def __init__(self, seed, size=64):
        self.size = size
        rng = np.random.default_rng(seed)
        self.lat = rng.random((size, size, size), dtype=np.float32)

    def __call__(self, x, y, z):
        s = self.size
        xi = np.floor(x).astype(np.int64)
        yi = np.floor(y).astype(np.int64)
        zi = np.floor(z).astype(np.int64)
        fx, fy, fz = x - xi, y - yi, z - zi
        u = fx * fx * (3 - 2 * fx)
        v = fy * fy * (3 - 2 * fy)
        w = fz * fz * (3 - 2 * fz)
        L = self.lat
        xi0, xi1 = xi % s, (xi + 1) % s
        yi0, yi1 = yi % s, (yi + 1) % s
        zi0, zi1 = zi % s, (zi + 1) % s
        c00 = L[xi0, yi0, zi0] * (1 - u) + L[xi1, yi0, zi0] * u
        c10 = L[xi0, yi1, zi0] * (1 - u) + L[xi1, yi1, zi0] * u
        c01 = L[xi0, yi0, zi1] * (1 - u) + L[xi1, yi0, zi1] * u
        c11 = L[xi0, yi1, zi1] * (1 - u) + L[xi1, yi1, zi1] * u
        d0 = c00 * (1 - v) + c10 * v
        d1 = c01 * (1 - v) + c11 * v
        return d0 * (1 - w) + d1 * w


def fbm(noise, x, y, z, octaves=4):
    amp, total, out = 0.5, 0.0, 0.0
    for i in range(octaves):
        f = 2.0 ** i
        out = out + noise(x * f + i * 17.3, y * f + i * 9.1, z * f + i * 5.7) * amp
        total += amp
        amp *= 0.5
    return out / total


def ramp(intensity, stops):
    """Цвет по интенсивности 0..1: stops = [(позиция, '#rrggbb'), …]."""
    pos = np.array([p for p, _ in stops], dtype=np.float32)
    cols = np.stack([hex_rgb(c) for _, c in stops])
    i = np.clip(intensity, 0, 1)
    return np.stack([np.interp(i, pos, cols[:, k]) for k in range(3)], axis=-1)


def rgba(intensity, stops, gain=1.0):
    """RGBA 8-бит: цвет — по градиенту, альфа — яркость (без умножения)."""
    i = np.clip(intensity, 0, 1)
    rgb = ramp(i, stops)
    a = np.clip(i * gain, 0, 1)
    return (np.dstack([rgb, a]) * 255 + 0.5).astype(np.uint8)


def grid(w, h):
    x = (np.arange(w, dtype=np.float32) + 0.5) / w
    y = (np.arange(h, dtype=np.float32) + 0.5) / h
    return np.meshgrid(x, y)


# ---------- Луч молнии: бирюзовая плазма с тонкими разрядами ----------
BEAM_STOPS = [(0.0, '#0a5c5a'), (0.2, '#178a82'), (0.42, '#2ec2b1'), (0.62, '#5fe3d0'), (0.86, '#bff7ee'), (1.0, '#dffcf5')]


def beam_frame(n, frame, frames, w, h):
    t = frame / frames * 2.2
    u, v = grid(w, h)
    v = v * 2 - 1
    aspect = w / h
    x = u * aspect

    wob = (fbm(n, x * 0.55, np.full_like(x, 3.1), t * 0.9, 3) - 0.5) * 0.3
    d = np.abs(v - wob)

    # Тело луча: плотная бирюзовая плазма с рваным дымным ореолом
    flow = fbm(n, x * 0.9 + t * 1.1, v * 2.4, t * 0.8, 4)
    warp = fbm(n, x * 0.7 - t * 0.7, v * 3.5 + flow * 2.0, t * 0.6, 3)
    streak = fbm(n, x * 3.0 - t * 1.6, v * 8.0 + flow * 2.5, t * 1.3, 3)
    body = np.exp(-(d / 0.44) ** 1.45) * (0.34 + 0.6 * warp)
    halo = np.exp(-(d / 0.8) ** 2) * (0.12 + 0.34 * warp ** 1.6)
    core = np.exp(-(d / 0.12) ** 1.8) * (0.42 + 0.34 * streak)

    # Тонкие разряды вокруг оси, местами рвутся
    arcs = 0
    for i, (amp, spd, width, weight) in enumerate(
            ((0.34, 1.2, 0.024, 0.34), (0.5, 1.7, 0.018, 0.28), (0.64, 2.3, 0.015, 0.22))):
        path = (fbm(n, x * (0.9 + i * 0.35) + t * spd * (1 + i), np.full_like(x, 11.0 + i * 7), t * 1.7 + i, 3) - 0.5) * 2 * amp
        path = path * smooth(0.0, 0.2, 1 - np.abs(path))
        broken = smooth(0.42, 0.62, fbm(n, x * 1.6 - t * 2.0, np.full_like(x, 23.0 + i * 5), t * 2.2, 2))
        arcs = arcs + np.exp(-((v - path) / width) ** 2) * broken * weight

    tip = smooth(0.0, 0.03, u) * smooth(0.0, 0.035, 1 - u)
    win = (1 - np.minimum(1, np.abs(v)) ** 2.2) ** 1.2
    I = (body + halo + core + arcs) * tip * win
    return rgba(np.clip(I, 0, 0.96), BEAM_STOPS)


# ---------- Нефритовая волна: острый гребень-стрела, текучий жгут следом ----------
WAVE_STOPS = [(0.0, '#0b4a38'), (0.24, '#177a57'), (0.5, '#3fbf8a'), (0.82, '#b8f5d6'), (1.0, '#e4fff0')]


def wave_frame(n, frame, frames, w, h):
    t = frame / frames * 2.0
    u, v = grid(w, h)
    v = v * 2 - 1
    aspect = w / h
    x = u * aspect

    # Гребень — стрелка вперёд с рваной кромкой; f — расстояние за гребнем вдоль u
    edge = 0.975 - 0.075 * np.abs(v) ** 1.5 + (fbm(n, v * 2.8 + 4.0, np.full_like(v, 1.0), t * 1.4, 3) - 0.5) * 0.04
    f = np.maximum(edge - u, 0)
    ahead = smooth(-0.004, 0.01, edge - u)

    flow = fbm(n, x * 0.8 - t * 1.0, v * 2.2, t * 0.7, 4)
    fine = fbm(n, x * 3.4 - t * 2.4, v * 7.5 + flow * 2.5, t * 1.2, 3)

    # Жгут: живой поток по всей длине, шире у гребня, чуть тает к клетке тотема
    width = 0.22 + 0.42 * np.exp(-f / 0.14)
    wob = (flow - 0.5) * 0.46 * (1 - np.exp(-f / 0.2))
    d = np.abs(v - wob)
    fade = 0.55 + 0.45 * np.exp(-f / 0.5)
    rope = np.exp(-(d / width) ** 1.8) * (0.28 + 0.72 * flow) * fade
    # Яркие струи внутри жгута
    strands = np.exp(-(d / (width * 0.55)) ** 2) * (fine ** 2.2) * 1.9 * fade
    # Брызги по краям потока
    spray = np.exp(-(d / (width * 1.5)) ** 2) * (fbm(n, x * 5.5 - t * 3.0, v * 3.0, t * 1.5, 2) ** 3.5) * 1.5 * fade

    # Гребень: тонкая яркая дуга-стрелка, кончики уходят назад
    crest = np.exp(-(f / 0.016) ** 1.15) * (0.66 + 0.4 * fine) * smooth(0.95, 0.35, np.abs(v))
    backwash = np.exp(-f / 0.05) * 0.14 * smooth(1.0, 0.5, np.abs(v)) * (0.5 + 0.8 * fine)

    cross = (1 - np.minimum(1, np.abs(v)) ** 2.6)
    I = (rope + strands + spray + crest + backwash) * ahead * cross
    return rgba(np.clip(I, 0, 0.96), WAVE_STOPS)


# ---------- Луч солнца: тонкий золотой, с ярким острым концом ----------
RAY_STOPS = [(0.0, '#7a4a0e'), (0.3, '#c98b24'), (0.58, '#ffd166'), (0.88, '#ffe9ad'), (1.0, '#fff4d0')]


def ray_row(n, row, rows, w, h):
    u, v = grid(w, h)
    v = v * 2 - 1
    x = u * (w / h)
    z = row * 7.13
    flow = fbm(n, x * 0.9 + z, v * 2.5, z * 0.4, 3)
    wob = (fbm(n, x * 0.45 + z * 3, np.full_like(v, 6.0), z, 2) - 0.5) * 0.12
    d = np.abs(v - wob)
    # Тонкая нить: сужается к источнику, плотнее к цели
    weight = 0.34 + 0.56 * u ** 0.8
    width = 0.07 + 0.09 * u
    core = np.exp(-(d / width) ** 2) * weight * 0.82
    glow = np.exp(-(d / (width * 4.2)) ** 1.5) * 0.5 * (0.62 + 0.55 * flow) * weight
    wisp = np.exp(-(d / 0.6) ** 2) * 0.16 * flow
    tip = smooth(0.0, 0.02, u) * smooth(0.0, 0.05, 1 - u)
    win = (1 - np.minimum(1, np.abs(v)) ** 2) ** 1.4
    I = (core + glow + wisp) * tip * win
    return rgba(np.clip(I, 0, 0.94), RAY_STOPS)


# ---------- Ядра: мягкий диск с лучами-протуберанцами ----------
def corona(n, size, core_r, spikes, seed_z):
    u, v = grid(size, size)
    dx = (u - 0.5) * 2
    dy = (v - 0.5) * 2
    r = np.sqrt(dx * dx + dy * dy) + 1e-6
    a = np.arctan2(dy, dx)
    wrap = np.stack([np.cos(a), np.sin(a)])
    n1 = fbm(n, wrap[0] * 2.6 + 3, wrap[1] * 2.6 + 7, seed_z, 3)
    n2 = fbm(n, wrap[0] * 9.5 + 11 + r * 2.0, wrap[1] * 9.5 + 5 - r * 2.0, seed_z + 3.3, 3)
    radial = np.exp(-r / (0.42 + 0.34 * (n1 - 0.5)))
    streaks = (n2 ** 2.2) * 2.3
    disc = np.exp(-(r / core_r) ** 1.8)
    rays = radial * (0.25 + streaks) * spikes
    soft = (1 - smooth(0.62, 1.0, r)) ** 1.5
    return (disc * 0.86 + rays) * soft


GOLD_STOPS = [(0.0, '#6e3a08'), (0.22, '#b8741a'), (0.5, '#ffd166'), (0.84, '#ffdf96'), (1.0, '#ffe9ad')]


def glow_cell(n, size, stops, core_r, spikes, z):
    return rgba(np.clip(corona(n, size, core_r, spikes, z), 0, 0.97), stops, gain=1.0)


# ---------- Вывод ----------
def write_png(path, arr):
    h, w = arr.shape[:2]
    raw = b''.join(b'\0' + arr[y].tobytes() for y in range(h))

    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def to_webp(arr, out, q, aq, png_dir, name):
    if png_dir:
        os.makedirs(png_dir, exist_ok=True)
        write_png(os.path.join(png_dir, name + '.png'), arr)
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, 'a.png')
        write_png(src, arr)
        subprocess.run([CWEBP, '-quiet', '-q', str(q), '-alpha_q', str(aq), '-m', '6', src, '-o', out], check=True)
    print(name, arr.shape[1], 'x', arr.shape[0], os.path.getsize(out) // 1024, 'KB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--png')
    ap.add_argument('--only', default='beam,wave,ray,glow')
    a = ap.parse_args()
    only = set(a.only.split(','))
    os.makedirs(a.out, exist_ok=True)
    n = Noise(SEED)

    if 'beam' in only:
        w, h, frames = 1024, 112, 12
        sheet = np.vstack([beam_frame(n, f, frames, w, h) for f in range(frames)])
        to_webp(sheet, os.path.join(a.out, 'beam-turquoise.webp'), 62, 62, a.png, 'beam-turquoise')
    if 'wave' in only:
        w, h, frames = 1024, 128, 8
        sheet = np.vstack([wave_frame(n, f, frames, w, h) for f in range(frames)])
        to_webp(sheet, os.path.join(a.out, 'wave-jade.webp'), 62, 62, a.png, 'wave-jade')
    if 'ray' in only:
        w, h, rows = 512, 56, 4
        sheet = np.vstack([ray_row(n, r, rows, w, h) for r in range(rows)])
        to_webp(sheet, os.path.join(a.out, 'ray-gold.webp'), 70, 70, a.png, 'ray-gold')
    if 'glow' in only:
        size = 256
        sun = glow_cell(n, size, GOLD_STOPS, 0.2, 0.85, 0.7)
        tur = glow_cell(n, size, BEAM_STOPS, 0.15, 0.55, 2.9)
        jade = glow_cell(n, size, WAVE_STOPS, 0.15, 0.58, 5.2)
        sheet = np.hstack([sun, tur, jade])
        to_webp(sheet, os.path.join(a.out, 'glow-cores.webp'), 72, 72, a.png, 'glow-cores')


if __name__ == '__main__':
    sys.exit(main())
