"""Imagenes de los posts #2 y #3 de la serie de LinkedIn, en el MISMO lenguaje
visual del #1 (build_post_image.py): fondo #F8F9FB, tinta #111827, los colores
reales de las clases de activo, geometria dura de cortes rectos, sin texto y
sin degradados. La historia la cuenta el post; la imagen solo la refuerza.

  #2 (gastos automaticos): fragmentos dispersos a la izquierda (los gastos
     sueltos del dia) y los MISMOS colores ya alineados como filas de una
     lista a la derecha; el rayo en el medio es quien ordena. Desorden que se
     vuelve registro, sin que nadie teclee nada.

  #3 (comparar sin montos): tres barras de alturas distintas sobre una linea
     de tinta (los rendimientos, lo unico que viaja) y debajo de la linea sus
     bases disolviendose en fragmentos que se apagan (los montos, que nunca
     salen de tu cuenta). El rayo chico arriba es la marca.
"""
import math
from svgelements import Path

W = H = 1080
BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
SW = 1.1
BG = '#F8F9FB'
INK = '#111827'
LINE = '#E5E7EB'
COLORS = ['#2C67DC', '#08A8AF', '#B274DC', '#E07227', '#00764F', '#BD2D76']

bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0]-SW/2, bb[1]-SW/2, bb[2]+SW/2, bb[3]+SW/2
bw, bh = BX1-BX0, BY1-BY0

def bolt(cx, cy, height, color):
    k = height/bh
    tx, ty = cx-(BX0+bw/2)*k, cy-(BY0+bh/2)*k
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({k:.6f})">'
            f'<path d="{BOLT}" fill="{color}" stroke="{color}" stroke-width="{SW}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g>')

def frag(cx, cy, r, color, rot, squash=1.0, opacity=1.0):
    base = [1.0, 0.62, 0.88, 0.5]
    pts = []
    for i in range(4):
        a = rot + 2*math.pi*i/4
        rr = r * base[i] * squash
        pts.append((cx + rr*math.cos(a), cy + rr*math.sin(a)*0.82))
    d = 'M ' + ' L '.join(f'{x:.1f} {y:.1f}' for x, y in pts) + ' Z'
    op = f' opacity="{opacity}"' if opacity < 1 else ''
    return f'<path d="{d}" fill="{color}"{op}/>'

def save(name, parts):
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'width="{W}" height="{H}">' + ''.join(parts) + '</svg>')
    open(f'/tmp/post23/{name}.svg', 'w').write(svg)

# ---------- #2: gastos automaticos ----------
parts = [f'<rect width="{W}" height="{H}" fill="{BG}"/>']
# izquierda: cinco fragmentos dispersos, cada uno con su estela hacia el rayo
scattered = [
    (218, 210, 66, 0.6, 1.05), (128, 424, 54, 2.3, 0.9), (176, 648, 62, 4.1, 1.0),
    (318, 852, 56, 1.4, 1.1), (392, 316, 44, 5.2, 0.95),
]
CXB, CYB = 540, 540
for (fx, fy, fr, rot, sq), color in zip(scattered, COLORS):
    dx, dy = CXB-fx, CYB-fy
    dist = math.hypot(dx, dy)
    sx, sy = fx + dx*(fr*0.9/dist), fy + dy*(fr*0.9/dist)
    ex, ey = fx + dx*(1-165/dist), fy + dy*(1-165/dist)
    parts.append(f'<line x1="{sx:.0f}" y1="{sy:.0f}" x2="{ex:.0f}" y2="{ey:.0f}" '
                 f'stroke="{color}" stroke-width="2.5" stroke-linecap="round" opacity=".45"/>')
for (fx, fy, fr, rot, sq), color in zip(scattered, COLORS):
    parts.append(frag(fx, fy, fr, color, rot, sq))
# derecha: los MISMOS cinco colores como filas alineadas de una lista
ROW_X, ROW_W, ROW_H, GAP = 668, 260, 64, 34
top = CYB - (5*ROW_H + 4*GAP)/2
for i, ((fx, fy, fr, rot, sq), color) in enumerate(zip(scattered, COLORS)):
    y = top + i*(ROW_H+GAP)
    parts.append(f'<rect x="{ROW_X}" y="{y:.0f}" width="{ROW_H}" height="{ROW_H}" rx="14" fill="{color}"/>')
    parts.append(f'<rect x="{ROW_X+ROW_H+22}" y="{y+18:.0f}" width="{ROW_W-ROW_H-22}" height="{ROW_H-36}" rx="{(ROW_H-36)/2}" fill="{LINE}"/>')
parts.append(bolt(CXB, CYB, 240, INK))
save('chispudo-post-registro', parts)

# ---------- #3: comparar sin montos ----------
parts = [f'<rect width="{W}" height="{H}" fill="{BG}"/>']
BASE_Y = 660
bars = [(300, 300, COLORS[0]), (540, 420, COLORS[1]), (780, 210, COLORS[3])]
BAR_W = 120
# barras (los rendimientos: lo unico que viaja)
for cx, h, color in bars:
    parts.append(f'<rect x="{cx-BAR_W/2}" y="{BASE_Y-h}" width="{BAR_W}" height="{h}" rx="26" fill="{color}"/>')
# la linea de tinta: la frontera de tu cuenta
parts.append(f'<line x1="150" y1="{BASE_Y}" x2="930" y2="{BASE_Y}" stroke="{INK}" '
             f'stroke-width="7" stroke-linecap="round"/>')
# debajo: cada barra se disuelve en fragmentos que se apagan (los montos)
for cx, h, color in bars:
    seed = int(cx) % 3
    drops = [(64, 34, 0.7, 0.5), (150, 26, 2.5, 0.3), (228, 18, 4.4, 0.15)]
    for j, (dy, r, rot, op) in enumerate(drops):
        jitter = [(-18, 14, -8), (12, -20, 16), (20, -10, -14)][seed][j]
        parts.append(frag(cx + jitter, BASE_Y + dy + seed*9, r, color, rot + seed, 1.0, op))
# la marca, chica y arriba a la derecha
parts.append(bolt(884, 176, 120, INK))
save('chispudo-post-privado', parts)
print('ok: dos SVG en /tmp/post23')
