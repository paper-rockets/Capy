"""Cut the Codex Round 7 pictures for the game.

Reads  Capy/From Codex/{UI,Effects,Garden,Mountains}/...   (left untouched)
Writes public/ui/mochi_*.webp, btn_*.webp, title_logo.webp       screen pictures
       public/fx/<effect>.webp   animation strips, one 256 px square per frame, left to right
       public/fx/pop_*.webp      little icons that float up (heart, star, leaf, sparkle)
       public/backdrop/sheet.webp + sheet.json   mountains + clouds for the back edges, packed in one picture
       public/garden/bed_empty_codex.png         Codex's empty bed (A1), to compare with the stand-in

Clean-up: Codex art is ~1% see-through inside (alpha 250-254) and has faint stray dots in the empty area.
Pictures drawn in 3D (effects, backdrop) get the colour of the nearest painted pixel under their see-through
parts, so the edges don't turn dark when the graphics chip blends neighbouring pixels.
Two of the six mountains were sliced by a see-through strip on Codex's side: the thin left sliver is dropped
and the straight cut edge fades out softly (wavy, so it isn't a ruler line).
Run: py tools/cut_round7.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
CAPY = os.path.dirname(GAME)
SRC = os.path.join(CAPY, 'From Codex')
UI = os.path.join(GAME, 'public', 'ui')
FX = os.path.join(GAME, 'public', 'fx')
BACK = os.path.join(GAME, 'public', 'backdrop')
GARDEN = os.path.join(GAME, 'public', 'garden')
for d in (UI, FX, BACK):
    os.makedirs(d, exist_ok=True)


def load(*parts) -> np.ndarray:
    return np.array(Image.open(os.path.join(SRC, *parts)).convert('RGBA'))


def clean(a: np.ndarray, low=16) -> np.ndarray:
    """Solid inside, stray dots gone. Effects keep their soft glow (low=6)."""
    a = a.copy()
    al = a[..., 3].astype(np.int32)
    al[al < low] = 0
    al[al >= 240] = 255
    a[..., 3] = al
    return a


def bleed(a: np.ndarray) -> np.ndarray:
    """Give every see-through pixel the colour of the nearest painted one (alpha unchanged)."""
    empty = a[..., 3] == 0
    if not empty.any() or empty.all():
        return a
    _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
    out = a.copy()
    out[..., :3] = a[iy, ix, :3]
    out[..., 3] = a[..., 3]
    return out


def resize(a: np.ndarray, w: int, h: int) -> np.ndarray:
    """Resize with premultiplied colour, so edges don't pick up the colour under the see-through parts."""
    im = Image.fromarray(a, 'RGBA').convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    return np.array(im)


def crop(a: np.ndarray, pad=0) -> np.ndarray:
    ys, xs = np.nonzero(a[..., 3] > 0)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + 1 + pad)
    return a[y0:y1, x0:x1]


def fit(a: np.ndarray, size: int) -> np.ndarray:
    k = min(1.0, size / max(a.shape[0], a.shape[1]))
    if k >= 1:
        return a
    return resize(a, round(a.shape[1] * k), round(a.shape[0] * k))


def save_webp(a: np.ndarray, folder: str, name: str, exact=False):
    path = os.path.join(folder, name + '.webp')
    Image.fromarray(a, 'RGBA').save(path, 'WEBP', quality=90, method=6, exact=exact)
    print(f'{name:22s} {a.shape[1]}x{a.shape[0]}  {os.path.getsize(path) // 1024} KB')


def cells(a: np.ndarray, cols: int, rows: int) -> list[np.ndarray]:
    h, w = a.shape[0] // rows, a.shape[1] // cols
    return [a[r * h:(r + 1) * h, c * w:(c + 1) * w] for r in range(rows) for c in range(cols)]


# --- screen pictures (HTML, so no colour bleed needed) ---------------------------------------
mochi = clean(load('UI', 'U6_mochi_portraits.png'))
for part, name in zip(cells(mochi, 3, 2), ['happy', 'talk', 'surprised', 'proud', 'think', 'sleepy']):
    save_webp(fit(crop(part), 320), UI, 'mochi_' + name)
buttons = clean(load('UI', 'U7_round_buttons.png'))
for part, name in zip(cells(buttons, 3, 2), ['menu', 'full', 'full_exit', 'sound_on', 'sound_off', 'music']):
    save_webp(fit(crop(part), 160), UI, 'btn_' + name)
save_webp(fit(crop(clean(load('UI', 'U8_title_logo.png'))), 1024), UI, 'title_logo')

# --- effects: strips of 512 px squares -> 256 px squares --------------------------------------
FRAME = 256
STRIPS = {
    'e1_sparkle': ('Effects', 'E1_sparkle_burst.png'),
    'e2_splash': ('Effects', 'E2_water_splash.png'),
    'e3_dust': ('Effects', 'E3_dust_puff.png'),
    'b1_dig': ('Garden', 'B1_dig_dirt.png'),
    'b2_water': ('Garden', 'B2_watering.png'),
    'b3_sprout': ('Garden', 'B3_sprout_pop.png'),
    'b4_harvest': ('Garden', 'B4_harvest_pull.png'),
    'b5_shine': ('Garden', 'B5_ripe_shine.png'),
}
for name, parts in STRIPS.items():
    a = clean(load(*parts), low=6)
    n = a.shape[1] // 512
    frames = [bleed(resize(a[:, i * 512:(i + 1) * 512], FRAME, FRAME)) for i in range(n)]
    save_webp(np.concatenate(frames, axis=1), FX, name, exact=True)
