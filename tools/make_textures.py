"""Build seamless painted ground textures out of the painted tile art.

Grass, path and soil: hundreds of small patches are sampled from the tile tops
(only pixels of the right colour), un-squashed from the isometric view, and
stamped with soft edges onto a tile that wraps around, so it repeats with no seam.
Stone wall: a stone face of a cliff piece is flattened and made to repeat sideways.

Run:  python tools/make_textures.py      (from the game-claude folder)
"""
import os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

CAPY = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ART = os.path.join(CAPY, 'Static', 'Approved_World_Art')
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tex')
os.makedirs(OUT, exist_ok=True)

SHEETS = [
    'ChatGPT Image Sep 25, 2026, 03_26_14 PM.png',
    'ChatGPT Image Sep 25, 2026, 03_26_24 PM-1.png',
    'ChatGPT Image Sep 25, 2026, 03_26_32 PM-1.png',
    'ChatGPT Image Sep 25, 2026, 03_25_01 PM.png',
]
ISO_SQUASH = 0.577  # tile tops are seen at 35 degrees: vertical is squashed by sin(35)
rng = np.random.default_rng(7)


def load(name):
    return np.array(Image.open(os.path.join(ART, name)).convert('RGBA')).astype(np.float32)


def hsv_masks(img):
    r, g, b, a = img[..., 0], img[..., 1], img[..., 2], img[..., 3]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    sat = (mx - mn) / (mx + 1e-3)
    opaque = a > 250
    grass = opaque & (g > r * 1.02) & (g > b * 1.45) & (sat > 0.45) & (mx > 90)
    path = opaque & (r > 170) & (r > g * 1.08) & (g > b * 1.25) & (sat > 0.28) & (sat < 0.62)
    soil = opaque & (r > 70) & (r < 150) & (r > g * 1.18) & (g > b * 1.05) & (mx < 150) & (sat > 0.3)
    stone = opaque & (sat < 0.16) & (mx > 95) & (mx < 215)
    return {'grass': grass, 'path': path, 'soil': soil, 'stone': stone}


def collect(kind, pw, ph, count, min_fill=0.97):
    """Random patches (pw x ph in the art) that are almost entirely `kind` pixels."""
    patches = []
    for name in SHEETS:
        img = load(name)
        m = hsv_masks(img)[kind]
        # patch is valid where the box average of the mask is high
        frac = ndimage.uniform_filter(m.astype(np.float32), size=(ph, pw))
        ys, xs = np.nonzero(frac > min_fill)
        if len(ys) == 0:
            continue
        pick = rng.choice(len(ys), size=min(count, len(ys)), replace=False)
        for i in pick:
            cy, cx = ys[i], xs[i]
            y0, x0 = cy - ph // 2, cx - pw // 2
            if y0 < 0 or x0 < 0 or y0 + ph > img.shape[0] or x0 + pw > img.shape[1]:
                continue
            patches.append(img[y0:y0 + ph, x0:x0 + pw, :3].copy())
    print(kind, 'patches', len(patches))
    return patches


def stamp(patches, size, n, unsquash=True, scale=2.0, seed=1):
    """Lay patches on top of each other (soft round edges) on a wrap-around canvas.
    Each new patch covers what is under it, so brush detail is kept (no averaging mush)."""
    r = np.random.default_rng(seed)
    out = np.zeros((size, size, 3), np.float32)
    covered = np.zeros((size, size), bool)
    # first pass: a soft average as an under-layer so nothing is left empty
    base = np.mean([p.reshape(-1, 3).mean(0) for p in patches], axis=0)
    out[:] = base
    for _ in range(n):
        p = patches[r.integers(len(patches))]
        im = Image.fromarray(p.astype(np.uint8))
        w = int(p.shape[1] * scale)
        h = int(p.shape[0] * scale / (ISO_SQUASH if unsquash else 1.0))
        im = im.resize((w, h), Image.BICUBIC)
        if r.random() < 0.5:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        a = np.array(im).astype(np.float32)
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
        wgt = np.clip((1.0 - d) * 2.2, 0, 1)
        oy, ox = r.integers(size), r.integers(size)
        ys = (np.arange(h) + oy) % size
        xs = (np.arange(w) + ox) % size
        blk = out[np.ix_(ys, xs)]
        out[np.ix_(ys, xs)] = blk * (1 - wgt[..., None]) + a * wgt[..., None]
    return out


