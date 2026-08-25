"""Banner de portada de LinkedIn (perfil personal, 1584x396). Sin texto.

El recurso central es un KNOCKOUT: un corte diagonal parte el banner en dos
planos de tono distinto, y el rayo lo cruza por la mitad invirtiendo su propio
tono al pasar. La figura es una sola, pero se lee oscura sobre el plano claro y
clara sobre el plano oscuro. Eso es lo que hace que la pieza se vea compuesta y
no decorada, y no se puede conseguir con un degradado.

Dos decisiones no son gusto, salen de dónde pone LinkedIn las cosas:

1. En el escritorio el avatar cae centrado en (200, 392) con radio 152 en
   coordenadas del banner. Las ondas concéntricas salen de ESE punto, así que la
   foto de perfil queda dentro de la composición en vez de pegada encima. Van
   recortadas al plano claro: al llegar al corte desaparecen.
2. En móvil LinkedIn recorta los lados, así que nada indispensable vive cerca de
   los bordes.

Color plano y filo duro en todo: sin degradados, sin glow, sin grano. El fondo es
EXACTAMENTE el azul del avatar para que las dos piezas se lean como una sola, y
al no haber degradado no aparecen bandas ni a 3168 px de ancho.
"""
from svgelements import Path

W, H = 1584, 396
BOLT = ('M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 '
        '11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 '
        '0 01.913-.143z')
SW = 1.1
BASE, PLANE, BOLT_DARK, BOLT_LIGHT = '#2563EB', '#1D4ED8', '#1A3FAF', '#3B82F6'
AVX, AVY, AVR = 200.0, 392.0, 152.0          # avatar en coordenadas del banner

SEAM_TOP, SEAM_BOT = 1250.0, 1050.0          # el corte diagonal
BOLT_H, BCX = 560.0, 1150.0                  # el rayo, cortado arriba y abajo

bb = Path(BOLT).bbox()
BX0, BY0, BX1, BY1 = bb[0]-SW/2, bb[1]-SW/2, bb[2]+SW/2, bb[3]+SW/2
bw, bh = BX1-BX0, BY1-BY0
k = BOLT_H/bh
x0, x1 = BCX - bw*k/2, BCX + bw*k/2

# El corte tiene que cruzar el rayo cerca de su centro: si pasa por fuera, la
# inversión no ocurre y la pieza pierde su único recurso.
cross = ((SEAM_TOP + SEAM_BOT)/2 - x0) / (x1 - x0)
assert 0.35 < cross < 0.65, f'el corte cruza al {cross:.0%} del rayo'
assert x1 <= W, 'el rayo se sale por la derecha'
assert x0 > AVX + AVR + 380, 'el rayo invade la zona del avatar'

right = f'M {SEAM_TOP} 0 L {W} 0 L {W} {H} L {SEAM_BOT} {H} Z'
left = f'M 0 0 L {SEAM_TOP} 0 L {SEAM_BOT} {H} L 0 {H} Z'

def bolt(color, clip):
    tx, ty = BCX-(BX0+bw/2)*k, H/2-(BY0+bh/2)*k
    return (f'<g clip-path="url(#{clip})"><g transform="translate({tx:.3f} {ty:.3f}) scale({k:.6f})">'
            f'<path d="{BOLT}" fill="{color}" stroke="{color}" stroke-width="{SW}" '
            f'stroke-linejoin="round" stroke-linecap="round"/></g></g>')

# Las ondas crecen con una razón constante: es un ritmo, no cinco números sueltos.
rings, r = [], AVR*1.41
for i in range(6):
    rings.append(f'<circle cx="{AVX}" cy="{AVY}" r="{r:.1f}" fill="none" stroke="#FFFFFF" '
                 f'stroke-width="{1.5 if r < 400 else 1.25}" '
                 f'opacity="{max(0.085, round(0.34*(0.79**i), 3))}"/>')
    r *= 1.315

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
       f'<defs><clipPath id="L"><path d="{left}"/></clipPath>'
       f'<clipPath id="R"><path d="{right}"/></clipPath></defs>'
       f'<rect width="{W}" height="{H}" fill="{BASE}"/>'
       f'<g clip-path="url(#L)">{"".join(rings)}</g>'
       f'<path d="{right}" fill="{PLANE}"/>'
       + bolt(BOLT_DARK, 'L') + bolt(BOLT_LIGHT, 'R') + '</svg>')

out = '/home/user/Jan/brand/logos/linkedin/chispudo-linkedin-banner.svg'
open(out, 'w').write(svg)
print(f'rayo {bw*k:.0f}x{BOLT_H:.0f} en x {x0:.0f}..{x1:.0f}')
print(f'el corte lo cruza al {cross:.0%} de su ancho')
