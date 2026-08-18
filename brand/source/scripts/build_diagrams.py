"""Construction + clear-space diagrams, drawn from the same numbers the logo
files were built from, so the book can never document a proportion the assets
do not actually have."""
import json, os
from svgelements import Path

OUT = '/home/user/Jan/brand/source/diagrams'
os.makedirs(OUT, exist_ok=True)
BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
SW, BLUE, INK = 1.1, '#2563EB', '#111827'
GUIDE, DIM = '#2563EB', '#9AA3B2'
wm = json.load(open('/tmp/brandgen/wordmark.json'))
wx0, wy0, wx1, wy1 = wm['bbox']; CAP = wm['capHeight']
bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0]-SW/2, bb[1]-SW/2, bb[2]+SW/2, bb[3]+SW/2
S = 100.0; k = S/24.0; FS = 0.9*S; GAP = 0.4*S; BASE = 0.8274*S; f = FS/100.0

def bolt(c, tx, ty):
    return (f'<g transform="translate({tx:.3f} {ty:.3f}) scale({k:.6f})"><path d="{BOLT}" fill="{c}" '
            f'stroke="{c}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round"/></g>')
def word(c, tx, ty):
    return f'<g transform="translate({tx:.3f} {ty:.3f}) scale({f:.6f})"><path d="{wm["path"]}" fill="{c}"/></g>'

# ---------- construction ----------
P = 62.0
PR = 300.0   # right margin: the guide labels live out here
ox, oy = P, P
wmx = ox + S + GAP
x_r = wmx + wx1*f
y_b = oy + BASE + wy1*f
W, H = x_r + PR, y_b + P
d = []
# baseline grid on the bolt box
d.append(f'<rect x="{ox}" y="{oy}" width="{S}" height="{S}" fill="none" stroke="{GUIDE}" stroke-opacity=".28" stroke-dasharray="4 4"/>')
for i in (0.25, 0.5, 0.75):
    d.append(f'<line x1="{ox}" y1="{oy+S*i}" x2="{ox+S}" y2="{oy+S*i}" stroke="{GUIDE}" stroke-opacity=".14"/>')
    d.append(f'<line x1="{ox+S*i}" y1="{oy}" x2="{ox+S*i}" y2="{oy+S}" stroke="{GUIDE}" stroke-opacity=".14"/>')
d.append(bolt(BLUE, ox, oy))
d.append(word(INK, wmx, oy+BASE))
capTop = oy + BASE - CAP*f
# shared optical centre line
d.append(f'<line x1="{ox-30}" y1="{oy+S/2:.2f}" x2="{x_r+26}" y2="{oy+S/2:.2f}" stroke="{BLUE}" stroke-opacity=".55" stroke-dasharray="7 5"/>')
d.append(f'<text x="{x_r+30}" y="{oy+S/2+4:.2f}" font-family="Inter" font-size="12" fill="{BLUE}">eje óptico</text>')
# cap height + baseline guides
for yy, lab in ((capTop, 'altura de mayúscula'), (oy+BASE, 'línea base')):
    d.append(f'<line x1="{wmx-16}" y1="{yy:.2f}" x2="{x_r+14}" y2="{yy:.2f}" stroke="{DIM}" stroke-opacity=".7" stroke-dasharray="3 3"/>')
    d.append(f'<text x="{x_r+18}" y="{yy+4:.2f}" font-family="Inter" font-size="11" fill="{DIM}">{lab}</text>')
def hdim(x1, x2, y, label):
    return (f'<line x1="{x1:.2f}" y1="{y}" x2="{x2:.2f}" y2="{y}" stroke="{DIM}" stroke-width="1"/>'
            f'<line x1="{x1:.2f}" y1="{y-5}" x2="{x1:.2f}" y2="{y+5}" stroke="{DIM}"/>'
            f'<line x1="{x2:.2f}" y1="{y-5}" x2="{x2:.2f}" y2="{y+5}" stroke="{DIM}"/>'
            f'<text x="{(x1+x2)/2:.2f}" y="{y-9}" font-family="Inter" font-size="13" font-weight="600" '
            f'fill="{INK}" text-anchor="middle">{label}</text>')
def vdim(y1, y2, x, label):
    return (f'<line x1="{x}" y1="{y1:.2f}" x2="{x}" y2="{y2:.2f}" stroke="{DIM}" stroke-width="1"/>'
            f'<line x1="{x-5}" y1="{y1:.2f}" x2="{x+5}" y2="{y1:.2f}" stroke="{DIM}"/>'
            f'<line x1="{x-5}" y1="{y2:.2f}" x2="{x+5}" y2="{y2:.2f}" stroke="{DIM}"/>'
            f'<text x="{x-9}" y="{(y1+y2)/2+4:.2f}" font-family="Inter" font-size="13" font-weight="600" '
            f'fill="{INK}" text-anchor="end">{label}</text>')
d.append(vdim(oy, oy+S, ox-16, 'S'))
d.append(hdim(ox, ox+S, oy-16, 'S'))
d.append(hdim(ox+S, wmx, oy+S+30, '0,4 S'))
d.append(vdim(capTop, oy+BASE, x_r+186, '0,655 S'))
d.append(f'<text x="{wmx+40}" y="{oy+S+30-9}" font-family="Inter" font-size="13" font-weight="600" fill="{INK}">cuerpo tipográfico 0,9 S</text>')
open(f'{OUT}/construccion.svg','w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W:.2f} {H:.2f}" width="{W:.2f}" height="{H:.2f}">{"".join(d)}</svg>')

# ---------- clear space: X = half the isotype height ----------
X = (BY1-BY0)*k/2
lx0, ly0 = BX0*k, BY0*k
lx1 = S+GAP+wx1*f
ly1 = BASE+wy1*f
m = X; pad = 46
W2 = (lx1-lx0)+2*m+2*pad; H2 = (ly1-ly0)+2*m+2*pad
sx, sy = pad-lx0+m, pad-ly0+m
d2 = [f'<rect x="{pad}" y="{pad}" width="{W2-2*pad:.2f}" height="{H2-2*pad:.2f}" fill="{BLUE}" fill-opacity=".06" stroke="{BLUE}" stroke-opacity=".45" stroke-dasharray="6 5"/>',
      f'<rect x="{pad+m:.2f}" y="{pad+m:.2f}" width="{lx1-lx0:.2f}" height="{ly1-ly0:.2f}" fill="none" stroke="{DIM}" stroke-opacity=".55"/>',
      bolt(BLUE, sx, sy), word(INK, sx+S+GAP, sy+BASE)]
for (x1,x2,y) in [(pad, pad+m, pad+m/2), (W2-pad-m, W2-pad, pad+m/2)]:
    d2.append(f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{y:.2f}" stroke="{DIM}"/>')
    d2.append(f'<text x="{(x1+x2)/2:.2f}" y="{y-7:.2f}" font-family="Inter" font-size="15" font-weight="700" fill="{BLUE}" text-anchor="middle">X</text>')
d2.append(f'<text x="{W2/2:.2f}" y="{H2-pad+26:.2f}" font-family="Inter" font-size="14" fill="{DIM}" text-anchor="middle">X = mitad de la altura del isotipo</text>')
open(f'{OUT}/area-proteccion.svg','w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W2:.2f} {H2:.2f}" width="{W2:.2f}" height="{H2:.2f}">{"".join(d2)}</svg>')
print('construccion.svg  %.1f x %.1f' % (W, H))
print('area-proteccion.svg %.1f x %.1f   X = %.2f (%.0f%% del alto del isotipo)' % (W2, H2, X, 50))
