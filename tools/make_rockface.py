"""Natural rock face for every cliff side: rounded boulders of mixed sizes packed together
(no rows, so it never reads as a built wall), dark gaps between them, soft light from the
upper-left like the painted art, and moss patches on the tops of the stones.

The texture wraps both ways. It covers 2 units across and 1.6 units down, the same as the
cliff mapping in world.ts, so the stones keep their round shape.

Run:  python tools/make_rockface.py      (from the game-claude folder)
"""
import os
import numpy as np
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tex', 'rockface.jpg')
W, H = 1024, 820  # 2 x 1.6 world units -> 512 px per unit both ways
rng = np.random.default_rng(21)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)


def tile_noise(size_px, seed):
    """Soft noise that repeats seamlessly (low-pass filtered white noise via FFT)."""
    r = np.random.default_rng(seed)
    f = np.fft.fft2(r.standard_normal((H, W)))
    fy = np.fft.fftfreq(H)[:, None]
    fx = np.fft.fftfreq(W)[None, :]
    f *= np.exp(-(fx * fx + fy * fy) * (size_px ** 2) * 2.0)
    n = np.real(np.fft.ifft2(f))
    n = (n - n.mean()) / (n.std() + 1e-6)
    return np.clip(n * 0.22 + 0.5, 0, 1).astype(np.float32)


def wrap(d, size):
    d = np.mod(d + size / 2, size) - size / 2
    return d


# --- pack stones: biggest first, each new one must not sit on top of the others -------------
stones = []
for rmax, rmin, tries in [(190, 140, 400), (135, 95, 1500), (90, 60, 3000), (58, 34, 6000)]:
    for _ in range(tries):
        r = rmin + rng.random() * (rmax - rmin)
        x, y = rng.random() * W, rng.random() * H
        ok = True
        for (sx, sy, sr, _t) in stones:
            dx = abs(wrap(x - sx, W)) / 1.12
            dy = abs(wrap(y - sy, H))
            if (dx * dx + dy * dy) ** 0.5 < (r + sr) * 0.8:
                ok = False
                break
        if ok:
            stones.append((x, y, r, rng.random()))

wob = (tile_noise(28, 3) - 0.5) * 0.18
best = np.full((H, W), -1e9, np.float32)
nx = np.zeros((H, W), np.float32)
ny = np.zeros((H, W), np.float32)
nz = np.zeros((H, W), np.float32)
edge = np.zeros((H, W), np.float32)
tone = np.zeros((H, W), np.float32)
for (sx, sy, r, t) in stones:
    dx = wrap(xx - sx, W) / (r * 1.12)  # boulders a little wider than tall
    dy = wrap(yy - sy, H) / r
    d2 = dx * dx + dy * dy
    d = np.sqrt(d2) + wob
    inside = d < 1
    zz = np.sqrt(np.clip(1 - d * d, 0, 1)) * r  # height of a rounded lump
    better = inside & (zz > best)
    best = np.where(better, zz, best)
    nx = np.where(better, dx, nx)
    ny = np.where(better, dy, ny)
    nz = np.where(better, np.sqrt(np.clip(1 - d * d, 0, 1)), nz)
    edge = np.where(better, d, edge)
    tone = np.where(better, t, tone)
gap = best < -1e8

# --- soft painted light from the upper-left, slightly toward the viewer
L = np.array([-0.45, -0.55, 0.7], np.float32)
L /= np.linalg.norm(L)
ndl = np.clip(nx * L[0] + ny * L[1] + nz * L[2], 0, 1)
shade = 0.55 + 0.55 * ndl
shade *= 1 - np.clip((edge - 0.8) / 0.2, 0, 1) * 0.35  # darker toward each stone's edge

lilac = np.array([152, 140, 148], np.float32)
warm = np.array([186, 172, 158], np.float32)
base = lilac * (1 - tone[..., None]) + warm * tone[..., None]
paint = 0.9 + (tile_noise(3, 8)[..., None] - 0.5) * 0.25 + (tile_noise(12, 9)[..., None] - 0.5) * 0.2
col = base * paint * shade[..., None]

# --- moss: soft patches on the upward-facing tops of stones
top = np.clip(-ny * 1.6 - 0.1, 0, 1) * nz
patches = np.clip((tile_noise(70, 12) - 0.42) * 4.0, 0, 1)
speck = tile_noise(4, 13)
moss = np.clip(top * patches * 1.8, 0, 1) * np.clip(speck * 2.2 - 0.45, 0, 1)
moss_col = np.array([108, 146, 50], np.float32) * (0.7 + 0.5 * ndl[..., None])
col = col * (1 - moss[..., None]) + moss_col * moss[..., None]

# gaps between stones: deep shadow with a hint of moss
gap_col = np.array([60, 58, 52], np.float32) * (0.85 + tile_noise(6, 14)[..., None] * 0.3)
col = np.where(gap[..., None], gap_col, col)

img = Image.fromarray(np.clip(col, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
img.save(OUT, quality=90)
print('saved', OUT, img.size, 'stones', len(stones))
