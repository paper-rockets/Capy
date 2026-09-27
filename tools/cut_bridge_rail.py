# Cut the FRONT railing out of the bridge picture (public/obj/f02.png) into its own picture f02r.png.
# The game draws the whole bridge under Mochi and then this railing again as a standing card in front
# of him, so he walks behind the railing instead of on top of it.
# Only the wood of the railing is kept (beam, little posts, the two end posts, and the deck side and
# rocks below them); the gaps between the little posts stay empty so Mochi's legs show through them.
# Picture coordinates are f02.png pixels (355 x 244). Run: python tools/cut_bridge_rail.py
from PIL import Image, ImageDraw, ImageFilter
import os

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'public', 'obj', 'f02.png')
dst = os.path.join(here, '..', 'public', 'obj', 'f02r.png')
im = Image.open(src).convert('RGBA')
mask = Image.new('L', im.size, 0)
d = ImageDraw.Draw(mask)

# top edge of the railing beam, from the front post to the right post (traced at 5x zoom)
top = [(165, 103), (180, 96), (200, 88), (220, 80), (240, 75), (260, 72), (280, 71), (300, 72), (318, 72)]
# beam thickness in pixels: thicker at the front post (it is nearer), thinner at the far post
beam = lambda x: 21 - (x - 165) / (318 - 165) * 6
d.polygon(top + [(x, y + beam(x)) for (x, y) in reversed(top)], fill=255)
# little posts under the beam, down to the deck's side
for x0, y0, x1, y1 in [(185, 111, 203, 136), (225, 91, 244, 117), (263, 86, 280, 108)]:
    d.rectangle([x0, y0, x1, y1], fill=255)
# the deck's side boards and the arch under them: everything below this line
edge = [(166, 133), (186, 130), (210, 122), (236, 115), (252, 110), (272, 107), (290, 106), (306, 106), (355, 104)]
d.polygon(edge + [(355, 244), (98, 244), (98, 178), (112, 164), (166, 163)], fill=255)
# front post (with its cap) and right post
d.rectangle([132, 97, 166, 172], fill=255)
d.rectangle([303, 42, 338, 112], fill=255)

mask = mask.filter(ImageFilter.GaussianBlur(0.6))
out = im.copy()
a = out.getchannel('A')
out.putalpha(Image.composite(a, Image.new('L', im.size, 0), mask))
out.save(dst)
print('saved', dst)
