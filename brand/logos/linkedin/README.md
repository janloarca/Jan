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
portada de un perfil personal. El de `3168x792` es el mismo a doble resolución:
subí ese si querés que se vea nítido en pantallas retina, LinkedIn lo reduce
solo. El `.svg` es el original, por si hay que reencuadrarlo.

Sin texto a propósito: el nombre ya lo dice el avatar justo debajo, y cualquier
frase se corta en el recorte de móvil.

Dos cosas de la composición no son gusto, son la geometría de LinkedIn:

- **Las ondas salen del avatar.** En el escritorio la foto de perfil cae
  centrada en (200, 392) con radio 152 en coordenadas del banner, y los círculos
  están centrados exactamente ahí. Por eso el avatar se ve dentro de la
  composición y no pegado encima. Si algún día cambias la foto de perfil, el
  banner sigue funcionando: las ondas salen de la posición, no de la imagen.
- **Nada importante cerca de los bordes.** En móvil LinkedIn recorta los lados.

El fondo es exactamente `#2563EB`, el mismo azul del avatar, para que las dos
piezas se lean como una sola. Color plano y filo duro, sin degradados ni
sombras: por eso no hay bandas de color aunque el archivo mida 3168 px de ancho.

Se regenera con `build_banner.py` (`brand/source/scripts/`), que comprueba que
el rayo no invada la zona del avatar ni se salga por la derecha.
