"""Build looping section stems for Tchaikovsky's Romeo and Juliet (the love
theme) from The Spheres Dataset's separately recorded lines.

usage:
  python -I make_stems_rj.py analyse SRC_DIR [FROM_S TO_S]
      print each section's loudness every 2 s, to choose the excerpt
  python -I make_stems_rj.py build SRC_DIR OUT_DIR START_S END_S [XFADE_S]
      write <section>.ogg looping START_S..END_S, the seam crossfaded

SRC_DIR holds the Tchaikovsky StereoMix lines (<Line>.flac). Only the start
of each file is needed, up to the excerpt's end: the archive's members are
compressed, so they are read from the beginning (see httpzip.py `head`).
The audio this produces is an adaptation of a CC BY-SA 4.0 work and carries
that licence; see CREDITS.md.
"""
import json
import subprocess
import sys

import numpy as np

SR = 48000
SECTIONS = {
    "rj-violins": ["Violin_1_1", "Violin_1_2", "Violin_2_1", "Violin_2_2"],
    "rj-flutes-oboes": ["Flute_1", "Flute_2", "Piccolo", "Oboe_1", "Oboe_2", "coranglais"],
    "rj-clarinets-bassoons": ["Clarinet_1", "Clarinet_2", "Bassoon_1", "Bassoon_2"],
    "rj-brass": ["Horn_1", "Horn_2", "Horn_3", "Horn_4", "Trumpet_1", "Trumpet_2", "Trombone_1", "Trombone_2", "Trombone_3", "Tuba"],
    "rj-harp-percussion": ["Harp", "Timpani", "untunedpercussion_1", "untunedpercussion_2"],
    "rj-violas": ["Viola_1", "Viola_2"],
    "rj-cellos-basses": ["Cello_1", "Cello_2", "Bass"],
}


def load(src, name, start=0.0, dur=None, sr=SR):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start)]
    if dur:
        cmd += ["-t", str(dur)]
    cmd += ["-i", f"{src}/{name}.flac", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def sections(src, start=0.0, dur=None, sr=SR):
    out = {}
    for sec, names in SECTIONS.items():
        parts = [p for p in (load(src, n, start, dur, sr) for n in names) if len(p)]
        if not parts:
            parts = [np.zeros(int((dur or 1) * sr))]
        n = min(len(p) for p in parts)
        out[sec] = sum(p[:n] for p in parts)
    n = min(len(v) for v in out.values())
    return {k: v[:n] for k, v in out.items()}


def analyse(src, t0, t1):
    sr = 4000
    secs = sections(src, t0, t1 - t0, sr)
    hop = 2 * sr
    names = list(secs)
    print("time   " + " ".join(f"{k[3:13]:>10s}" for k in names))
    n = min(len(v) for v in secs.values()) // hop
    for i in range(n):
        row = []
        for k in names:
            x = secs[k][i * hop:(i + 1) * hop]
            row.append(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9))
        t = t0 + i * 2
        print(f"{int(t // 60)}:{t % 60:04.1f} " + " ".join(f"{v:10.0f}" for v in row))


def build(src, out, start, end, xfade):
    secs = sections(src, start, end - start + xfade + 1.0)
    loop_len = int((end - start) * SR)
    F = int(xfade * SR)
    # Equal-power crossfade: the loop's head blends in what naturally follows
    # its end, so the jump back to the start is continuous.
    fade_in = np.sin(np.linspace(0, np.pi / 2, F)) ** 2
    fade_out = 1 - fade_in
    stems = {}
    for sec, x in secs.items():
        assert len(x) >= loop_len + F, f"{sec}: not enough audio ({len(x) / SR:.1f}s)"
        y = x[:loop_len].copy()
        y[:F] = x[:F] * np.sqrt(fade_in) + x[loop_len:loop_len + F] * np.sqrt(fade_out)
        stems[sec] = y
    mix = sum(stems.values())
    peak = float(np.max(np.abs(mix)))
    gain = 10 ** (-1 / 20) / peak
    print(f"mix peak {20 * np.log10(peak):.1f} dBFS, applying {20 * np.log10(gain):+.1f} dB to every stem")
    meta = {"loopSeconds": loop_len / SR, "start": start, "end": end, "xfade": xfade, "sections": {}}
    for sec, y in stems.items():
        y = (y * gain).astype(np.float32)
        rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
        path = f"{out}/{sec}.ogg"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
             "-c:a", "libopus", "-b:a", "80k", "-application", "audio", path],
            input=y.tobytes(), check=True,
        )
        meta["sections"][sec] = {"lines": SECTIONS[sec], "rmsDb": round(20 * np.log10(rms + 1e-12), 1)}
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    if sys.argv[1] == "analyse":
        a = float(sys.argv[3]) if len(sys.argv) > 3 else 0
        b = float(sys.argv[4]) if len(sys.argv) > 4 else 880
        analyse(sys.argv[2], a, b)
    else:
        build(sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]) if len(sys.argv) > 6 else 3.0)
