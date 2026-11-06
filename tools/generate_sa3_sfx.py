#!/usr/bin/env python3
"""Генератор новых SFX для «Сокровища Солнца» через Stable Audio 3 (MLX, sm-sfx).

Для каждого звука из таблицы SOUNDS:
  1. зовёт ./sa3 (модель sm-sfx + декодер same-s) на трёх сидах (кэшируется);
  2. сводит в моно, убирает тишину в начале, обрезает хвост по затуханию,
     делает 30 мс fade-out и выравнивает громкость под существующие сэмплы;
  3. кладёт кандидатов в tools/sfx-candidates/<name>-{a,b,c}.mp3 (+ manifest.json);
  4. выбирает лучшего (поле "pick" в таблице или по объективным метрикам);
  5. переписывает таблицу сэмплов между маркерами в js/sfx-sa3.js
     и страницу прослушивания tools/sfx-audition.html.

Только stdlib + subprocess (нужен ffmpeg). Сеть не нужна: модели уже в кэше,
запуск идёт с HF_HUB_OFFLINE=1 / UV_OFFLINE=1.

  python3 tools/generate_sa3_sfx.py               # все звуки
  python3 tools/generate_sa3_sfx.py --only goGong # один звук, остальные из кандидатов
  python3 tools/generate_sa3_sfx.py --pack-only   # только пересобрать JS и HTML
"""
import argparse
import array
import base64
import hashlib
import html
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_JS = os.path.join(ROOT, "js", "sfx-sa3.js")
CAND_DIR = os.path.join(ROOT, "tools", "sfx-candidates")
MANIFEST = os.path.join(CAND_DIR, "manifest.json")
AUDITION = os.path.join(ROOT, "tools", "sfx-audition.html")
DEFAULT_SA3 = os.environ.get(
    "SA3_DIR",
    os.path.expanduser("~/opencode-projects/deepseek/audio-lab/stable-audio-3/optimized/mlx"),
)
SR = 44100
BITRATE = "80k"
SEEDS = (("a", 101), ("b", 202), ("c", 303))
BEGIN = "/* @@SA3-SAMPLES-BEGIN (генерирует tools/generate_sa3_sfx.py) */"
END = "/* @@SA3-SAMPLES-END */"

NEG_SFX = ("music, melody, vocals, speech, loop, continuous, sustained, ambience, texture, "
           "background noise, hum, long reverb, distortion")
NEG_JINGLE = ("vocals, speech, singing, loop, ambience, background noise, hum, "
              "long reverb, distortion, drum loop")

# SA3 на коротких отрезках «заполняет» всё время ровной текстурой, поэтому
# генерируем 3 с, ищем в них главное событие и вырезаем до max секунд.
# max — предел длины, lufs — цель громкости (по замерам js/sfx-samples.js:
# match ≈ -12, specialSpawn ≈ -14, взрывы ≈ -15…-17 LUFS); peak — для коротких.
GEN = 3.0
SOUNDS = [
    {"name": "spawnLine", "max": 1.1, "lufs": -14.5,
     "prompt": "single electric zap crackle with a bright metallic ping, one-shot, magic game sound effect, quick decay"},
    {"name": "spawnSun", "max": 1.5, "lufs": -14.5,
     "prompt": "rising golden magic shimmer ending in a bright bell chime, one-shot game sound effect"},
    {"name": "spawnBomb", "max": 1.3, "lufs": -14.5,
     "prompt": "short fuse hiss then a single heavy stone thud, one-shot game sound effect"},
    {"name": "spawnTotem", "max": 1.3, "lufs": -14.5,
     "prompt": "single deep wooden tribal drum hit with a low resonant boom, one-shot game sound effect"},
    {"name": "blastBomb", "max": 1.8, "lufs": -16.0,
     "prompt": "single stone explosion, deep boom with rock debris falling, one-shot game sound effect"},
    {"name": "blastTotem", "max": 1.5, "lufs": -16.0,
     "prompt": "single resonant magical whoosh ending in a hard wooden knock, one-shot game sound effect"},
    {"name": "combo4", "max": 0.9, "lufs": -15.0,
     "prompt": "short bright marimba rising three-note hit, positive reward, one-shot game sound effect"},
    {"name": "combo6", "max": 1.1, "lufs": -14.5,
     "prompt": "bright rising bell chime flourish, exciting combo reward, one-shot game sound effect"},
    {"name": "combo8", "max": 1.4, "lufs": -14.0,
     "prompt": "big triumphant rising bell chime burst with sparkle, maximum combo reward, one-shot game sound effect"},
    {"name": "goGong", "max": 2.0, "lufs": -15.0,
     "prompt": "single large bronze gong strike, one hit, shimmering decay, game start sound effect"},
    {"name": "victory", "max": 2.4, "lufs": -15.0, "neg": NEG_JINGLE,
     "prompt": "short triumphant tribal horn fanfare with a marimba flourish, victory jingle, game sound effect"},
    {"name": "defeat", "max": 1.6, "lufs": -16.0, "neg": NEG_JINGLE,
     "prompt": "descending soft low wooden flute notes with a gentle stone thump, sad game over jingle"},
    {"name": "shuffle", "max": 0.9, "lufs": -16.0,
     "prompt": "single quick airy whoosh with small stones rattling, one-shot game sound effect"},
    {"name": "uiClick", "max": 0.12, "min": 0.03, "wav": True, "peak": -2.0,
     "prompt": "very short dry wooden tick, UI button click, single click"},
    {"name": "hintChime", "max": 0.9, "lufs": -16.0,
     "prompt": "soft glassy two-note chime, gentle notification ding, one-shot game sound effect"},
]


