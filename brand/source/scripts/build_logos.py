"""Generate the Chispudo logo files.

Geometry is not invented here: it reproduces components/ui/Logo.jsx exactly.
With bolt box = S, Logo.jsx renders font-size 0.9S, gap 0.4S, line-height 1 and
flex centering, which puts the wordmark's cap-height block dead centre on the
bolt (verified numerically: both centres land on 0.500S). Files are cropped to
the artwork's own bounding box -- clear space belongs to whoever places the
logo, not baked into the asset as dead transparent pixels.
"""
import json, os
from svgelements import Path

OUT = '/home/user/Jan/brand/logos/svg'
os.makedirs(OUT, exist_ok=True)

BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
STROKE = 1.1                     # boltStrokeWidth(size) for size > 24
BLUE, INK, WHITE = '#2563EB', '#111827', '#FFFFFF'

wm = json.load(open('/tmp/brandgen/wordmark.json'))
WM_PATH = wm['path']
wx0, wy0, wx1, wy1 = wm['bbox']          # at font-size 100, baseline y = 0
CAP = wm['capHeight']

bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0] - STROKE / 2, bb[1] - STROKE / 2, bb[2] + STROKE / 2, bb[3] + STROKE / 2

S = 100.0                                 # bolt box side
k = S / 24.0                              # bolt viewBox -> logo units
FS = 0.9 * S                              # Logo.jsx: font-size = size * 0.9
GAP = 0.4 * S                             # Logo.jsx: gap = size * 0.4
BASELINE = 0.8274 * S                     # CSS line box, line-height 1
f = FS / 100.0                            # wordmark path scale


def bolt_g(color, tx=0.0, ty=0.0, scale=k):
    return (f'<g transform="translate({tx:.4f} {ty:.4f}) scale({scale:.6f})">'
            f'<path d="{BOLT}" fill="{color}" stroke="{color}" stroke-width="{STROKE}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g>')


def wm_g(color, tx, ty, scale=None):
    sc = scale if scale is not None else f
    return (f'<g transform="translate({tx:.4f} {ty:.4f}) scale({sc:.6f})">'
            f'<path d="{WM_PATH}" fill="{color}"/></g>')


def svg(name, w, h, body, title):
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.4f} {h:.4f}" '
           f'width="{w:.4f}" height="{h:.4f}" role="img" aria-label="{title}">'
           f'<title>{title}</title>{body}</svg>')
    open(os.path.join(OUT, name), 'w').write(doc)
    return name, round(w, 2), round(h, 2)


# ---------- horizontal lockup ----------
bolt_vis = (BX0 * k, BY0 * k, BX1 * k, BY1 * k)
wm_x = S + GAP
wm_vis = (wm_x + wx0 * f, BASELINE + wy0 * f, wm_x + wx1 * f, BASELINE + wy1 * f)
X0, Y0 = min(bolt_vis[0], wm_vis[0]), min(bolt_vis[1], wm_vis[1])
X1, Y1 = max(bolt_vis[2], wm_vis[2]), max(bolt_vis[3], wm_vis[3])
W, H = X1 - X0, Y1 - Y0

built = []
for name, bc, wc in [('principal', BLUE, INK), ('inverso', BLUE, WHITE),
                     ('mono-azul', BLUE, BLUE), ('mono-blanco', WHITE, WHITE),
                     ('mono-tinta', INK, INK)]:
    body = bolt_g(bc, -X0, -Y0) + wm_g(wc, wm_x - X0, BASELINE - Y0)
    built.append(svg(f'chispudo-logo-{name}.svg', W, H, body, 'Chispudo'))

# ---------- isotype (bolt alone) ----------
iw, ih = (BX1 - BX0) * k, (BY1 - BY0) * k
for name, c in [('azul', BLUE), ('blanco', WHITE), ('tinta', INK)]:
    built.append(svg(f'chispudo-isotipo-{name}.svg', iw, ih,
                     bolt_g(c, -BX0 * k, -BY0 * k), 'Chispudo'))

# ---------- vertical lockup ----------
VFS = 63.0                                  # cap height ~= half the bolt height
vf = VFS / 100.0
vgap = 0.28 * (BY1 - BY0) * k
bolt_w, bolt_h = (BX1 - BX0) * k, (BY1 - BY0) * k
wm_w = (wx1 - wx0) * vf
VW = max(bolt_w, wm_w)
vb_x = (VW - bolt_w) / 2 - BX0 * k
vwm_x = (VW - wm_w) / 2 - wx0 * vf
vbase = bolt_h + vgap - wy0 * vf
VH = vbase + wy1 * vf
for name, bc, wc in [('vertical-principal', BLUE, INK), ('vertical-inverso', BLUE, WHITE),
                     ('vertical-mono-blanco', WHITE, WHITE)]:
    body = bolt_g(bc, vb_x, -BY0 * k) + wm_g(wc, vwm_x, vbase, vf)
    built.append(svg(f'chispudo-logo-{name}.svg', VW, VH, body, 'Chispudo'))

for n, w, h in built:
    print(f'{n:42s} {w:>8} x {h:<8}')
print(f'\nhorizontal ratio {W/H:.3f}:1   vertical ratio {VW/VH:.3f}:1')
