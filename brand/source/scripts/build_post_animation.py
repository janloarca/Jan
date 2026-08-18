"""Secuencia de cuadros: los seis fragmentos entran desde fuera de encuadre y
se ensamblan en el rayo. Mismo lenguaje visual que la imagen estática (B).
Ease-out con un leve overshoot al llegar, para que el aterrizaje se sienta con
peso y no como un simple fundido."""
import math, os
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

def bolt(color, opacity=1.0, scale=1.0):
    tx, ty = CX-(BX0+bw/2)*k*scale, CY-(BY0+bh/2)*k*scale
    return (f'<g opacity="{opacity:.3f}" transform="translate({tx:.2f} {ty:.2f}) scale({k*scale:.6f})">'
            f'<path d="{BOLT}" fill="{color}" stroke="{color}" stroke-width="{SW}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g>')

def frag(cx, cy, r, color, rot, squash, opacity=1.0):
    n = 4
    base = [1.0, 0.62, 0.88, 0.5]
    pts = []
    for i in range(n):
        a = rot + 2*math.pi*i/n
        rr = r * base[i] * squash
        pts.append((cx + rr*math.cos(a), cy + rr*math.sin(a)*0.82))
    d = 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'
    return f'<path d="{d}" fill="{color}" opacity="{opacity:.3f}"/>'

def trail(x0, y0, x1, y1, color, opacity):
    return (f'<line x1="{x0:.1f}" y1="{y0:.1f}" x2="{x1:.1f}" y2="{y1:.1f}" '
            f'stroke="{color}" stroke-width="2" stroke-linecap="round" opacity="{opacity*.5:.3f}"/>')

REST = [
    (222, 200, 88, 0.5, 1.0), (860, 158, 76, 2.0, 1.05), (948, 546, 84, 3.6, 0.95),
    (748, 892, 70, 1.0, 1.0), (272, 872, 78, 4.4, 1.1), (140, 548, 66, 5.4, 0.9),
]
# punto de partida: mismo ángulo desde el centro, mucho más lejos (fuera de encuadre)
START = []
for fx, fy, fr, rot, sq in REST:
    ang = math.atan2(fy-CY, fx-CX)
    dist = math.hypot(fx-CX, fy-CY) * 2.35
    START.append((CX+dist*math.cos(ang), CY+dist*math.sin(ang)))

def ease_out_back(t, s=1.55):
    t -= 1
    return (t*t*((s+1)*t + s) + 1)

def ease_out_cubic(t):
    return 1 - (1-t)**3

FPS = 30
DUR_IN = 1.55        # los fragmentos vuelan y aterrizan
HOLD_SCATTER = 0.28  # una pausa breve, dispersos, antes de que el rayo aparezca
DUR_REVEAL = 0.55    # el rayo final se funde encima
HOLD_END = 1.1        # se sostiene, para el loop y para el que mira sin sonido
FADE_LOOP = 0.4

total = DUR_IN + HOLD_SCATTER + DUR_REVEAL + HOLD_END + FADE_LOOP
n_frames = int(total * FPS)
outdir = '/tmp/post/frames'
os.makedirs(outdir, exist_ok=True)

for fi in range(n_frames):
    t = fi / FPS
    parts = [f'<rect width="{W}" height="{H}" fill="{BG}"/>']

    if t < DUR_IN:
        p = ease_out_back(min(1.0, t/DUR_IN))
    else:
        p = 1.0
    frag_op = min(1.0, (t/0.35)) if t < DUR_IN else 1.0

    positions = []
    for (sx, sy), (fx, fy, fr, rot, sq), color in zip(START, REST, ASSET_COLORS):
        x = sx + (fx-sx)*p
        y = sy + (fy-sy)*p
        positions.append((x, y, fr, rot, sq, color))

    trail_start = DUR_IN * 0.15
    trail_p = 0.0
    if t > trail_start:
        trail_p = min(1.0, (t-trail_start)/(DUR_IN-trail_start+0.3))
    for (x, y, fr, rot, sq, color) in positions:
        ex = CX + (x-CX)*0.60
        ey = CY + (y-CY)*0.60
        parts.append(trail(x, y, ex, ey, color, trail_p*frag_op))

    fade_scatter_start = DUR_IN + HOLD_SCATTER
    frag_fade = 1.0
    if t > fade_scatter_start:
        frag_fade = max(0.0, 1.0 - (t-fade_scatter_start)/DUR_REVEAL)
    for (x, y, fr, rot, sq, color) in positions:
        parts.append(frag(x, y, fr, color, rot, sq, opacity=frag_op*frag_fade))

    reveal_start = DUR_IN + HOLD_SCATTER
    if t > reveal_start:
        rp = ease_out_cubic(min(1.0, (t-reveal_start)/DUR_REVEAL))
        parts.append(bolt(INK, opacity=rp, scale=0.85+0.15*rp))

    end_t = DUR_IN + HOLD_SCATTER + DUR_REVEAL + HOLD_END
    if t > end_t:
        fo = max(0.0, 1.0 - (t-end_t)/FADE_LOOP)
        parts.append(f'<rect width="{W}" height="{H}" fill="{BG}" opacity="{1-fo:.3f}"/>')

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
           + ''.join(parts) + '</svg>')
    open(f'{outdir}/f{fi:04d}.svg', 'w').write(svg)

print(f'{n_frames} frames a {FPS}fps, {total:.2f}s')
