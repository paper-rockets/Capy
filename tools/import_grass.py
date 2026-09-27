"""Grass choices for the ground (picked by the user on 2026-09-26), switchable in the Debug panel.

g1..g3 come from the Trees Terrains texture folder as they are (already repeat cleanly).
g4 is the user's bright clover-and-flowers picture; its edges don't quite meet, so they are
cross-faded with a half-shifted copy (narrow fade so flowers and pebbles don't ghost).

Run:  python tools/import_grass.py      (from the game-claude folder)
"""
import os
import numpy as np
from PIL import Image

# (same fades as import_codex_textures.py, copied: importing that file would re-run its whole import)
def fade_x(a, frac):
    h, w = a.shape[:2]
    rolled = np.roll(a, w // 2, axis=1)
    x = np.arange(w) / (w - 1)
    m = np.clip(np.minimum(x, 1 - x) / frac, 0, 1)
    m = m * m * (3 - 2 * m)
    return a * m[None, :, None] + rolled * (1 - m[None, :, None])


def fade_y(a, frac):
    return np.transpose(fade_x(np.transpose(a, (1, 0, 2)), frac), (1, 0, 2))


def seam_ratio(a):
    inner = np.abs(a[:, 1:] - a[:, :-1]).mean()
    return np.abs(a[:, 0] - a[:, -1]).mean() / inner, np.abs(a[0] - a[-1]).mean() / np.abs(a[1:] - a[:-1]).mean()


OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tex')
TT = r'E:\X Flight\Surgery\Trees Terrains\assets\textures\Grass'

for src, out in [('seamless_grass_01.png', 'grass_g1.jpg'), ('grass (1).png', 'grass_g2.jpg'), ('grass2.png', 'grass_g3.jpg')]:
    Image.open(os.path.join(TT, src)).convert('RGB').save(os.path.join(OUT, out), quality=92)
    print('saved', out)

a = np.asarray(Image.open(r'C:\Users\macie\Downloads\4f300160-fc1e-4389-aeef-f41eb03ba241.png').convert('RGB')).astype(np.float32)
print('g4 seam ratio before  L-R %.2f  T-B %.2f' % seam_ratio(a))
a = fade_y(fade_x(a, 0.12), 0.12)
print('g4 seam ratio after   L-R %.2f  T-B %.2f' % seam_ratio(a))
Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'grass_g4.jpg'), quality=92)
print('saved grass_g4.jpg')