def finish(arr, name, sharpen=True):
    im = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    if sharpen:
        im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    im.save(os.path.join(OUT, name))
    print('saved', name, im.size)


# --- flat ground textures ------------------------------------------------------
for kind, pw, ph, n in [('grass', 22, 14, 2600), ('path', 20, 12, 2400), ('soil', 18, 12, 2200)]:
    pats = collect(kind, pw, ph, 900)
    if len(pats) < 20:
        print('!! not enough', kind, 'patches')
        continue
    tex = stamp(pats, 512, n, unsquash=True, scale=2.4, seed=hash(kind) % 1000)
    finish(tex, f'{kind}.png')


# --- stone wall: flatten the stone faces of the big cliff pieces ---------------
def seamless_x(arr, blend=60):
    """Make a texture repeat sideways by cross-fading its ends."""
    h, w, _ = arr.shape
    out = arr[:, : w - blend].copy()
    t = np.linspace(0, 1, blend)[None, :, None]
    out[:, :blend] = arr[:, w - blend:] * (1 - t) + arr[:, :blend] * t
    return out


def seamless_y(arr, blend=40):
    h, w, _ = arr.shape
    out = arr[: h - blend].copy()
    t = np.linspace(0, 1, blend)[:, None, None]
    out[:blend] = arr[h - blend:] * (1 - t) + arr[:blend] * t
    return out


stone_pats = collect('stone', 20, 20, 900, min_fill=0.9)
moss_pats = collect('grass', 14, 10, 400)


def stone_wall(size=384, seed=11):
    """Rows of rounded stones (brick pattern, wraps around), each filled with painted stone
    pieces, lit from the top, dark gaps between, moss along the top of some stones."""
    r = np.random.default_rng(seed)
    fill = stamp(stone_pats, size, 700, unsquash=False, scale=2.0, seed=seed + 1)
    moss = stamp(moss_pats, size, 900, unsquash=False, scale=2.0, seed=seed + 2)
    out = np.zeros((size, size, 3), np.float32)
    out[:] = np.array([78, 70, 74], np.float32)  # gaps between stones
    rows = 3
    rh = size / rows
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    for row in range(rows):
        y0 = row * rh
        x = r.uniform(0, size)
        start = x
        while x < start + size:
            w = r.uniform(size * 0.22, size * 0.5)
            cx = (x + w / 2) % size
            cy = y0 + rh / 2 + r.uniform(-7, 7)
            hw = w / 2 - 2
            hh = rh / 2 - 2 + r.uniform(-5, 3)
            # wrapped distance so stones cross the edges cleanly
            dx = np.abs(((xx - cx + size / 2) % size) - size / 2)
            dy = np.abs(((yy - cy + size / 2) % size) - size / 2)
            # rounded box (superellipse) with a wobbly outline
            wob = 1 + 0.09 * np.sin(xx * 0.06 + r.uniform(0, 6)) * np.cos(yy * 0.05 + r.uniform(0, 6))
            k = ((dx / hw) ** 3 + (dy / hh) ** 3) ** (1 / 3) * wob
            inside = k < 1.0
            edge = np.clip((1.0 - k) * 6, 0, 1)
            # light from above: top of each stone lighter, bottom darker
            rel = np.clip((yy - (cy - hh)) / (2 * hh), 0, 1)
            shade = (1.32 - rel * 0.5) * (0.68 + 0.32 * edge)
            tone = r.uniform(0.95, 1.15)
            tint = np.array([1.06, 1.0, 1.02]) * tone
            col = fill * shade[..., None] * tint
            # moss on the upper part of some stones
            if r.random() < 0.55:
                mm = np.clip((0.35 - rel) * 4, 0, 1) * (np.sin(xx * 0.11 + r.uniform(0, 6)) * 0.5 + 0.5)
                col = col * (1 - mm[..., None] * 0.85) + moss * mm[..., None] * 0.85
            m = inside[..., None] * edge[..., None] ** 0.35
            out = out * (1 - m) + col * m
            x += w
    return out


finish(stone_wall(), 'stone.png', sharpen=False)
