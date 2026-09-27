"""Cut the screen (HUD) pictures for the game: Codex Round 4 duck pictures + painted counter icons.

Reads  Capy/From Codex/UI/U1..U5   and   Capy/assets/cutouts/pickups (sun coin, heart, golden leaf)
Writes game-claude/public/ui/*.webp  (trimmed, small, real transparency)

Clean-up: the Codex art is ~1% see-through inside (alpha 250-254) and has faint stray dots
(alpha 1-15) in the empty area; solid parts are made solid and the dots removed.
Run: py tools/cut_ui.py
"""
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
CAPY = os.path.dirname(GAME)
SRC = os.path.join(CAPY, 'From Codex', 'UI')
PICK = os.path.join(CAPY, 'assets', 'cutouts', 'pickups')
OUT = os.path.join(GAME, 'public', 'ui')
os.makedirs(OUT, exist_ok=True)


def clean(im: Image.Image) -> Image.Image:
    a = np.array(im.convert('RGBA'))
    al = a[..., 3].astype(np.int32)
    al[al < 16] = 0  # stray dots
    al[al >= 240] = 255  # solid inside
    a[..., 3] = al
    a[al == 0, :3] = 0
    return Image.fromarray(a, 'RGBA')


def columns(im: Image.Image, n: int) -> list[Image.Image]:
    """Split a strip into n pictures at the widest empty column gaps."""
    al = np.array(im)[..., 3]
    used = (al > 0).any(axis=0)
    gaps = []  # (length, start, end) of empty column runs, not at the edges
    x = 0
    w = len(used)
    while x < w:
        if not used[x]:
            s = x
            while x < w and not used[x]:
                x += 1
            if s > 0 and x < w:
                gaps.append((x - s, s, x))
        else:
            x += 1
    cuts = sorted(sorted(gaps, reverse=True)[: n - 1], key=lambda g: g[1])
    edges = [0] + [(g[1] + g[2]) // 2 for g in cuts] + [w]
    return [im.crop((edges[i], 0, edges[i + 1], im.height)) for i in range(n)]


def save(im: Image.Image, name: str, size: int):
    im = im.crop(im.getbbox())
    im.thumbnail((size, size), Image.LANCZOS)
    path = os.path.join(OUT, name + '.webp')
    im.save(path, 'WEBP', quality=90, method=6)
    print(f'{name:18s} {im.size[0]}x{im.size[1]}  {os.path.getsize(path) // 1024} KB')


mama = clean(Image.open(os.path.join(SRC, 'U1_mama_duck_portraits.png')))
for part, name in zip(columns(mama, 3), ['mama_happy', 'mama_talk', 'mama_sad']):
    save(part, name, 320)
chick = clean(Image.open(os.path.join(SRC, 'U2_duckling_portraits.png')))
for part, name in zip(columns(chick, 3), ['duckling_sad', 'duckling_call', 'duckling_happy']):
    save(part, name, 320)
save(clean(Image.open(os.path.join(SRC, 'U3_duckling_map_pin.png'))), 'pin_duckling', 160)
save(clean(Image.open(os.path.join(SRC, 'U4_hand_icon.png'))), 'tool_hand', 160)
save(clean(Image.open(os.path.join(SRC, 'U5_duck_family_icon.png'))), 'duck_family', 256)
# counters: painted sun coin, heart, golden leaf coin
for f, name in [('pickups_012.png', 'icon_sun'), ('pickups_013.png', 'icon_heart'), ('pickups_014.png', 'icon_leaf')]:
    save(clean(Image.open(os.path.join(PICK, f))), name, 96)
# garden: the four crops (seed picker, "ready to pick" bubbles)
for f, name in [('pickups_007.png', 'crop_carrot'), ('pickups_008.png', 'crop_tomato'), ('pickups_006.png', 'crop_melon'), ('pickups_011.png', 'crop_bamboo')]:
    save(clean(Image.open(os.path.join(PICK, f))), name, 128)

# tool bar + menu icons from the core icon sheet (6 x 4 grid of 256 px squares; keep only the
# picture in the middle of each square, so a neighbour poking over the edge is never cut in)
CORE = os.path.join(CAPY, 'Game Plan and Asset Prompts', 'Claude Full Game Package', 'Generated 2D Sheets', 'I17-I18-I20_core_icons_atlas.png')
core = clean(Image.open(CORE))


def main_island(im: Image.Image) -> Image.Image:
    """Keep the pixels joined to the middle of the square (flood fill over non-empty pixels)."""
    a = np.array(im)
    solid = a[..., 3] > 0
    h, w = solid.shape
    seen = np.zeros_like(solid)
    ys, xs = np.nonzero(solid)
    d = (ys - h / 2) ** 2 + (xs - w / 2) ** 2
    sy, sx = ys[d.argmin()], xs[d.argmin()]
    stack = [(sy, sx)]
    seen[sy, sx] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                stack.append((ny, nx))
    a[~seen] = 0
    return Image.fromarray(a, 'RGBA')


for (row, col), name in {(1, 1): 'tool_water', (0, 5): 'tool_seeds', (1, 3): 'tool_hammer', (2, 5): 'tool_basket',
                         (2, 3): 'tool_map', (1, 2): 'tool_shovel', (3, 0): 'icon_gear', (2, 2): 'icon_journal'}.items():
    cell = core.crop((col * 256, row * 256, col * 256 + 256, row * 256 + 256))
    save(main_island(cell), name, 160)
