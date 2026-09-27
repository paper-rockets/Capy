"""Bring the six designed maps (Capy/Map Designs/<key>_map.json, made in the Map Maker) into the game.

For each map:
  - every picture it uses is cropped to its painted part and copied to public/obj/m/<id>.png
    (smaller copies: the game packs all pictures of a map into one 4096 px sheet)
  - the map itself is written to public/maps/<key>.json in the shape src/designed.ts reads

Run again after editing a map in the Map Maker:   py tools/import_designed_maps.py [key ...]
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
CAPY = GAME.parent
DESIGNS = CAPY / 'Map Designs'
MAKER = DESIGNS / 'maker'
CUTOUTS = CAPY / 'assets' / 'cutouts'
OUT_PIC = GAME / 'public' / 'obj' / 'm'
OUT_MAP = GAME / 'public' / 'maps'

MAPS = ['old_orchard', 'bamboo_woods', 'lotus_marsh', 'mountain_springs', 'moonlit_lake', 'misty_highlands']
# pictures that give their own light (lanterns, glowing plants): not dimmed on night maps (same list as the maker)
GLOWS = {'environment_props_060', 'environment_props_061', 'garden_art_04_006', 'garden_art_04_007', 'garden_art_07_019',
         'garden_art_09_029', 'environment_props_095', 'nature_detail_011', 'garden_art_09_025', 'environment_props_022',
         'decor_props_029', 'decor_props_030'}
# Houses that get the softer look (test scene first, 2026-09-26): drawn smaller, colours calmer, window glow
# dimmer, fine detail softened, the painted grey stone edge at the bottom trimmed. id -> size factor
SOFT_HOUSES = {}  # per-house size overrides (id -> factor); every house gets the soft look, see is_house()
SOFT_SIZE = 0.68  # user OK'd the test house 2026-09-26: ALL houses on all 6 maps drawn at this size


def is_house(a):
    """RULE: every house/building picture gets the soft look and the smaller size (not just a list of ids)."""
    return a['id'].startswith('codex_houses') or a.get('group', '').startswith('Houses')
BIG_GROUPS = {'Houses (new)', 'Houses', 'Story pieces (new)', 'Fix-up (broken / mended)', 'Bridges & docks', 'Hot spring things'}


def source(a):
    if a.get('url'):
        return MAKER / a['url']
    return CUTOUTS / a['file']


def trim_grey_base(rgba):
    """The older house pictures have a strip of grey stone showing along the bottom edge: remove grey parts in
    the lower 40% that touch the outside (the anvil, chimney and tools inside the picture are left alone)."""
    a = rgba[:, :, 3]
    rgb = rgba[:, :, :3].astype(np.float32) / 255
    mx, mn = rgb.max(-1), rgb.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    ys = np.nonzero(a > 25)[0]
    low = np.arange(a.shape[0])[:, None] > ys.min() + (ys.max() - ys.min()) * 0.6
    grey = (a > 25) & (sat < 0.22) & (mx > 0.25) & low
    lab, n = ndimage.label(grey)
    outside = ndimage.binary_dilation(a <= 25, iterations=3)
    drop = np.zeros_like(grey)
    for k in range(1, n + 1):
        m = lab == k
        if m.sum() > 30 and (m & outside).any():
            drop |= m
    out = rgba.copy()
    out[ndimage.binary_dilation(drop, iterations=1), 3] = 0
    return out


def soften(rgba):
    """Calmer house colours: less saturated (red roofs most), dimmer warm window glow, a little less contrast,
    and the fine painted detail blurred slightly so the house sits with the soft, puffy trees."""
    a = rgba[:, :, 3:].astype(np.float32) / 255
    rgb = rgba[:, :, :3].astype(np.float32) / 255
    # blur detail with premultiplied colour (no dark rims at the see-through edges)
    pre = rgb * a
    sharp_a = a[:, :, 0]
    blur_pre = cv2.GaussianBlur(pre, (0, 0), 1.1)
    blur_a = cv2.GaussianBlur(sharp_a, (0, 0), 1.1)[:, :, None]
    rgb = np.where(blur_a > 1e-3, blur_pre / np.maximum(blur_a, 1e-3), rgb)
    hsv = cv2.cvtColor(np.clip(rgb, 0, 1), cv2.COLOR_RGB2HSV)  # H 0-360, S 0-1, V 0-1
    h, sat, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    roof = ((h < 22) | (h > 340)) & (sat > 0.3)
    glow = (h > 25) & (h < 65) & (v > 0.8)
    sat *= 0.86
    # red roofs: toward a calmer terracotta (a little more orange-brown, a little darker), not pink
    h[roof] = (h[roof] + 7) % 360
    sat[roof] *= 0.92
    v[roof] *= 0.93
    v[glow] = 0.8 + (v[glow] - 0.8) * 0.55
    sat[glow] *= 0.85
    v[:] = 0.5 + (v - 0.5) * 0.92
    rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    alpha = cv2.GaussianBlur(sharp_a, (0, 0), 0.6)
    return np.dstack([np.clip(rgb, 0, 1) * 255, alpha[:, :, None] * 255]).astype(np.uint8)


def copy_picture(a):
    out = OUT_PIC / f"{a['id']}.png"
    src = source(a)
    soft = is_house(a)
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime and not soft:
        return
    im = Image.open(src).convert('RGBA')
    if soft:
        im = Image.fromarray(soften(trim_grey_base(np.array(im))))
    bx0, by0, bx1, by1 = a['box']
    im = im.crop((bx0, by0, bx1 + 1, by1 + 1))
    limit = 900 if a.get('group') in BIG_GROUPS else 512
    k = min(1.0, limit / max(im.size))
    if k < 1:
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, optimize=True)


def main(keys):
    assets = {a['id']: a for a in json.loads((MAKER / 'assets.json').read_text(encoding='utf-8'))['assets']}
    OUT_MAP.mkdir(parents=True, exist_ok=True)
    for key in keys:
        d = json.loads((DESIGNS / f'{key}_map.json').read_text(encoding='utf-8'))
        bg = d['palette'].get('bg', [0.5, 0.7, 0.4])
        night = sum(bg) < 1.2
        pics = []
        for p in d['pictures']:
            a = assets.get(p['a'])
            if not a:
                print('  missing picture', p['a'])
                continue
            copy_picture(a)
            q = {'n': f"m/{a['id']}", 'x': p['x'], 'z': p['z'], 'w': p['w'], 'kind': p.get('kind', ''),
                 'group': a.get('group', ''), 'where': a.get('where', 'land')}
            if p.get('flip'):
                q['flip'] = True
            if p.get('fw'):
                q['fw'], q['fd'] = p['fw'], p['fd']
                if is_house(a):
                    q['scale'] = SOFT_HOUSES.get(a['id'], SOFT_SIZE)
            if night and (a['id'] in GLOWS or a.get('night')):
                q['glow'] = True
            pics.append(q)
        W, D = d['size']
        out = {k: d[k] for k in ('key', 'name', 'seed', 'levels', 'frame_h', 'water_drop', 'cells', 'water', 'sand', 'steps',
                                 'bridges', 'boardwalks', 'paths', 'spots', 'plots', 'crags', 'start', 'palette') if k in d}
        out.update({'W': W, 'D': D, 'night': night, 'l0': d.get('l0_label', ''), 'pictures': pics})
        (OUT_MAP / f'{key}.json').write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
        print(f'{key}: {len(pics)} pictures ({len({p["n"] for p in pics})} different)')


if __name__ == '__main__':
    main(sys.argv[1:] or MAPS)
