"""Contornea el wordmark de zerosoft desde Archivo (wdth 85, wght 800) e imprime
un JSON con el trazado de las letras y la geometría de la estación, normalizado
para que la caja de tinta empiece en 0,0 y 1 unidad = 1/100 de em.

Uso (una sola vez, el resultado vive en lib/brand-mark.ts):
  pip install fonttools uharfbuzz
  curl -L -o fonts/Archivo.ttf 'https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf'
  python scripts/brand/outline-wordmark.py > mark.json
"""
import json
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import uharfbuzz as hb

WDTH, WGHT, SCALE_R, RING, GAP = 85, 800, 1.24, 0.44, 50
FONT = 'fonts/Archivo.ttf'
TEXT = 'zerosoft'
S = 0.1  # 1000 upm -> 100 units

data = open(FONT, 'rb').read()
font = hb.Font(hb.Face(data))
font.set_variations({'wdth': WDTH, 'wght': WGHT})
buf = hb.Buffer()
buf.add_str(TEXT)
buf.guess_segment_properties()
hb.shape(font, buf, {'kern': True, 'liga': False})
inst = instantiateVariableFont(TTFont(FONT), {'wdth': WDTH, 'wght': WGHT})
gs = inst.getGlyphSet()
order = inst.getGlyphOrder()

# pass 1: positions + bounds (font units, y up)
x = 0
items = []
minx = miny = 1e9
maxx = maxy = -1e9
station = None
for i, (info, pos) in enumerate(zip(buf.glyph_infos, buf.glyph_positions)):
    name = order[info.codepoint]
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    b = bp.bounds
    if i == 3:
        x += GAP
        cx = x + (b[0] + b[2]) / 2
        cy = (b[1] + b[3]) / 2
        R = (b[3] - b[1]) / 2 * SCALE_R
        station = (cx, cy, R)
        bb = (cx - R, cy - R, cx + R, cy + R)
        x += GAP
    else:
        items.append((name, x))
        bb = (x + b[0], b[1], x + b[2], b[3])
    minx, miny = min(minx, bb[0]), min(miny, bb[1])
    maxx, maxy = max(maxx, bb[2]), max(maxy, bb[3])
    x += pos.x_advance

fmt = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')
parts = []
for name, gx in items:
    pen = SVGPathPen(gs, ntos=fmt)
    gs[name].draw(TransformPen(pen, (S, 0, 0, -S, (gx - minx) * S, maxy * S)))
    parts.append(pen.getCommands())

cx, cy, R = station
out = dict(
    width=round((maxx - minx) * S, 2),
    height=round((maxy - miny) * S, 2),
    baseline=round(maxy * S, 2),
    xHeight=round(inst['OS/2'].sxHeight * S, 2),
    letters=''.join(parts),
    station=dict(cx=round((cx - minx) * S, 2), cy=round((maxy - cy) * S, 2), r=round(R * S, 2), ring=round(R * RING * S, 2)),
)
print(json.dumps(out))
