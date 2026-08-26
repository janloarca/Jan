"""Animación v2: misma historia (seis fragmentos se unen en el rayo), coreografía nueva.

Qué cambia contra v1, y por qué se siente más moderno y fluido:
- 60fps y 2160px: el doble de cuadros y el doble de resolución.
- ESCALONADO: cada fragmento sale con su propio retraso (60-180ms). Seis cosas
  moviéndose al unísono se leen mecánicas; llegadas desfasadas se leen vivas.
- TUMBLE: cada fragmento rota ~50 grados durante el vuelo y asienta en su
  rotación final con la misma curva que la posición.
- Escala 0.55 -> 1 con overshoot: aterrizan con peso.
- Las ESTELAS se DIBUJAN (crecen del fragmento hacia el centro) cuando cada
  fragmento aterriza, en vez de aparecer por opacidad global.
- El rayo llega con overshoot de escala + UN PULSO (anillo que se expande y
  desvanece, el mismo gesto del flash de éxito de la app).
- REPOSO VIVO: tras aterrizar, cada fragmento deriva ~4px en un ciclo lento.
  Nada queda congelado, que es lo que delataba al v1 como "hecho por partes".
- Un push-in global casi imperceptible (1.0 -> 1.030) durante todo el clip.
"""
import math, os
from svgelements import Path

W = H = 1080          # coordenadas de composición; se rasteriza a 2160
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
kb = BOLT_H/bh

REST = [
    (222, 200, 88, 0.5, 1.0), (860, 158, 76, 2.0, 1.05), (948, 546, 84, 3.6, 0.95),
    (748, 892, 70, 1.0, 1.0), (272, 872, 78, 4.4, 1.1), (140, 548, 66, 5.4, 0.9),
]
DELAYS = [0.00, 0.07, 0.14, 0.05, 0.11, 0.18]
START = []
for fx, fy, fr, rot, sq in REST:
    ang = math.atan2(fy-CY, fx-CX)
    dist = math.hypot(fx-CX, fy-CY) * 2.35
    START.append((CX+dist*math.cos(ang), CY+dist*math.sin(ang)))

def ease_out_back(t, s=1.35):
    t -= 1
    return t*t*((s+1)*t + s) + 1

def ease_out_quint(t):
    return 1 - (1-t)**5

def ease_out_cubic(t):
    return 1 - (1-t)**3

def clamp01(x):
    return max(0.0, min(1.0, x))

def frag(cx, cy, r, color, rot, squash, scale=1.0, opacity=1.0):
    base = [1.0, 0.62, 0.88, 0.5]
    pts = []
    for i in range(4):
        a = rot + 2*math.pi*i/4
        rr = r * base[i] * squash * scale
        pts.append((cx + rr*math.cos(a), cy + rr*math.sin(a)*0.82))
    d = 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'
    return f'<path d="{d}" fill="{color}" opacity="{opacity:.3f}"/>'

def bolt(color, opacity=1.0, scale=1.0):
    tx, ty = CX-(BX0+bw/2)*kb*scale, CY-(BY0+bh/2)*kb*scale
    return (f'<g opacity="{opacity:.3f}" transform="translate({tx:.2f} {ty:.2f}) scale({kb*scale:.6f})">'
            f'<path d="{BOLT}" fill="{color}" stroke="{color}" stroke-width="{SW}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g>')

FPS = 60
FLIGHT = 1.35                 # vuelo de cada fragmento (desde su delay)
LAND_LAST = max(DELAYS) + FLIGHT
REVEAL = LAND_LAST + 0.22     # el rayo entra apenas aterriza el último
REVEAL_DUR = 0.5
HOLD_END = REVEAL + REVEAL_DUR + 1.25
FADE = 0.45
TOTAL = HOLD_END + FADE

outdir = '/tmp/post/frames_v2'
os.makedirs(outdir, exist_ok=True)
n_frames = int(TOTAL * FPS)

for fi in range(n_frames):
    t = fi / FPS
    inner = []

    for idx, ((sx, sy), (fx, fy, fr, rot, sq), color, dly) in enumerate(zip(START, REST, ASSET_COLORS, DELAYS)):
        tp = clamp01((t - dly) / FLIGHT)
        p = ease_out_back(tp) if tp > 0 else 0.0
        x = sx + (fx-sx)*p
        y = sy + (fy-sy)*p
        # tumble: llega a su rotación final con la misma curva
        rcur = rot - 0.85*(1 - ease_out_quint(tp))
        scale = 0.55 + 0.45*ease_out_back(tp, 2.2) if tp > 0 else 0.55
        op = clamp01((t - dly) / 0.25)
        # deriva en reposo: entra en fundido tras aterrizar, nunca de golpe
        landed = clamp01((t - (dly + FLIGHT)) / 0.8)
        x += landed * 4.0*math.sin(2*math.pi*t/4.6 + idx*1.3)
        y += landed * 3.2*math.cos(2*math.pi*t/5.3 + idx*0.9)

        # estela: se dibuja del fragmento hacia el centro cuando aterriza
        tr = clamp01((t - (dly + FLIGHT*0.72)) / 0.55)
        if tr > 0:
            te = ease_out_cubic(tr)
            ex0, ey0 = x, y
            gx = CX + (x-CX)*0.60
            gy = CY + (y-CY)*0.60
            ex1 = ex0 + (gx-ex0)*te
            ey1 = ey0 + (gy-ey0)*te
            inner.append(f'<line x1="{ex0:.1f}" y1="{ey0:.1f}" x2="{ex1:.1f}" y2="{ey1:.1f}" '
                         f'stroke="{color}" stroke-width="2" stroke-linecap="round" opacity="{0.5*te:.3f}"/>')
        inner.append(frag(x, y, fr, color, rcur, sq, scale=scale, opacity=op))

    if t > REVEAL:
        rp = clamp01((t - REVEAL) / REVEAL_DUR)
        inner.append(bolt(INK, opacity=ease_out_cubic(rp), scale=0.72 + 0.28*ease_out_back(rp, 1.6)))
        # pulso: un anillo que se expande y muere, una sola vez
        pu = clamp01((t - REVEAL - 0.06) / 0.75)
        if 0 < pu < 1:
            pr = 175 + 260*ease_out_cubic(pu)
            inner.append(f'<circle cx="{CX}" cy="{CY}" r="{pr:.1f}" fill="none" stroke="{INK}" '
                         f'stroke-width="{2.6*(1-pu):.2f}" opacity="{0.32*(1-pu):.3f}"/>')

    # push-in global casi imperceptible
    zoom = 1.0 + 0.030 * (t/TOTAL)
    parts = [f'<rect width="{W}" height="{H}" fill="{BG}"/>',
             f'<g transform="translate({CX*(1-zoom):.3f} {CY*(1-zoom):.3f}) scale({zoom:.5f})">'
             + ''.join(inner) + '</g>']

    if t > HOLD_END:
        fo = clamp01((t - HOLD_END)/FADE)
        parts.append(f'<rect width="{W}" height="{H}" fill="{BG}" opacity="{fo:.3f}"/>')

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
           + ''.join(parts) + '</svg>')
    open(f'{outdir}/f{fi:04d}.svg', 'w').write(svg)

print(f'{n_frames} frames · {FPS}fps · {TOTAL:.2f}s · reveal en {REVEAL:.2f}s')
