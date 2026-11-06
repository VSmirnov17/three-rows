#!/usr/bin/env python3
"""Generate high-quality SFX samples for «Сокровища Солнца».

Renders layered one-shots with numpy/scipy, encodes most of them to mono MP3
(короткие тики — в WAV, чтобы не смазывать атаку), and writes
js/sfx-samples.js with base64 data (works from file://).
"""
import base64
import os
import subprocess
import tempfile
import wave

import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JS = os.path.join(ROOT, "js", "sfx-samples.js")
TMP = tempfile.mkdtemp(prefix="sun-sfx-")


def nsec(d):
    return max(1, int(round(d * SR)))


def timeline(d):
    return np.arange(nsec(d), dtype=np.float64) / SR


def filt(x, kind, lo, hi=None, order=2):
    ny = SR / 2.0
    if kind == "low":
        sos = butter(order, lo / ny, btype="low", output="sos")
    elif kind == "high":
        sos = butter(order, lo / ny, btype="high", output="sos")
    elif kind == "band":
        sos = butter(order, [lo / ny, hi / ny], btype="band", output="sos")
    else:
        raise ValueError(kind)
    return sosfilt(sos, x)


def env_exp(dur, attack=0.004, decay=None):
    t = timeline(dur)
    if decay is None:
        decay = max(0.01, dur * 0.25)
    env = np.exp(-t / decay)
    a = max(1, nsec(attack))
    if a > 1:
        env[:a] *= np.linspace(0.0, 1.0, a) ** 0.6
    return env


