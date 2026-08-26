"""Square avatars for LinkedIn.

LinkedIn crops a profile picture to a CIRCLE, so these are built on a filled
square with the artwork inside the safe circle: nothing important goes near a
corner. The blue tile with a white bolt is the same treatment as the app icon
(app/icon.jsx), so the LinkedIn avatar and the phone icon read as one thing.
"""
import json, os
from svgelements import Path

OUT = '/home/user/Jan/brand/logos/linkedin'
os.makedirs(OUT, exist_ok=True)
BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
SW = 1.1
BLUE, INK, WHITE, LIGHT = '#2563EB', '#111827', '#FFFFFF', '#F8F9FB'

wm = json.load(open('/tmp/brandgen/wordmark.json'))
wx0, wy0, wx1, wy1 = wm['bbox']
bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0]-SW/2, bb[1]-SW/2, bb[2]+SW/2, bb[3]+SW/2
bolt_w, bolt_h = BX1-BX0, BY1-BY0                      # in the 24 viewBox

S = 1000.0
CX = CY = S/2
SAFE_D = 0.90 * S                                       # keep artwork inside this circle


def bolt_at(color, h, cx, cy):
    """Draw the bolt with visual height h, centred on (cx, cy)."""
    k = h / bolt_h
    tx = cx - (BX0 + bolt_w/2) * k
    ty = cy - (BY0 + bolt_h/2) * k
    return (f'<g transform="translate({tx:.3f} {ty:.3f}) scale({k:.6f})"><path d="{BOLT}" fill="{color}" '
            f'stroke="{color}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round"/></g>')


def word_at(color, target_w, cx, baseline_y):
    f = target_w / (wx1 - wx0)
    tx = cx - (wx0 + (wx1-wx0)/2) * f
    return (f'<g transform="translate({tx:.3f} {baseline_y:.3f}) scale({f:.6f})">'
            f'<path d="{wm["path"]}" fill="{color}"/></g>')


def diag(w, h):
    return (w*w + h*h) ** 0.5


def write(name, bg, body, note):
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S:.0f} {S:.0f}" width="{S:.0f}" '
           f'height="{S:.0f}" role="img" aria-label="Chispudo"><title>Chispudo</title>'
           f'<rect width="{S:.0f}" height="{S:.0f}" fill="{bg}"/>{body}</svg>')
    open(f'{OUT}/{name}.svg', 'w').write(doc)
    print(f'{name:38s} {note}')


# --- mark only: the bolt at the same share of the tile the app icon uses ---
BH = 0.54 * S
print(f'safe circle {SAFE_D:.0f}px')
assert diag(BH*bolt_w/bolt_h, BH) < SAFE_D
write('chispudo-linkedin-azul-marca', BLUE, bolt_at(WHITE, BH, CX, CY),
      f'bolt {BH:.0f}px, diagonal {diag(BH*bolt_w/bolt_h, BH):.0f} < {SAFE_D:.0f}')
write('chispudo-linkedin-claro-marca', LIGHT, bolt_at(BLUE, BH, CX, CY), 'idem, sobre fondo claro')

# --- full lockup: bolt over wordmark, sized to sit inside the safe circle ---
WW = 0.60 * S                       # wordmark width
f = WW / (wx1 - wx0)
cap = wm['capHeight'] * f
VBH = cap * 2.05                    # bolt reads about twice the cap height
gap = 0.30 * VBH
block_h = VBH + gap + cap
top = CY - block_h/2
baseline = top + VBH + gap + cap
assert diag(WW, block_h) < SAFE_D, diag(WW, block_h)
for name, bg, bc, wc in [('chispudo-linkedin-azul-completo', BLUE, WHITE, WHITE),
                         ('chispudo-linkedin-claro-completo', LIGHT, BLUE, INK)]:
    write(name, bg, bolt_at(bc, VBH, CX, top + VBH/2) + word_at(wc, WW, CX, baseline),
          f'bloque {WW:.0f}x{block_h:.0f}, diagonal {diag(WW, block_h):.0f} < {SAFE_D:.0f}')
