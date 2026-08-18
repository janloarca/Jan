"""Outline 'Chispudo' (Inter Black, -0.02em tracking) into a single SVG path.

Shaping goes through HarfBuzz so GPOS kerning matches what the browser does in
components/ui/Logo.jsx -- the brand files have to be the same shape the app
already renders, not a lookalike.
"""
import json
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.misc.transform import Transform

FONT = '/tmp/fonts/Inter900.ttf'
TEXT = 'Chispudo'
TRACKING_EM = -0.02          # letterSpacing: '-0.02em' in Logo.jsx
FONT_SIZE = 100.0            # wordmark drawn at 100 units of font-size

tt = TTFont(FONT)
upem = tt['head'].unitsPerEm
gs = tt.getGlyphSet()

with open(FONT, 'rb') as fh:
    blob = hb.Blob(fh.read())
face = hb.Face(blob)
font = hb.Font(face)
buf = hb.Buffer()
buf.add_str(TEXT)
buf.guess_segment_properties()
hb.shape(font, buf)

scale = FONT_SIZE / upem
tracking = TRACKING_EM * FONT_SIZE

pen_out = SVGPathPen(gs, ntos=lambda v: f'{v:.3f}')
x = 0.0
bounds = [None] * 4

for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
    name = tt.getGlyphOrder()[info.codepoint]
    # y flip: font space is y-up, SVG is y-down.
    t = Transform(scale, 0, 0, -scale, x + pos.x_offset * scale, -pos.y_offset * scale)
    rec = RecordingPen()
    gs[name].draw(rec)
    rec.replay(TransformPen(pen_out, t))

    bp = BoundsPen(gs)
    gs[name].draw(bp)
    if bp.bounds:
        x0, y0, x1, y1 = bp.bounds
        gx0, gx1 = x + x0 * scale, x + x1 * scale
        gy0, gy1 = -y1 * scale, -y0 * scale
        bounds = [
            gx0 if bounds[0] is None else min(bounds[0], gx0),
            gy0 if bounds[1] is None else min(bounds[1], gy0),
            gx1 if bounds[2] is None else max(bounds[2], gx1),
            gy1 if bounds[3] is None else max(bounds[3], gy1),
        ]
    x += pos.x_advance * scale + tracking

result = {
    'path': pen_out.getCommands(),
    'bbox': bounds,                       # xMin, yMin, xMax, yMax (baseline at y=0)
    'advance': x - tracking,
    'fontSize': FONT_SIZE,
    'capHeight': tt['OS/2'].sCapHeight * scale,
    'ascender': tt['hhea'].ascent * scale,
    'descender': tt['hhea'].descent * scale,
}
with open('/tmp/brandgen/wordmark.json', 'w') as fh:
    json.dump(result, fh)

print('advance   %.2f' % result['advance'])
print('bbox      %s' % ['%.2f' % b for b in bounds])
print('capHeight %.2f' % result['capHeight'])
print('path len  %d' % len(result['path']))
