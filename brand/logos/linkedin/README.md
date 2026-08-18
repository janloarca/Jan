# Foto de perfil para LinkedIn

Cuadradas y con fondo sólido a propósito: **LinkedIn recorta la foto de perfil
en un círculo**, así que un PNG transparente termina sobre el fondo que decida
LinkedIn, y las esquinas de un logo horizontal se pierden en el recorte. Acá el
dibujo va dentro del círculo seguro, con margen por los cuatro lados.

## Cuál subir

| Archivo | Cuándo |
|---|---|
| `chispudo-linkedin-azul-marca` | **El recomendado.** Es el mismo tratamiento que el ícono de la app, así que el avatar y el teléfono se ven como lo mismo. Se reconoce hasta a 32 px, que es como aparece en el feed. |
| `chispudo-linkedin-azul-completo` | Si querés que se lea el nombre. Funciona en la foto grande del perfil; a tamaño de feed el nombre ya no se lee. |
| `chispudo-linkedin-claro-marca` | Para cuando se busca un avatar claro. Ojo: el fondo de LinkedIn también es casi blanco, así que el círculo casi no se distingue. |
| `chispudo-linkedin-claro-completo` | Igual que el anterior, con el nombre. |

Cada uno viene en **400 px** (lo que recomienda LinkedIn para foto de perfil) y
**1000 px** (para página de empresa y para que no se vea suave en pantallas
retina). Subí el de 1000 si dudás: LinkedIn lo reduce solo.

Los cuatro salen de `build_linkedin.py` (`brand/source/scripts/`), que verifica
que el dibujo entre en un círculo del 90% del lado antes de exportar.

## Banner del perfil (portada)

`chispudo-linkedin-banner-1584x396.png` es la medida que pide LinkedIn para la
portada de un perfil personal. El de `3168x792` es el mismo al doble de
resolución: subí ese si querés que se vea nítido en pantallas retina, LinkedIn
lo reduce solo. El `.svg` es el original, por si hay que reencuadrarlo.

Sin texto a propósito: el nombre ya lo dice el avatar justo debajo, y cualquier
frase se corta en el recorte de móvil.

**El recurso central es un knockout.** Un corte diagonal parte el banner en dos
planos de tono distinto, y el rayo lo cruza justo por la mitad invirtiendo su
propio tono al pasar: la figura es una sola, pero se lee oscura sobre el plano
claro y clara sobre el plano oscuro. Eso no se consigue con un degradado, y es
lo que hace que la pieza se vea compuesta en vez de decorada.

Dos decisiones más no son gusto, son la geometría de LinkedIn:

- **Las ondas salen del avatar.** En escritorio la foto de perfil cae centrada en
  (200, 392) con radio 152 en coordenadas del banner, y los círculos están
  centrados exactamente ahí, recortados al plano claro. Por eso el avatar se ve
  dentro de la composición y no pegado encima. Si cambiás la foto, el banner
  sigue funcionando: las ondas salen de la posición, no de la imagen.
- **Nada importante cerca de los bordes**, que es lo que el móvil recorta.

Color plano y filo duro en todo: sin degradados, sin glow, sin grano. El fondo es
exactamente `#2563EB`, el mismo azul del avatar, para que las dos piezas se lean
como una sola, y al no haber degradado no aparecen bandas ni a 3168 px de ancho.

Se regenera con `build_banner.py` (`brand/source/scripts/`), que comprueba antes
de exportar que el corte cruce el rayo entre el 35% y el 65% de su ancho: si
pasa por fuera, la inversión no ocurre y la pieza pierde su único recurso.
