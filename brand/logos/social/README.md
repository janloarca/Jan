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
- `chispudo-post-fragmentos-hd.mp4` — **el que hay que subir.** La escena
  animada en 2160×2160 a 60fps (~4s, H.264, sin audio: el feed de LinkedIn
  arranca muteado, así que tiene que decir algo en silencio). Coreografía v2:
  cada fragmento entra con su propio retraso y rota en vuelo (seis cosas al
  unísono se leen mecánicas, desfasadas se leen vivas), las estelas se dibujan
  hacia el centro cuando cada uno aterriza, el rayo llega con overshoot y un
  pulso que se expande, y en el reposo los fragmentos derivan unos pocos
  píxeles para que nada quede congelado. Termina en fundido a blanco para
  loopear.
- `chispudo-post-fragmentos.mp4` — la v1 (1080×1080, 30fps, todos los
  fragmentos al unísono). Se queda como referencia de qué cambió; no subirla.
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
