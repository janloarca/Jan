# Post de LinkedIn: seis fragmentos → un rayo

Compañero visual del primer post (historia de fragmentación: plata repartida
en distintas cuentas, monedas y tipos de activo, que Chispu unifica). Sin
texto: la historia ya la cuenta el post, la imagen solo tiene que reforzarla.

Los seis fragmentos usan los colores REALES de las seis clases de activo
invertidas de `lib/colors.js` (CATEGORY): acciones, renta fija, fondos,
cripto, bienes raíces, alternativos. No son colores decorativos, son los
mismos que ves en cualquier gráfica de la app.

- `chispudo-post-fragmentos.png` — imagen estática, 1080×1080 (cuadrado nativo
  de feed, se ve completo en escritorio y celular sin recorte).
- `chispudo-post-fragmentos.mp4` — la misma escena animada: los fragmentos
  entran desde fuera de encuadre, aterrizan dispersos, y el rayo se revela
  encima. H.264, 1080×1080, 30fps, ~3.9s, pensado para loopear (el último
  medio segundo se desvanece a blanco). Sin audio: en el feed de LinkedIn
  el video arranca muteado por defecto, así que tiene que decir algo incluso
  en silencio.
- `chispudo-post-fragmentos.svg` — el original de la imagen estática.

Se regeneran con `build_post_image.py` y `build_post_animation.py`
(`brand/source/scripts/`).

## Nota sobre el video

Este entorno trae DOS ffmpeg: uno recortado de Playwright
(`/opt/pw-browsers/ffmpeg-1011/`, sin H.264, solo VP8/WebM) y el del sistema
operativo, instalado vía `apt-get install ffmpeg`, que sí trae libx264. El mp4
de acá se codificó con el segundo. Si se regenera en un entorno nuevo sin
ffmpeg del sistema, instalarlo primero o el build de Playwright no va a poder
producir un `.mp4`.
