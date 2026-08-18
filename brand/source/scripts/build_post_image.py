"""Variante B: fragmentos angulares (4 vértices, cortes rectos) en vez de
blobs orgánicos, para que casen con la geometría dura del propio rayo."""
import math
from svgelements import Path

W = H = 1080
BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
SW = 1.1
BG = '#F8F9FB'
INK = '#111827'
ASSET_COLORS = ['#2C67DC', '#08A8AF', '#B274DC', '#E07227', '#00764F', '#BD2D76']

bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0]-SW/2, bb[1]-SW/2, bb[2]+SW/2, bb[3]+SW/2
bw, bh = BX1-BX0, BY1-BY0
CX, CY = W/2, H/2 + 18
BOLT_H = 300.0
k = BOLT_H/bh

def bolt(color):
    tx, ty = CX-(BX0+bw/2)*k, CY-(BY0+bh/2)*k
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({k:.6f})">'
            f'<path d="{BOLT}" fill="{color}" stroke="{color}" stroke-width="{SW}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g>')

def frag(cx, cy, r, color, rot, squash):
    """Un paralelogramo irregular con cuatro esquinas: geometría dura, cortes
    limpios, como un fragmento de vidrio."""
    n = 4
    pts = []
    base = [1.0, 0.62, 0.88, 0.5]
    for i in range(n):
        a = rot + 2*math.pi*i/n
        rr = r * base[i] * squash
        pts.append((cx + rr*math.cos(a), cy + rr*math.sin(a)*0.82))
    d = 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'
    return f'<path d="{d}" fill="{color}"/>'

def trail(x0, y0, x1, y1, color):
    return (f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
            f'stroke="{color}" stroke-width="2" stroke-linecap="round" opacity=".5"/>')

placements = [
    (222, 200, 88, 0.5, 1.0), (860, 158, 76, 2.0, 1.05), (948, 546, 84, 3.6, 0.95),
    (748, 892, 70, 1.0, 1.0), (272, 872, 78, 4.4, 1.1), (140, 548, 66, 5.4, 0.9),
]
parts = [f'<rect width="{W}" height="{H}" fill="{BG}"/>']
for (fx, fy, fr, rot, sq), color in zip(placements, ASSET_COLORS):
    edge_x = CX + (fx-CX) * (BOLT_H*0.60)/math.hypot(fx-CX, fy-CY)
    edge_y = CY + (fy-CY) * (BOLT_H*0.60)/math.hypot(fx-CX, fy-CY)
    parts.append(trail(fx, fy, edge_x, edge_y, color))
for (fx, fy, fr, rot, sq), color in zip(placements, ASSET_COLORS):
    parts.append(frag(fx, fy, fr, color, rot, sq))
parts.append(bolt(INK))

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
       + ''.join(parts) + '</svg>')
open('/tmp/post/img2.svg', 'w').write(svg)
