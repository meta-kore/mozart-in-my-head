"""Build looping section stems for Mozart 40 (mvt 1 exposition) from Spheres lines.

usage: python -I make_stems.py SRC_DIR OUT_DIR

SRC_DIR holds the start (at least 150 s) of each Mozart StereoMix line from
The Spheres Dataset, named <Line>.flac (Violin_1.flac, Bass.flac, ...). The
full archive is 25 GB; httpzip.py fetches just the start of each file:

  python -I httpzip.py list URL Mozart/StereoMix
  python -c "import httpzip; httpzip.head(URL, MEMBER, 'src/Violin_1.flac', NBYTES)"

with URL = https://zenodo.org/api/records/17347681/files/TheSpheresDataset-Multichannel.zip/content
and NBYTES about a tenth of the member's size. The audio this produces is an
adaptation of a CC BY-SA 4.0 work and carries that licence; see CREDITS.md.
"""
import json
import subprocess
import sys

import numpy as np

SRC, OUT = sys.argv[1], sys.argv[2]
SR = 48000
SECTIONS = {
    "violins-1": ["Violin_1"],
    "violins-2": ["Violin_2"],
    "violas": ["Viola"],
    "cellos-basses": ["Cello", "Bass"],
    "flute-oboes": ["Flute", "Oboe_1", "Oboe_2"],
    "clarinets-bassoons": ["Clarinet_1", "Clarinet_2", "Bassoon_1", "Bassoon_2"],
    "horns": ["Horn_1", "Horn_2"],
}
COARSE_LOOP = 123.56  # from chroma matching
XFADE = 0.04


def load(name):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", f"{SRC}/{name}.flac", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, check=True,
    ).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


lines = {n: load(n) for names in SECTIONS.values() for n in names}
L = min(len(v) for v in lines.values())
lines = {k: v[:L] for k, v in lines.items()}
print(f"decoded {L / SR:.1f}s per line")

# Start just before the first note of the piece.
strings = lines["Violin_1"] + lines["Violin_2"] + lines["Viola"] + lines["Cello"] + lines["Bass"]
first = int(np.argmax(np.abs(strings) > 10 ** (-50 / 20)))
t0 = max(0, first - int(0.05 * SR))
print(f"first note at {first / SR:.3f}s, loop starts at {t0 / SR:.3f}s")


# Refine the loop length by matching the onset envelope (5 ms frames) of the
# opening against the repeat, +-150 ms around the coarse estimate.
def envelope(x, hop=240):
    n = len(x) // hop
    e = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(1))
    d = np.maximum(0, np.diff(np.log(e + 1e-6)))
    return d


hop = 240
env = envelope(strings, hop)
fps = SR / hop
a = env[int(t0 / hop): int(t0 / hop + 20 * fps)]
best = None
for k in range(int((COARSE_LOOP - 0.15) * fps), int((COARSE_LOOP + 0.15) * fps)):
    b = env[int(t0 / hop) + k: int(t0 / hop) + k + len(a)]
    c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    if best is None or c > best[0]:
        best = (c, k)
loop_len = int(best[1] * hop)
print(f"loop length {loop_len / SR:.4f}s (onset match {best[0]:.3f})")
assert t0 + loop_len + int(XFADE * SR) < L, "not enough audio after the loop point"

# Crossfade the seam: the head of the stem blends in the audio that naturally
# follows the loop end, so the jump from the last sample back to the first is
# continuous.
F = int(XFADE * SR)
fade_in = np.sin(np.linspace(0, np.pi / 2, F)) ** 2
fade_out = 1 - fade_in
stems = {}
for sec, names in SECTIONS.items():
    x = sum(lines[n] for n in names)
    y = x[t0: t0 + loop_len].copy()
    y[:F] = x[t0: t0 + F] * fade_in + x[t0 + loop_len: t0 + loop_len + F] * fade_out
    stems[sec] = y

mix = sum(stems.values())
peak = float(np.max(np.abs(mix)))
gain = 10 ** (-1 / 20) / peak  # whole mix peaks at -1 dBFS; sections keep their balance
print(f"mix peak {20 * np.log10(peak):.1f} dBFS, applying {20 * np.log10(gain):+.1f} dB to every stem")

meta = {"loopSeconds": loop_len / SR, "sampleRate": SR, "sections": {}}
for sec, y in stems.items():
    y = (y * gain).astype(np.float32)
    rms = float(np.sqrt(np.mean(y.astype(np.float64) ** 2)))
    path = f"{OUT}/{sec}.ogg"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
         "-c:a", "libopus", "-b:a", "80k", "-application", "audio", path],
        input=y.tobytes(), check=True,
    )
    meta["sections"][sec] = {"lines": SECTIONS[sec], "rmsDb": round(20 * np.log10(rms + 1e-12), 1)}
    print(f"{sec:20s} rms {20 * np.log10(rms + 1e-12):6.1f} dB -> {path}")

print(json.dumps(meta, indent=2))