pops = clean(load('Effects', 'E4_pop_icons.png'))
for part, name in zip(cells(pops, 2, 2), ['heart', 'star', 'leaf', 'sparkle']):
    save_webp(bleed(fit(crop(part, pad=4), 128)), FX, 'pop_' + name, exact=True)

# --- mountains + clouds for the back edges ----------------------------------------------------


def pieces(a: np.ndarray, min_area: int) -> list[tuple[np.ndarray, slice, slice]]:
    lab, n = ndimage.label(a[..., 3] > 16)
    objs = ndimage.find_objects(lab)
    areas = ndimage.sum(np.ones(lab.shape), lab, range(1, n + 1))
    out = []
    for i, sl in enumerate(objs):
        if areas[i] < min_area:
            continue
        # everything inside the piece's box, but only pixels near the piece (soft edges included)
        near = ndimage.binary_dilation(lab[sl] == i + 1, iterations=6)
        p = a[sl].copy()
        p[~near] = 0
        out.append((p, sl[0], sl[1]))
    # reading order: row by row (rows are ~500 px apart), left to right
    out.sort(key=lambda t: (t[1].start // 400, t[2].start))
    return out


def soften_left(p: np.ndarray, width=70, seed=0) -> np.ndarray:
    """Fade a straight cut on the left edge: a wavy, uneven fade so no straight line shows."""
    rng = np.random.default_rng(seed)
    h = p.shape[0]
    # wavy fade length per row (smooth random wobble)
    wob = ndimage.gaussian_filter1d(rng.normal(0, 1, h + 200), 18)[100:100 + h]
    wob = (wob - wob.min()) / max(1e-6, wob.max() - wob.min())
    length = width * (0.55 + 0.9 * wob)
    x = np.arange(p.shape[1])[None, :]
    t = np.clip(x / length[:, None], 0, 1)
    fade = t * t * (3 - 2 * t)
    out = p.copy()
    out[..., 3] = (out[..., 3].astype(np.float32) * fade).astype(np.uint8)
    return out


mtn = clean(load('Mountains', 'M1_mountains.png'))
mountains = []
for p, ys, xs in pieces(mtn, 20000):
    if xs.start >= 1040:  # the two sliced ones: their straight edge is the left side of the piece
        p = soften_left(p, seed=xs.start + ys.start)
    mountains.append(crop(p, pad=2))
cloud_sheet = clean(load('Mountains', 'M2_clouds.png'))
clouds = [crop(p, pad=2) for p, _, _ in pieces(cloud_sheet, 5000)]
print('mountains', [m.shape[1::-1] for m in mountains], 'clouds', [c.shape[1::-1] for c in clouds])

# pack into one 2048 x 1024 picture (shelves, tallest first)
items = [('m%d' % i, m) for i, m in enumerate(mountains)] + [('c%d' % i, c) for i, c in enumerate(clouds)]
W, H, PAD = 2048, 1024, 4
order = sorted(range(len(items)), key=lambda i: -items[i][1].shape[0])
sheet = np.zeros((H, W, 4), np.uint8)
rects = {}
x = y = PAD
row_h = 0
for i in order:
    name, a = items[i]
    h, w = a.shape[:2]
    if x + w + PAD > W:
        x = PAD
        y += row_h + PAD * 2
        row_h = 0
    if y + h + PAD > H:
        raise SystemExit('backdrop sheet too small')
    sheet[y:y + h, x:x + w] = a
    # anchor = middle of the lowest painted row (where the picture meets the ground)
    rows = np.nonzero((a[..., 3] > 100).any(axis=1))[0]
    low = rows.max()
    cols = np.nonzero(a[low, :, 3] > 100)[0]
    rects[name] = {'x': x, 'y': y, 'w': w, 'h': h, 'anchor': round(float(cols.mean() + 0.5) / w, 3)}
    x += w + PAD * 2
    row_h = max(row_h, h)
sheet = bleed(sheet)
# lossy but sharp; exact=True keeps the colours under the see-through parts (no dark edges)
Image.fromarray(sheet, 'RGBA').save(os.path.join(BACK, 'sheet.webp'), 'WEBP', quality=92, method=6, exact=True)
with open(os.path.join(BACK, 'sheet.json'), 'w', newline='') as f:
    json.dump({'w': W, 'h': H, 'pictures': rects}, f, indent=1)
print('backdrop sheet', os.path.getsize(os.path.join(BACK, 'sheet.webp')) // 1024, 'KB')

# --- Codex's empty garden bed (A1), same width as the crop bed pictures -------------------------
bed = crop(clean(load('Garden', 'A1_bed_empty_dry.png')))
bed = resize(bed, 385, round(bed.shape[0] * 385 / bed.shape[1]))
Image.fromarray(bed, 'RGBA').save(os.path.join(GARDEN, 'bed_empty_codex.png'), optimize=True)
print('bed_empty_codex', bed.shape[1::-1])