def db(x):
    return 20.0 * math.log10(max(x, 1e-9))


def run_sa3(sa3_dir, snd, seed, out_wav, cfg, steps):
    env = dict(os.environ, HF_HUB_OFFLINE="1", UV_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    cmd = [
        "./sa3", "--dit", "sm-sfx", "--decoder", "same-s",
        "--prompt", snd["prompt"], "--negative-prompt", snd.get("neg", NEG_SFX),
        "--cfg", str(cfg), "--steps", str(steps), "--seed", str(seed),
        "--seconds", str(GEN), "--out", out_wav,
    ]
    r = subprocess.run(cmd, cwd=sa3_dir, env=env, stdin=subprocess.DEVNULL,
                       capture_output=True, text=True)
    log = r.stdout + r.stderr
    if r.returncode != 0 or not os.path.exists(out_wav):
        if re.search(r"download|huggingface|Fetching", log, re.I):
            sys.exit("sa3 попытался скачать модель — остановлено:\n" + log[-1500:])
        sys.exit("sa3 завершился с ошибкой:\n" + log[-1500:])


def read_wav(path):
    with wave.open(path, "rb") as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw != 2 or sr != SR:
        sys.exit("неожиданный формат WAV: %s" % path)
    pcm = array.array("h", raw)
    clips = sum(1 for v in pcm if v >= 32766 or v <= -32767)
    if ch == 1:
        return [v / 32768.0 for v in pcm], clips, 0.0
    left = [pcm[i] / 32768.0 for i in range(0, len(pcm), ch)]
    right = [pcm[i + 1] / 32768.0 for i in range(0, len(pcm), ch)]
    mono = [(a + b) * 0.5 for a, b in zip(left, right)]

    def rms(x):
        return math.sqrt(sum(v * v for v in x) / max(1, len(x)))
    drop = db((rms(left) + rms(right)) * 0.5) - db(rms(mono))
    return mono, clips, drop


def write_wav(path, x):
    pcm = array.array("h", (int(max(-1.0, min(1.0, v)) * 32767) for v in x))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def ebur128(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
                        "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    i = re.findall(r"I:\s+(-?[\d.]+) LUFS", r)
    p = re.findall(r"Peak:\s+(-?[\d.inf]+) dBFS", r)
    lufs = float(i[-1]) if i else -70.0
    try:
        tp = float(p[-1]) if p else 0.0
    except ValueError:
        tp = -90.0
    return lufs, tp


def limit_boost(y, boost_db, path):
    """+boost_db дБ через ffmpeg alimiter с потолком −1 дБFS (без автоуровня)."""
    write_wav(path, y)
    out = path[:-4] + "-lim.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", path, "-af",
                    "volume=%.2fdB,alimiter=limit=0.891:attack=2:release=60:level=false"
                    ":latency=true" % boost_db,
                    "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", out], check=True)
    z, _, _ = read_wav(out)
    return z[:len(y)]


