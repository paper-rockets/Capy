"""Garden bed pictures for the growing crops.

Reads  public/obj/e00..e10.png  (painted crop beds; left untouched - the maps chat uses them)
Writes public/garden/<crop>_<stage>.png  stage 1 = seedling, 2 = growing, 3 = ripe
       public/garden/bed_empty.png       stand-in empty bed until Codex Round 5 (A1) arrives
Clean-up: keeps only the main picture (stray specks at the top edge dropped), solid alpha.
Run: py tools/cut_garden.py
"""
import os
import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
OBJ = os.path.join(GAME, 'public', 'obj')
OUT = os.path.join(GAME, 'public', 'garden')
os.makedirs(OUT, exist_ok=True)

STAGES = {
    'carrot': ['e05', 'e04', 'e03'],
    'tomato': ['e08', 'e07', 'e06top'],
    'melon': ['e01', 'e02', 'e00'],
    'bamboo': ['e10', 'e09', 'e06bottom'],
}


def load(name: str) -> np.ndarray:
    return np.array(Image.open(os.path.join(OBJ, name + '.png')).convert('RGBA'))


def halves(a: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """e06 holds two beds stacked: cut at the emptiest row near the middle."""
    used = (a[..., 3] > 16).sum(axis=1)
    h = a.shape[0]
    mid = int(np.argmin(used[h // 3: 2 * h // 3])) + h // 3
    return a[:mid], a[mid:]


def main_part(a: np.ndarray) -> np.ndarray:
    """Keep the biggest piece. The mask is shrunk first, so a neighbour that only just touches
    (the bamboo tip under the stacked tomato bed) comes loose, then grown back inside the picture."""
    solid = (a[..., 3] > 16).astype(np.uint8)
    k = np.ones((3, 3), np.uint8)
    core = cv2.erode(solid, k, iterations=4)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    if n <= 2:
        keep = solid
    else:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = cv2.dilate((lab == big).astype(np.uint8), k, iterations=6) & solid
    out = a.copy()
    out[keep == 0] = 0
    return out


def tidy(a: np.ndarray) -> Image.Image:
    a = main_part(a)
    al = a[..., 3].astype(np.int32)
    al[al < 16] = 0
    al[al >= 240] = 255
    a[..., 3] = al
    a[al == 0, :3] = 0
    im = Image.fromarray(a, 'RGBA')
    return im.crop(im.getbbox())


def save(im: Image.Image, name: str):
    path = os.path.join(OUT, name + '.png')
    im.save(path, optimize=True)
    print(f'{name:14s} {im.size[0]}x{im.size[1]}  {os.path.getsize(path) // 1024} KB')


e06 = load('e06')
top, bottom = halves(e06)


def drop_bamboo_tip(a: np.ndarray) -> np.ndarray:
    """The bamboo tip below pokes up under the tomato bed's bottom corner. Only there (lowest tenth,
    middle columns) remove yellow-green pixels; the bed's own sides there are brown."""
    a = a.copy()
    solid = a[..., 3] > 16
    rows = np.nonzero(solid.any(axis=1))[0]
    cols = np.nonzero(solid.any(axis=0))[0]
    y0 = rows.max() - int((rows.max() - rows.min()) * 0.1)
    xa = cols.min() + int((cols.max() - cols.min()) * 0.45)
    xb = cols.min() + int((cols.max() - cols.min()) * 0.72)
    part = a[y0:, xa:xb]
    rgb = part[..., :3].astype(np.int32)
    part[(rgb[..., 1] - rgb[..., 2] > 55) & (rgb[..., 1] > rgb[..., 0] * 0.75)] = 0
    return a


top = drop_bamboo_tip(top)
pieces = {'e06top': top, 'e06bottom': bottom}
for crop, names in STAGES.items():
    for stage, n in enumerate(names, 1):
        save(tidy(pieces[n] if n in pieces else load(n)), f'{crop}_{stage}')

# Stand-in empty bed: the carrot seedling bed (its sprouts are tiny) with the sprouts painted out.
a = main_part(load('e05'))
rgb = a[..., :3].astype(np.int32)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
green = (g > r + 12) & (g > b + 25) & (a[..., 3] > 200)
h, w = green.shape
# the soil area = outline around all brown pixels, pulled in so the grass rim stays out;
# every green pixel inside it is sprout
brown = ((r > g + 15) & (g > b) & (r - b > 35) & (a[..., 3] > 200)).astype(np.uint8)
brown = cv2.morphologyEx(brown, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
cnts, _ = cv2.findContours(brown, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
inside = np.zeros((h, w), np.uint8)
cv2.fillPoly(inside, [cv2.convexHull(max(cnts, key=cv2.contourArea))], 1)
inside = cv2.erode(inside, np.ones((3, 3), np.uint8), iterations=6)
mask = ((green | ((g > r) & (a[..., 3] > 200))) & (inside > 0)).astype(np.uint8) * 255
mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=3)
# soil = brown, not a grey stone, not grass or flowers
soil = (r > g + 15) & (g > b) & (r - b > 35) & (a[..., 3] > 200) & ~(mask > 0)
m, mlab, mstats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
src = a.copy()
# the other seedling beds are painted from the same bed, so their soil lines up with this one:
# fill each sprout from whichever of them has plain soil at that spot (shifted a few pixels to fit)
donors = []
for n2 in ('e01', 'e08', 'e10'):
    d = main_part(load(n2))
    d = np.array(Image.fromarray(d, 'RGBA').resize((w, h), Image.LANCZOS))
    dr, dg, db = (d[..., c].astype(np.int32) for c in range(3))
    donors.append((d, (dr > dg + 15) & (dg > db) & (dr - db > 35) & (d[..., 3] > 200)))
for i in range(1, m):
    ys, xs = np.nonzero(mlab == i)
    best, best_score = None, -1.0
    for d, dsoil in donors:
        for oy in range(-6, 7, 2):
            for ox in range(-6, 7, 2):
                sy, sx = np.clip(ys + oy, 0, h - 1), np.clip(xs + ox, 0, w - 1)
                score = dsoil[sy, sx].mean()
                if score > best_score:
                    best, best_score = (d, sy, sx), score
    d, sy, sx = best
    src[ys, xs, :3] = d[sy, sx, :3]
    # pixels where even the best donor has a seedling: take the nearest plain soil of any donor
    bad = ~[ds for dd, ds in donors if dd is d][0][sy, sx]
    for y, x in zip(ys[bad], xs[bad]):
        for rad in range(2, 40, 2):
            hit = None
            for dd, ds in donors:
                win = ds[max(0, y - rad):y + rad + 1, max(0, x - rad):x + rad + 1]
                yy, xx = np.nonzero(win)
                if len(yy):
                    k = np.argmin((yy - min(y, rad)) ** 2 + (xx - min(x, rad)) ** 2)
                    hit = dd[max(0, y - rad) + yy[k], max(0, x - rad) + xx[k], :3]
                    break
            if hit is not None:
                src[y, x, :3] = hit
                break
soft = np.clip(cv2.GaussianBlur((mask > 0).astype(np.float32), (0, 0), 1.5) * 1.6, 0, 1)[..., None]
a[..., :3] = (src[..., :3] * soft + a[..., :3] * (1 - soft)).astype(np.uint8)
save(tidy(a), 'bed_empty')