def sweep(f0, f1, dur, kind="sine"):
    t = timeline(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    phase = 2.0 * np.pi * np.cumsum(f) / SR
    if kind == "sine":
        return np.sin(phase)
    if kind == "saw":
        return 2.0 * ((phase / (2.0 * np.pi)) % 1.0) - 1.0
    if kind == "tri":
        return 2.0 * np.abs(2.0 * ((phase / (2.0 * np.pi)) % 1.0) - 1.0) - 1.0
    raise ValueError(kind)


def soft_clip(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)


def fm_bell(freq, dur, index=2.0, ratio=1.4, decay=0.25):
    t = timeline(dur)
    mod = index * np.exp(-t / (decay * 0.6)) * np.sin(2.0 * np.pi * freq * ratio * t)
    sig = np.sin(2.0 * np.pi * freq * t + mod)
    sig += 0.35 * np.sin(2.0 * np.pi * freq * 2.01 * t + 0.3 * mod) * np.exp(-t / (decay * 0.7))
    sig *= np.exp(-t / decay)
    return sig


def kalimba(freq, dur, rng):
    t = timeline(dur)
    sig = np.zeros_like(t)
    for ratio, amp, decay in ((1.0, 1.0, 0.38), (2.01, 0.32, 0.20), (3.9, 0.14, 0.11), (5.4, 0.07, 0.07)):
        sig += amp * np.sin(2.0 * np.pi * freq * ratio * t) * np.exp(-t / decay)
    n = nsec(0.006)
    if n < len(sig):
        sig[:n] += 0.12 * rng.standard_normal(n) * np.linspace(1.0, 0.0, n)
    return sig


def add(out, sig, at=0.0, gain=1.0):
    i = nsec(at)
    if i >= len(out):
        return
    j = min(len(out), i + len(sig))
    out[i:j] += sig[: j - i] * gain


def make_ir(dur, decay, predelay, rng):
    n = nsec(dur)
    t = np.arange(n, dtype=np.float64) / SR
    ir = rng.standard_normal(n) * np.exp(-t * decay)
    for d, g in ((0.011, 0.55), (0.019, 0.40), (0.029, 0.30), (0.043, 0.22), (0.059, 0.15)):
        idx = nsec(predelay + d)
        if idx < n:
            ir[idx] += g
    ir = filt(ir, "low", 7000)
    ir /= np.max(np.abs(ir)) + 1e-9
    return ir


def reverb(x, wet=0.3, ir_dur=1.0, decay=3.0, tail=0.5, rng=None):
    rng = rng or np.random.default_rng(1)
    ir = make_ir(ir_dur, decay, 0.008, rng)
    n_out = len(x) + nsec(tail)
    xp = np.pad(x, (0, n_out - len(x)))
    wet_sig = fftconvolve(xp, ir)[:n_out]
    out = np.zeros(n_out)
    out[: len(x)] += (1.0 - wet) * x
    out += wet * wet_sig
    return out


def fade(x, in_ms=1.0, out_ms=25.0):
    n = len(x)
    a = min(n, max(1, int(in_ms * SR / 1000.0)))
    b = min(n, max(1, int(out_ms * SR / 1000.0)))
    x[:a] *= np.linspace(0.0, 1.0, a)
    x[-b:] *= np.linspace(1.0, 0.0, b)
    return x


def finalize(x, total, peak=0.92):
    n = nsec(total)
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    else:
        x = x[:n]
    x = fade(x, 1.0, 25.0)
    x = np.nan_to_num(x)
    m = np.max(np.abs(x))
    if m > 0:
        x = x / m * peak
    return x


def line_blast(seed):
    rng = np.random.default_rng(seed)
    total = 1.55
    out = np.zeros(nsec(total))

    sub = sweep(155, 30, 0.80) * env_exp(0.80, 0.003, 0.22)
    add(out, soft_clip(sub, 2.0), 0.0, 0.95)

    n = nsec(0.70)
    t = np.arange(n) / SR
    body = rng.standard_normal(n) * np.exp(-t / 0.13)
    add(out, filt(body, "band", 120, 2600), 0.0, 0.75)

    n = nsec(0.09)
    t = np.arange(n) / SR
    crack = rng.standard_normal(n) * np.exp(-t / 0.007)
    add(out, filt(crack, "high", 2800), 0.0, 1.0)

    zap = sweep(2100, 90, 0.40, "saw") * env_exp(0.40, 0.002, 0.10)
    add(out, filt(zap, "band", 300, 5200), 0.004, 0.32)

    add(out, fm_bell(740, 0.60, 3.2, 1.41, 0.16), 0.02, 0.20)

    n = nsec(0.90)
    t = np.arange(n) / SR
    air = rng.standard_normal(n) * np.exp(-t / 0.30)
    add(out, filt(air, "high", 4200), 0.03, 0.10)

    out = soft_clip(out, 1.3)
    out = reverb(out, 0.34, 1.0, 3.5, 0.40, rng)
    return finalize(out, total, 0.93)


def sun_blast(seed):
    rng = np.random.default_rng(seed)
    total = 1.85
    out = np.zeros(nsec(total))

    sub = sweep(110, 28, 0.95) * env_exp(0.95, 0.004, 0.30)
    add(out, soft_clip(sub, 2.0), 0.0, 0.90)

    n = nsec(0.85)
    t = np.arange(n) / SR
    body = rng.standard_normal(n) * np.exp(-t / 0.20)
    add(out, filt(body, "band", 150, 5000), 0.0, 0.65)

    n = nsec(0.10)
    t = np.arange(n) / SR
    crack = rng.standard_normal(n) * np.exp(-t / 0.010)
    add(out, filt(crack, "high", 3200), 0.0, 0.55)

    for freq, delay in ((1046.0, 0.00), (1318.5, 0.05), (1568.0, 0.10), (2093.0, 0.16), (2637.0, 0.22)):
        add(out, fm_bell(freq, 0.90, 2.4, 2.01, 0.38), delay, 0.16)

    t = timeline(1.25)
    chord = np.zeros_like(t)
    for freq in (220.0, 261.63, 329.63, 440.0):
        chord += np.sin(2.0 * np.pi * freq * t)
        chord += 0.30 * np.sin(2.0 * np.pi * freq * 2.01 * t)
    chord *= env_exp(1.25, 0.02, 0.50)
    chord = filt(chord, "low", 2000)
    add(out, chord, 0.0, 0.11)

    n = nsec(1.0)
    t = np.arange(n) / SR
    air = rng.standard_normal(n) * np.exp(-t / 0.50)
    add(out, filt(air, "high", 6000), 0.04, 0.12)

    out = soft_clip(out, 1.2)
    out = reverb(out, 0.42, 1.4, 3.0, 0.60, rng)
    return finalize(out, total, 0.93)


def impact(seed):
    rng = np.random.default_rng(seed)
    total = 0.72
    out = np.zeros(nsec(total))

    sub = sweep(140, 45, 0.40) * env_exp(0.40, 0.003, 0.12)
    add(out, soft_clip(sub, 1.8), 0.0, 0.70)

    n = nsec(0.28)
    t = np.arange(n) / SR
    body = rng.standard_normal(n) * np.exp(-t / 0.07)
    add(out, filt(body, "low", 1800), 0.0, 0.45)

    for freq, delay in ((523.25, 0.0), (659.25, 0.025), (783.99, 0.05)):
        add(out, fm_bell(freq, 0.50, 2.0, 1.5, 0.22), delay, 0.13)

    out = reverb(out, 0.28, 0.8, 3.2, 0.25, rng)
    return finalize(out, total, 0.90)


def special_spawn(seed):
    rng = np.random.default_rng(seed)
    total = 1.0
    out = np.zeros(nsec(total))

    for freq, delay in ((523.25, 0.0), (659.25, 0.045), (783.99, 0.09), (1046.5, 0.135), (1318.5, 0.18)):
        add(out, fm_bell(freq, 0.70, 2.2, 1.5, 0.28), delay, 0.15)

    n = nsec(0.55)
    t = np.arange(n) / SR
    sparkle = rng.standard_normal(n) * np.exp(-t / 0.18)
    add(out, filt(sparkle, "high", 5000), 0.02, 0.10)

    t = timeline(0.85)
    pad = np.zeros_like(t)
    for freq in (261.63, 329.63, 392.0):
        pad += np.sin(2.0 * np.pi * freq * t)
    pad *= env_exp(0.85, 0.02, 0.40)
    add(out, filt(pad, "low", 1600), 0.0, 0.07)

    out = reverb(out, 0.38, 1.0, 3.0, 0.30, rng)
    return finalize(out, total, 0.92)


def match(seed):
    rng = np.random.default_rng(seed)
    total = 0.55
    out = np.zeros(nsec(total))
    add(out, kalimba(523.25, 0.50, rng), 0.0, 0.62)
    add(out, kalimba(783.99, 0.45, rng), 0.06, 0.42)

    n = nsec(0.02)
    t = np.arange(n) / SR
    click = rng.standard_normal(n) * np.exp(-t / 0.004)
    add(out, filt(click, "high", 4000), 0.0, 0.14)

    out = reverb(out, 0.20, 0.6, 3.5, 0.18, rng)
    return finalize(out, total, 0.88)


def match_big(seed):
    rng = np.random.default_rng(seed)
    total = 0.95
    out = np.zeros(nsec(total))
    for freq, delay, gain in (
        (523.25, 0.00, 0.55),
        (659.25, 0.045, 0.50),
        (783.99, 0.09, 0.45),
        (1046.5, 0.135, 0.40),
    ):
        add(out, kalimba(freq, 0.65, rng), delay, gain)

    sub = sweep(120, 50, 0.35) * env_exp(0.35, 0.003, 0.10)
    add(out, soft_clip(sub, 1.5), 0.0, 0.28)

    out = reverb(out, 0.28, 0.8, 3.2, 0.30, rng)
    return finalize(out, total, 0.90)


def clock_tick(seed, low=False):
    """Механический тик настенных часов: щелчок, металл/дерево и короткий хвост."""
    rng = np.random.default_rng(seed)
    total = 0.22 if low else 0.16
    out = np.zeros(nsec(total))

    n = nsec(0.014)
    t = np.arange(n) / SR
    click = rng.standard_normal(n) * np.exp(-t / (0.0022 if low else 0.0016))
    add(out, filt(click, "high", 2200 if low else 3000), 0.0, 0.55)

    if low:
        partials = ((1180.0, 0.55, 0.026), (1720.0, 0.30, 0.018),
                    (640.0, 0.28, 0.042), (2430.0, 0.12, 0.012))
    else:
        partials = ((2140.0, 0.50, 0.018), (3180.0, 0.28, 0.013),
                    (1320.0, 0.30, 0.030), (4600.0, 0.10, 0.009))
    for freq, amp, decay in partials:
        n = nsec(min(0.10, decay * 4.5))
        t = np.arange(n) / SR
        body = np.sin(2.0 * np.pi * freq * t + 0.4 * np.sin(2.0 * np.pi * freq * 0.5 * t))
        body *= np.exp(-t / decay)
        add(out, body, 0.0004, amp)

    thunk = sweep(200 if low else 300, 95 if low else 150, 0.07)
    thunk *= env_exp(0.07, 0.002, 0.022)
    add(out, soft_clip(thunk, 1.1), 0.0, 0.35)

    n = nsec(0.035)
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-t / 0.006)
    add(out, filt(tail, "band", 1500, 5200), 0.004, 0.10)

    out = reverb(out, 0.10, 0.28, 6.0, 0.05, rng)
    return finalize(out, total, 0.82)


