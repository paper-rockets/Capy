"""Import the Codex/Gemini ground textures into the game.

Each picture is made to repeat without a seam: the texture is cross-faded with a copy
of itself shifted by half, first sideways then up-down (the shifted copy is continuous
at the edges; the original is kept in the middle). Opaque textures are saved as JPG,
see-through ones (grass lip, ground details) as PNG.

Run:  python tools/import_codex_textures.py      (from the game-claude folder)
"""
import os
import numpy as np
from PIL import Image

CAPY = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'tex')
os.makedirs(OUT, exist_ok=True)

SRC = {
    'grass': 'ChatGPT Image Sep 25, 2026, 10_51_25 PM.png',
    'grass_flowers': 'ChatGPT Image Sep 25, 2026, 10_51_17 PM.png',
    'grass_lush': 'Gemini_Generated_Image_a3i7sya3i7sya3i7.jpg',
    'path': 'ChatGPT Image Sep 25, 2026, 10_51_30 PM.png',
    'stone': 'ChatGPT Image Sep 25, 2026, 10_51_35 PM.png',
    'soil': 'Gemini_Generated_Image_3ndi5b3ndi5b3ndi.jpg',
    'riverbed': 'Gemini_Generated_Image_exincuexincuexin.jpg',
    'paving': 'Gemini_Generated_Image_60v7jh60v7jh60v7.jpg',
    'lip': 'ChatGPT Image Sep 25, 2026, 10_51_40 PM.png',
    'decals': 'ChatGPT Image Sep 25, 2026, 10_50_55 PM.png',
}


def fade_x(a, frac):
    """Cross-fade with a half-shifted copy so the left and right edges meet cleanly."""
    h, w = a.shape[:2]
    rolled = np.roll(a, w // 2, axis=1)
    x = np.arange(w) / (w - 1)
    # 1 in the middle, 0 at the edges, soft ramps `frac` wide
    m = np.clip(np.minimum(x, 1 - x) / frac, 0, 1)
    m = m * m * (3 - 2 * m)
    m = m[None, :, None]
    return a * m + rolled * (1 - m)


def fade_y(a, frac):
    return np.transpose(fade_x(np.transpose(a, (1, 0, 2)), frac), (1, 0, 2))


def seam_ratio(a):
    inner = np.abs(a[:, 1:] - a[:, :-1]).mean()
    return np.abs(a[:, 0] - a[:, -1]).mean() / inner, np.abs(a[0] - a[-1]).mean() / np.abs(a[1:] - a[:-1]).mean()


def load(name, mode):
    return np.asarray(Image.open(os.path.join(CAPY, name)).convert(mode)).astype(np.float32)


def save(a, name, size=None, jpg=True):
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if size:
        im = im.resize(size, Image.LANCZOS)
    path = os.path.join(OUT, name + ('.jpg' if jpg else '.png'))
    if jpg:
        im.convert('RGB').save(path, quality=90)
    else:
        im.save(path)
    print('saved', os.path.basename(path), im.size)


for key in ['grass', 'grass_flowers', 'grass_lush', 'path', 'soil', 'riverbed', 'paving']:
    a = load(SRC[key], 'RGB')
    a = fade_y(fade_x(a, 0.22), 0.22)
    rx, ry = seam_ratio(a)
    print(f'{key}: seam ratio after fix  L-R {rx:.2f}  T-B {ry:.2f}')
    save(a, key, (1024, 1024))

# stone wall: short fades so stones don't ghost much; in the game the wall is anchored at its
# top edge, so the up-down repeat is rarely seen
a = load(SRC['stone'], 'RGB')
a = fade_y(fade_x(a, 0.08), 0.06)
rx, ry = seam_ratio(a)
print(f'stone: seam ratio after fix  L-R {rx:.2f}  T-B {ry:.2f}')
save(a, 'stone', (1024, 1024))

# grass lip: see-through strip, only needs to repeat sideways
a = load(SRC['lip'], 'RGBA')
ys = np.nonzero(a[..., 3].max(axis=1) > 10)[0]
a = a[ys.min(): ys.max() + 1]
a = fade_x(a, 0.12)
save(a, 'lip', (1024, max(64, int(1024 * a.shape[0] / a.shape[1]))), jpg=False)

# ground details sheet (4 x 4, see-through)
save(load(SRC['decals'], 'RGBA'), 'decals', (1024, 1024), jpg=False)
