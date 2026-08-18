# Cómo se generan los archivos de marca

Orden: `wordmark.py` primero (los otros dos leen su salida).

| Script | Qué hace |
|---|---|
| `wordmark.py` | Convierte la palabra "Chispudo" en un trazo vectorial. Compone Inter Black con HarfBuzz para que el kerning sea el mismo que renderiza el navegador, aplica el tracking de -0,02 em de `Logo.jsx` y guarda el resultado en JSON. |
| `build_logos.py` | Arma los 11 archivos de `logos/svg/`, combinando ese trazo con el rayo de `lib/brandBolt.js` en las proporciones exactas de `Logo.jsx`. |
| `build_diagrams.py` | Dibuja los diagramas de construcción y área de protección con esos mismos números, para que el manual no pueda documentar una proporción que los archivos no tienen. |

Requisitos: `python3` con `fonttools`, `uharfbuzz`, `svgelements`, `brotli`;
`rsvg-convert` para exportar los PNG; y una copia de Inter Black.

Las rutas de trabajo están escritas contra `/tmp` porque los scripts se
corrieron una sola vez para producir la entrega. Al regenerar, ajustar las
constantes de ruta que están al inicio de cada archivo.

Fuentes: [Inter](https://fonts.google.com/specimen/Inter) y
[JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono), ambas con
licencia SIL Open Font License.