def write_wav(x, name):
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767.0).astype(np.int16)
    wav_path = os.path.join(TMP, name + ".wav")
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return wav_path


def to_mp3(x, name):
    wav_path = write_wav(x, name)
    mp3_path = os.path.join(TMP, name + ".mp3")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
         "-codec:a", "libmp3lame", "-b:a", "128k", "-ac", "1", mp3_path],
        check=True,
    )
    with open(mp3_path, "rb") as f:
        data = f.read()
    return base64.b64encode(data).decode("ascii")


def to_wav_b64(x, name):
    """Короткие тики лучше держать в WAV: MP3 смазывает атаку и добавляет задержку."""
    with open(write_wav(x, name), "rb") as f:
        data = f.read()
    return base64.b64encode(data).decode("ascii")


def main():
    samples = {
        "match": match(11),
        "matchBig": match_big(12),
        "lineBlast": line_blast(21),
        "lineBlast2": line_blast(22),
        "sunBlast": sun_blast(31),
        "sunBlast2": sun_blast(32),
        "impact": impact(41),
        "specialSpawn": special_spawn(51),
        "clockTick": clock_tick(61, False),
        "clockTock": clock_tick(62, True),
    }

    encoded = {
        name: (to_wav_b64(data, name) if name.startswith("clock") else to_mp3(data, name))
        for name, data in samples.items()
    }

    lines = [
        "/* Автоматически сгенерированные сэмплы SFX (mono MP3/WAV, base64).",
        "   Генератор: tools/generate_sfx.py. Не редактируйте вручную. */",
        "window.SFX_SAMPLES = {",
    ]
    for name, data in encoded.items():
        lines.append("  %s: '%s'," % (name, data))
    lines.append("};")
    lines.append("")

    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    total = sum(len(v) for v in encoded.values())
    print("Wrote", OUT_JS)
    print("Samples:", len(encoded), "base64 bytes:", total)
    for name, data in encoded.items():
        print(" ", name, len(data), "b64")


if __name__ == "__main__":
    main()
