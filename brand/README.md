# Marca Chispudo

Manual de marca y archivos de logo. Todo lo que hay aquí se generó a partir del
código del producto, no de una interpretación: las proporciones del logo, los
valores de color y la escala tipográfica salen de `components/ui/Logo.jsx`,
`lib/brandBolt.js`, `lib/colors.js` y `app/globals.css`.

## Qué hay

```
brand/
├── Chispudo-Manual-de-Marca.pdf   16 páginas, A4 horizontal
├── logos/
│   ├── svg/   los originales (vectores, fondo transparente)
│   └── png/   alta resolución, fondo transparente
└── source/    con qué se generó todo
```

## Cuál logo uso

| Necesito | Archivo |
|---|---|
| Fondo claro o papel | `chispudo-logo-principal` |
| Fondo oscuro | `chispudo-logo-inverso` |
| Formato cuadrado o angosto | `chispudo-logo-vertical-principal` |
| Ícono, favicon, avatar | `chispudo-isotipo-azul` / `-blanco` |
| Una sola tinta | `chispudo-logo-mono-tinta` / `-azul` / `-blanco` |

Ante la duda: `chispudo-logo-principal`.

**Usa siempre el SVG si la herramienta lo acepta.** No tiene límite de tamaño y
pesa menos. Los PNG existen solo para herramientas que no aceptan vectores, y
vienen a 1024, 2048 y 4096 px de ancho (el isotipo, por alto).

## Las tres reglas que más se rompen

1. **Escalar desde una esquina.** El logo se escala proporcional, nunca se
   estira, se rota ni se recolorea.
2. **Respetar el aire.** Un margen libre igual a la mitad de la altura del
   isotipo por los cuatro lados. Nada entra ahí.
3. **Elegir la versión según el fondo.** Nunca aclarar u oscurecer el logo para
   que "se vea" sobre un fondo: para eso existen las versiones.

Los tamaños mínimos, los usos incorrectos y el sistema de color completo están
en el PDF.

## Colores rápidos

| | Hex |
|---|---|
| Azul Chispudo | `#2563EB` |
| Azul intenso (hover) | `#1D4ED8` |
| Tinta (texto) | `#111827` |
| Noche (fondo oscuro) | `#0A0A12` |

Tipografías: **Inter** (400, 500, 600, 700, 900) para todo, **JetBrains Mono**
(500, 700) solo para cifras que se comparan en columna.

## Regenerar

`source/` tiene el HTML del manual y los diagramas. El PDF se produce con
Chromium en modo impresión:

```bash
chrome --headless --print-to-pdf=Chispudo-Manual-de-Marca.pdf \
       --no-pdf-header-footer --allow-file-access-from-files \
       file:///ruta/a/brand/source/brandbook.html
```

Los logos se generan con los scripts de `source/scripts/`, que leen el trazo del
rayo desde `lib/brandBolt.js` y arman el logotipo tipografiando Inter Black con
el mismo tracking que usa la aplicación. Si la marca cambia en el producto, se
regeneran desde ahí en vez de editarlos a mano.
