"""Banner de LinkedIn (perfil personal, 1584x396). Sin texto.

Dos decisiones gobiernan la composición, y las dos salen de dónde pone LinkedIn
las cosas, no del gusto:

1. El avatar cae centrado en (200, 392) con radio 152 en coordenadas del banner.
   Las ondas concéntricas salen de ESE punto, así que el avatar queda dentro de
   la composición en vez de pegado encima.
2. En móvil LinkedIn recorta los lados, así que no hay nada indispensable cerca
   de los bordes izquierdo y derecho.

Color plano y filo duro a propósito: nada de degradados difusos, glow ni grano.
El fondo es EXACTAMENTE el azul del avatar (#2563EB) para que las dos piezas se
lean como una sola.
"""
from svgelements import Path

W, H = 1584, 396
BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
SW = 1.1
BLUE, DEEP = '#2563EB', '#1D4ED8'
AVX, AVY, AVR = 200.0, 392.0, 152.0

bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0]-SW/2, bb[1]-SW/2, bb[2]+SW/2, bb[3]+SW/2
bw, bh = BX1-BX0, BY1-BY0

BOLT_H, BCX, BCY = 560.0, 1300.0, H/2
k = BOLT_H/bh
half_w = bw*k/2
assert BCX + half_w <= W + 2, 'el rayo se saldría por la derecha'
assert BCX - half_w > 900, 'el rayo invadiría la zona del avatar'

# Las ondas arrancan justo afuera del avatar y crecen con una razón constante:
# el ritmo es una progresión, no cinco números escritos a mano.
RATIO = 1.315
radii, r = [], AVR * 1.41
while r < 900:
    radii.append(round(r, 1))
    r *= RATIO

parts = [f'<rect width="{W}" height="{H}" fill="{BLUE}"/>']
for i, rr in enumerate(radii):
    op = round(max(0.085, 0.34 * (0.79 ** i)), 3)
    sw = 1.5 if rr < 400 else 1.25
    parts.append(f'<circle cx="{AVX}" cy="{AVY}" r="{rr}" fill="none" stroke="#FFFFFF" '
                 f'stroke-width="{sw}" opacity="{op}"/>')

tx, ty = BCX-(BX0+bw/2)*k, BCY-(BY0+bh/2)*k
parts.append(f'<g transform="translate({tx:.3f} {ty:.3f}) scale({k:.6f})">'
             f'<path d="{BOLT}" fill="{DEEP}" stroke="{DEEP}" stroke-width="{SW}" '
             f'stroke-linejoin="round" stroke-linecap="round"/></g>')

open('/tmp/banner/final.svg', 'w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
    + ''.join(parts) + '</svg>')
print(f'rayo {bw*k:.0f}x{BOLT_H:.0f} en x {BCX-half_w:.0f}..{BCX+half_w:.0f}')
print(f'ondas r = {radii}')