def process(snd, raw_wav, tmp):
    """Моно → поиск главного события → обрезка → огибающая затухания → fade →
    громкость. Возвращает (сигнал | None, метрики)."""
    x, clips, mono_drop = read_wav(raw_wav)
    mean = sum(x) / len(x)
    x = [v - mean for v in x]
    peak = max(abs(v) for v in x)
    m = {"clips": clips, "monoDropDb": round(mono_drop, 1), "rawPeakDb": round(db(peak), 1)}
    if peak < 0.01:
        m["reject"] = "near-silent"
        return None, m

    hop = SR // 100  # огибающая: RMS по 10 мс
    env = [db(math.sqrt(sum(v * v for v in x[i:i + hop]) / hop)) for i in range(0, len(x) - hop + 1, hop)]
    pe = max(env)
    onset = next(k for k, e in enumerate(env) if e >= pe - 15)
    m["eventAt"] = round(onset / 100.0, 2)
    m["leadMs"] = 15
    start = max(0, onset * hop - int(0.015 * SR))
    limit = onset + int(snd["max"] * 100)
    alive = [k for k in range(onset, min(len(env), limit)) if env[k] > pe - 45]
    end_k = min(alive[-1] + 2, limit) if alive else limit
    end = min(len(x), end_k * hop)
    y = x[start:end]
    dur = len(y) / SR
    m["dur"] = round(dur, 3)
    seg = env[start // hop:end // hop] or [pe]

    # Естественное затухание (до нашей огибающей) и «удар» в начале.
    m["tailDb"] = round(sum(seg[-10:]) / len(seg[-10:]) - max(seg), 1)
    m["punchDb"] = round(max(seg[:20]) - sorted(seg)[len(seg) // 2], 1)
    m["cutAtEnd"] = end >= len(x) and end_k < limit

    # SA3 часто тянет звук до конца отрезка: досылаем мягкое затухание
    # (держим первые 30 %, к концу −30 дБ) и 30 мс fade-out.
    n = len(y)
    hold = max(int(0.3 * n), min(n, int(0.08 * SR)))
    for i in range(hold, n):
        u = (i - hold) / max(1, n - hold)
        y[i] *= 10 ** (-1.5 * u ** 1.5)
    fi, fo = int(0.003 * SR), min(n, int(0.03 * SR))
    for i in range(fi):
        y[i] *= i / fi
    for i in range(fo):
        y[-fo + i] *= 1.0 - (i + 1) / fo

    reasons = []
    if clips > 0:
        reasons.append("clipped")
    if dur < snd.get("min", 0.3) or dur > 2.5:
        reasons.append("duration")
    if reasons:
        m["reject"] = ",".join(reasons)

    probe = os.path.join(tmp, snd["name"] + "-probe.wav")
    write_wav(probe, y)
    lufs, tp = ebur128(probe)
    ypeak = max(abs(v) for v in y)
    if "lufs" in snd and lufs > -60 and dur >= 0.4:
        gain = min(snd["lufs"] - lufs, -1.0 - tp)
    else:
        gain = snd.get("peak", -1.6) - db(ypeak)
    k = 10 ** (gain / 20.0)
    y = [v * k for v in y]
    m["gainDb"] = round(gain, 1)
    m["lufsIn"] = lufs
    # Ударные звуки упираются в пиковый потолок раньше, чем доходят до цели
    # по громкости: добираем до 6 дБ мягким лимитером (как у старых сэмплов,
    # которые тоже сжаты soft_clip).
    if "lufs" in snd and lufs > -60 and dur >= 0.4:
        boost = min(6.0, snd["lufs"] - lufs - gain)
        if boost > 1.0:
            y = limit_boost(y, boost, probe)
            m["limitDb"] = round(boost, 1)

    # Автовыбор: выше балл у звуков, которые сами затухают и начинаются с удара;
    # штраф за фазовые потери в моно и за событие, обрезанное концом генерации.
    score = 50.0 + min(40.0, -m["tailDb"]) * 0.8 + min(20.0, max(0.0, m["punchDb"])) * 0.8
    if mono_drop > 3:
        score -= 15
    if m["cutAtEnd"] or dur < snd["max"] * 0.5:
        score -= 15
    m["score"] = round(score, 1)
    return y, m


def encode(snd, y, out_path, tmp):
    wav = os.path.join(tmp, snd["name"] + "-final.wav")
    write_wav(wav, y)
    if snd.get("wav"):
        os.replace(wav, out_path)
        return
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-ac", "1",
                    "-ar", str(SR), "-codec:a", "libmp3lame", "-b:a", BITRATE, out_path],
                   check=True)


def ext(snd):
    return "wav" if snd.get("wav") else "mp3"


def generate(snd, sa3_dir, cache, cfg, steps, manifest):
    entry = {"prompt": snd["prompt"], "neg": snd.get("neg", NEG_SFX), "cfg": cfg,
             "steps": steps, "gen": GEN, "candidates": {}}
    tmp = tempfile.mkdtemp(prefix="sa3-sfx-")
    for letter, seed in SEEDS:
        key = hashlib.sha1(json.dumps([snd["prompt"], entry["neg"], GEN, seed, cfg, steps])
                           .encode()).hexdigest()[:12]
        raw = os.path.join(cache, "%s-%s-%s.wav" % (snd["name"], letter, key))
        if not os.path.exists(raw):
            print("  sa3 %s seed %d" % (snd["name"], seed), flush=True)
            run_sa3(sa3_dir, snd, seed, raw, cfg, steps)
        y, m = process(snd, raw, tmp)
        m["seed"] = seed
        if y is not None:
            encode(snd, y, os.path.join(CAND_DIR, "%s-%s.%s" % (snd["name"], letter, ext(snd))), tmp)
        entry["candidates"][letter] = m
        print("   %s-%s %s" % (snd["name"], letter, json.dumps(m, ensure_ascii=False)))
    ok = {k: v for k, v in entry["candidates"].items() if "reject" not in v}
    pool = ok or {k: v for k, v in entry["candidates"].items() if v.get("dur")}
    if snd.get("pick"):
        entry["pick"], entry["pickedBy"] = snd["pick"], "table"
    elif pool:
        entry["pick"] = max(pool, key=lambda k: pool[k]["score"])
        entry["pickedBy"] = "metrics"
    manifest[snd["name"]] = entry


def pack(manifest):
    order = [s["name"] for s in SOUNDS if s["name"] in manifest and manifest[s["name"]].get("pick")]
    lines = ["window.SFX_SA3_SAMPLES = {"]
    total = 0
    for name in order:
        snd = next(s for s in SOUNDS if s["name"] == name)
        path = os.path.join(CAND_DIR, "%s-%s.%s" % (name, manifest[name]["pick"], ext(snd)))
        with open(path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        total += len(b64)
        lines.append("  %s: '%s'," % (name, b64))
    lines.append("};")
    block = BEGIN + "\n" + "\n".join(lines) + "\n" + END

    with open(OUT_JS, encoding="utf-8") as f:
        src = f.read()
    if BEGIN in src and END in src:
        src = src[:src.index(BEGIN)] + block + src[src.index(END) + len(END):]
    else:
        sys.exit("в js/sfx-sa3.js нет маркеров %s … %s" % (BEGIN, END))
    with open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(src)
    print("Wrote %s: %d samples, %d base64 bytes" % (OUT_JS, len(order), total))


def audition(manifest):
    rows = []
    for snd in SOUNDS:
        e = manifest.get(snd["name"])
        if not e:
            continue
        cells = []
        for letter, _ in SEEDS:
            m = e["candidates"].get(letter, {})
            fn = "sfx-candidates/%s-%s.%s" % (snd["name"], letter, ext(snd))
            chosen = e.get("pick") == letter
            info = "seed %s · %ss · хвост %s дБ · балл %s%s" % (
                m.get("seed"), m.get("dur"), m.get("tailDb"), m.get("score"),
                " · ОТКЛОНЁН: " + m["reject"] if "reject" in m else "")
            player = ('<audio controls preload="none" src="%s"></audio>' % fn
                      if os.path.exists(os.path.join(ROOT, "tools", fn)) else "<em>нет файла</em>")
            cells.append('<div class="cand%s"><b>%s%s</b> %s<small>%s</small></div>' % (
                " chosen" if chosen else "", letter, " ✔ в игре" if chosen else "", player, html.escape(info)))
        rows.append('<section><h2>%s</h2><p class="prompt">%s<br><span>neg: %s · cfg %s · steps %s</span></p>%s</section>'
                    % (snd["name"], html.escape(e["prompt"]), html.escape(e["neg"]),
                       e["cfg"], e["steps"], "".join(cells)))
    page = """<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Сокровища Солнца — прослушивание SFX (Stable Audio 3)</title>
<style>
body{font:15px/1.4 system-ui,sans-serif;background:#1b1510;color:#f3e6cc;margin:24px auto;max-width:1100px;padding:0 16px}
h1{font-size:22px}h2{font-size:17px;margin:0 0 4px;color:#ffd27a}
section{border:1px solid #4a3a26;border-radius:10px;padding:12px 14px;margin:12px 0;background:#241c14}
.prompt{margin:0 0 8px;color:#e8d8b8}.prompt span{color:#a89676;font-size:13px}
.cand{display:inline-flex;flex-direction:column;gap:4px;margin:4px 10px 4px 0;padding:6px 8px;border-radius:8px;border:1px solid transparent}
.cand.chosen{border-color:#ffd27a;background:#3a2c18}small{color:#a89676}audio{width:300px}
</style></head><body>
<h1>Прослушивание новых SFX (Stable Audio 3, sm-sfx)</h1>
<p>По три кандидата на звук. Рамкой отмечен тот, что встроен в игру (выбран по метрикам, не на слух).
Чтобы выбрать другой — впишите <code>"pick": "b"</code> в таблицу SOUNDS в <code>tools/generate_sa3_sfx.py</code>
и запустите <code>python3 tools/generate_sa3_sfx.py --pack-only</code>.</p>
%s
</body></html>
""" % "\n".join(rows)
    with open(AUDITION, "w", encoding="utf-8") as f:
        f.write(page)
    print("Wrote", AUDITION)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", action="append", help="сгенерировать только этот звук (можно несколько раз)")
    ap.add_argument("--pack-only", action="store_true", help="не звать sa3, только пересобрать JS и HTML")
    ap.add_argument("--sa3", default=DEFAULT_SA3, help="папка с ./sa3 (MLX)")
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "sun-sa3-cache"),
                    help="кэш сырых WAV от sa3")
    ap.add_argument("--cfg", type=float, default=3.5)
    ap.add_argument("--steps", type=int, default=8)
    args = ap.parse_args()

    os.makedirs(CAND_DIR, exist_ok=True)
    os.makedirs(args.cache, exist_ok=True)
    manifest = {}
    if os.path.exists(MANIFEST):
        with open(MANIFEST, encoding="utf-8") as f:
            manifest = json.load(f)
    names = {s["name"] for s in SOUNDS}
    if args.only and not set(args.only) <= names:
        sys.exit("неизвестный звук: %s" % ", ".join(sorted(set(args.only) - names)))

    if not args.pack_only:
        for snd in SOUNDS:
            if args.only and snd["name"] not in args.only:
                continue
            generate(snd, args.sa3, args.cache, args.cfg, args.steps, manifest)
        with open(MANIFEST, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=1)
    for snd in SOUNDS:  # ручной выбор из таблицы действует и при --pack-only
        if snd.get("pick") and snd["name"] in manifest:
            manifest[snd["name"]]["pick"], manifest[snd["name"]]["pickedBy"] = snd["pick"], "table"
    pack(manifest)
    audition(manifest)


if __name__ == "__main__":
    main()
