# Gastos automáticos: atajo de iPhone + reenvío de correo

Cada compra con tarjeta entra sola a Finanzas, con categoría, monto, moneda,
comercio y ubicación. Hay dos caminos y están pensados para usarse juntos.

| | Camino A: atajo (iOS) | Camino B: notificación (Android) | Camino C: correo |
|---|---|---|---|
| Qué captura | Apple Pay acercando el teléfono (**verificado**). Apple Pay dentro de una app o un sitio: sin verificar, ver abajo | Todo lo que el banco avisa por push | Todo lo que el banco avisa por correo |
| Cuándo entra | Al instante | Al instante | Barrido diario (o "Sincronizar ahora") |
| Cubre tarjeta física | No | Sí | Sí |
| Trae ubicación GPS | Sí | No (solo la que traiga el texto) | No (solo la que traiga el texto) |

Los dos escriben en el mismo lugar y el mismo cobro nunca se guarda dos veces
(ver "Doble conteo" más abajo).

> Nota sobre lo que iOS **no** permite: Shortcuts no tiene un disparador de
> "llegó una notificación". El push de tu banco no se puede leer. Por eso el
> camino A se cuelga de la automatización *Transacción* de Wallet, que solo ve
> Apple Pay, y el camino C existe para cubrir el resto.

> ✅ **Apple Pay EN TIENDA: verificado el 19 ago 2026.** Compra real de GTQ 18.00
> en un McDonald's de Guatemala acercando el teléfono. iOS registró *"Tapped a
> Wallet pass or payment card — Running Show Notification"* a las 8:06, el push
> del banco marcó el mismo cobro a las 8:06, y el servidor contestó
> `{"ok":true,"status":"created","category":"Alimentación","amount":18,"merchant":"Mcdonalds 50 Bancos"}`.
> El gasto quedó en Flujo con su ⚡, con la hora local correcta (08:06, no
> corrida) y clasificado en Alimentación sin intervención.
>
> ℹ️ **Los dos `Internal server error` del 21 ago 2026 se resolvieron solos.** El
> usuario volvió a usar el atajo el fin de semana siguiente y entró sin
> problemas, sobre el MISMO build (el arreglo de FASE KU se desplegó después).
> Eso es lo que confirma el diagnóstico: un fallo transitorio de la base de
> datos, no una configuración rota ni un bug del camino. Una credencial mal
> puesta, un permiso o un error de código seguirían fallando hoy.
>
> ⚠️ **Lo que sigue SIN verificar: ¿Apple Pay dentro de una app o un sitio web
> dispara la misma automatización?** iOS rotula el disparador como *"When Any
> Card is **tapped**"*, y "tapped" apunta literalmente a acercar el teléfono. La
> pantalla de configuración de ese disparador **no ofrece ninguna opción** de
> tienda contra línea (solo Categories y Merchants), así que la pregunta no se
> puede contestar mirando ajustes.
>
> Esta guía llegó a afirmar las dos cosas en distintos momentos y una de las dos
> estaba mal, así que queda escrito como pregunta hasta que haya evidencia.
>
> **Lo que falta para cerrarla:** una compra con Apple Pay en línea, y mirar la
> línea de "último uso" del token en Configuración → Automático. Si no se mueve,
> la respuesta es que solo cubre el toque físico, y esta tabla se corrige con ese
> dato.
>
> No cambia qué hacer mientras tanto: el camino C cubre las dos igual.

## Paso 1: generar el token

Configuración → pestaña **Automático** → "Generar token para un dispositivo".

Ese token es la llave de los dos caminos: el atajo lo manda como header y la
dirección de reenvío lo lleva como etiqueta. Da permiso para **agregar** gastos a
tu cuenta, nunca para leerla. Si pierdes el teléfono, revócalo ahí mismo.

## Paso 2 (camino A): el atajo del iPhone

En la app **Atajos** → pestaña **Automatización** → **Nueva automatización** →
**Transacción**.

1. Elige la tarjeta de Wallet que quieres monitorear.
2. Marca **Ejecutar inmediatamente** (si no, iOS te pide confirmar cada compra).
3. Agrega la acción **Obtener ubicación actual**.
4. Agrega la acción **Obtener contenido de una URL** y configúrala así:

**URL**

```
https://chispu.xyz/api/ingest/expense
```

**Método:** `POST`

**Encabezados**

| Clave | Valor |
|---|---|
| `Authorization` | `Bearer <tu token>` |
| `Content-Type` | `application/json` |

**Cuerpo de la solicitud:** JSON

| Campo | Tipo | Valor |
|---|---|---|
| `amount` | Número | variable *Monto* de la transacción |
| `currency` | Texto | `GTQ` (o la propiedad *Currency* de Transaction, si tu iOS la ofrece) |
| `merchant` | Texto | variable *Comercio* de la transacción |
| `occurredAt` | Texto | variable *Fecha* con formato `yyyy-MM-dd'T'HH:mm:ssZ` |
| `lat` | Número | *Latitud* de Ubicación actual |
| `lon` | Número | *Longitud* de Ubicación actual |

**Sobre la moneda.** `currency` es una constante que escribís una vez, así que
una compra en otra moneda entraría bajo la equivocada. Dos defensas: si la
variable *Transaction* de tu iOS ofrece una propiedad **Currency**, usala ahí y
es exacto; y si no, el servidor lee la moneda que el propio monto declare
("$100.00", "100.00 USD") y esa le gana a la constante. Un "$" solo pisa a una
moneda que no se escriba con "$", para que en México "$100.00" siga siendo pesos.

**No hace falta mandar `date` aparte.** Con `occurredAt` el día se toma de sus
primeros diez caracteres, o sea el día que marcaba tu reloj, y eso es más
correcto que calcularlo aparte: una compra de las 23:50 en Guatemala es el 3 de
agosto, aunque en UTC ya sea el 4. Una acción *Formatear fecha* menos en el
atajo, y un lugar menos donde las dos puedan discrepar.

Los nombres exactos de las variables cambian entre versiones de iOS. Si la
automatización no te expone *Comercio* o *Monto* por separado, usa la variable
completa de la transacción en `merchant` y el parser se queda con el nombre: lo
único indispensable es que `amount` sea un número.

`occurredAt` es opcional pero conviene mandarlo: **la hora es lo único que
distingue un cobro capturado dos veces de dos cobros iguales.** Dos parqueos de
Q20 el mismo día en el mismo lugar son dos cobros si pasaron a horas distintas y
uno solo si pasaron a la misma, y ningún parecido de nombres puede decidir eso.
Es el mismo campo *Fecha* de la transacción, solo que con el formato completo
(`yyyy-MM-dd'T'HH:mm:ssZ` en la acción *Formatear fecha*).

Si no lo mandás no se rompe nada: se usa la hora en que llegó la solicitud, que
acá se le parece bastante porque la automatización dispara en el momento del
cobro. La diferencia es el margen con que se comparan dos capturas: un minuto
cuando las dos horas son reales, cinco cuando alguna es aproximada.

La respuesta te dice qué pasó, para que puedas mostrar una notificación al final
del atajo sin una segunda llamada:

```json
{ "ok": true, "status": "created", "category": "Entretenimiento",
  "amount": 17, "currency": "GTQ", "merchant": "Rally Padel Guatemala",
  "needsReview": false }
```

`status` es `created` o `duplicate`. Un `duplicate` no es un error: significa que
ese cobro ya estaba registrado.

### Probar sin gastar dinero

```bash
curl -X POST https://chispu.xyz/api/ingest/expense \
  -H "Authorization: Bearer <tu token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":17,"currency":"GTQ","merchant":"Rally Padel Guatemala","date":"2026-08-03","occurredAt":"2026-08-03T14:32:00-06:00"}'
```


## Camino B: Android (notificación del banco)

Android tiene lo que iOS no: **una app puede leer las notificaciones**. Eso
cambia de qué nos colgamos. En iPhone hay que colgarse de la billetera, que solo
ve Apple Pay; en Android nos colgamos del **push del propio banco**, que se
dispara con todo — tarjeta física, compra en línea, Google Pay, transferencia.

Por eso este camino no es el equivalente del atajo: es mejor. Cubre de una vez
lo que en iPhone necesita dos caminos.

### Del lado del teléfono

Con **MacroDroid** (más simple) o **Tasker** (más potente):

1. Darle acceso a notificaciones a la app de automatización.
2. Disparador: *Notificación recibida*, filtrado a la app de tu banco.
3. Acción: *Petición HTTP*, `POST` a `https://chispu.xyz/api/ingest/expense`,
   con el header `Authorization: Bearer <tu token>` y este cuerpo:

   ```json
   {"source":"android","title":"","text":""}
   ```

   En los dos campos vacíos van las variables de **título** y **texto** de la
   notificación que ofrece la app de automatización.
4. **Excluir la app de la optimización de batería.** Es el modo de fallo típico
   en Android: sin eso el sistema apaga el escucha y las capturas se detienen sin
   avisar.

### Por qué el texto se parsea en el servidor

El push llega como texto plano y el parseo pasa acá, no en Tasker. No es
comodidad: ese parser ya resuelve la ambigüedad del `$` contra la moneda base
del usuario (en México, Colombia, Chile, Argentina y Uruguay el peso local se
escribe `$`), las dos convenciones de número de LatAm, y la diferencia entre un
cobro y un reverso. Una copia de esa lógica dentro de una app de automatización
se queda atrás en la primera corrección, y quien la configuró no tiene cómo
darse cuenta.

Es el **mismo** módulo que usa el camino de correo (`lib/alertIngest.js`). Lo
único que difiere entre los dos es de dónde sale el instante del cobro: el correo
lo saca de su cabecera `Date`, el push usa la hora de llegada, que es exacta
porque llega en segundos.

### Lo que este camino no trae

El push suele traer menos que un correo. El de Banco G&T, por ejemplo, trae
comercio, ciudad y monto, pero **no la hora ni los últimos cuatro dígitos**. La
hora no importa (la de llegada es mejor dato); los últimos cuatro sí se pierden,
así que con dos tarjetas del mismo banco no se puede distinguir cuál se usó.

### El permiso, dicho de frente

El acceso a notificaciones deja que la app de automatización lea **todas** tus
notificaciones, no solo las del banco. Es tu teléfono y tu decisión, pero
conviene tomarla sabiéndolo.

## Paso 3 (camino C): reenvío de correo

### Del lado del servidor (una sola vez)

No hace falta crear ningún buzón: se reusa `reminders@chispu.xyz`, el que ya
manda los recordatorios y los reportes. Lo que identifica al usuario es la
etiqueta `+<token>`, no el nombre del buzón, así que `reminders+<token>@chispu.xyz`
llega a ese mismo buzón tal como está.

1. Zoho → Seguridad → App Passwords: sirve la misma que ya usa el SMTP.
2. En Vercel, define `IMAP_HOST=imap.zoho.com`, `IMAP_USER=reminders@chispu.xyz`,
   `IMAP_PASS` y `NEXT_PUBLIC_INGEST_EMAIL=reminders@chispu.xyz`. Los detalles
   están en `.env.local.example`.

Sin esas variables el barrido es un no-op silencioso y la pestaña Automático
esconde la opción de correo, así que se puede desplegar antes de configurarlo.

**Compartir el buzón es seguro, y esto es lo que lo hace seguro:** el barrido
solo marca como leído un correo que traía un token nuestro. Uno sin token (un
rebote, una respuesta automática, cualquier cosa dirigida a una persona) se deja
exactamente como estaba, así que un proceso de fondo nunca decide por vos qué ya
viste. Y los recorre del más nuevo al más viejo, para que una acumulación de
correo ajeno no se coma el presupuesto del barrido y tape las alertas de hoy.

Opcional, más ordenado: una regla de Zoho que mueva lo dirigido a `reminders+*`
a una carpeta (por ejemplo `Gastos`) y `IMAP_MAILBOX` apuntando ahí. Con eso el
barrido ni siquiera mira la bandeja donde caen los rebotes.

### Del lado del usuario

1. Activa las alertas por correo de tu tarjeta en la banca en línea del banco.
2. En tu correo, crea una regla que reenvíe esas alertas a la dirección que
   aparece en Configuración → Automático, con esta forma:

   ```
   reminders+<tu token>@chispu.xyz
   ```

   En Gmail: Configuración → Filtros → crear filtro con `De: alertas@tubanco.com`
   → "Reenviar a" (hay que verificar la dirección de reenvío una vez).

El token en la dirección es lo que identifica tu cuenta. El remitente **no** se
usa para eso a propósito: la cabecera `From:` se falsifica sin esfuerzo, y rutear
por ella dejaría que cualquiera escribiera gastos en la cuenta de otro.

### Cadencia

El barrido corre una vez al día, dentro del cron de notificaciones (7am hora de
Guatemala). Va ahí y no en un cron propio porque el plan Hobby de Vercel permite
dos, y el suyo era el tercero: estaba declarado pero nunca se programaba. Si no
quieres esperar, el botón **Sincronizar ahora** en Configuración → Automático
corre el mismo barrido.

## Doble conteo

El mismo cobro llega por los dos caminos con frecuencia: pagas con Apple Pay
(camino A lo ve al instante) y el banco además te manda el correo (camino C lo ve
en la noche). No se duplica, por dos capas:

1. **Id determinístico.** El mismo evento repetido resuelve siempre al mismo
   documento, así que reintentar el atajo no escribe dos veces.
2. **La hora.** Es lo que decide cuando las dos capturas la tienen: mismo monto
   y mismo instante es un cobro, mismo monto a horas distintas son dos. Se
   comparan instantes y no la etiqueta del día, así que un cobro de las 7pm (que
   en UTC cae al día siguiente) no se parte en dos por eso. El margen es de un
   minuto cuando las dos horas son las reales, y de cinco cuando alguna es la de
   llegada, para absorber la demora de un correo reenviado.
3. **Comercio, solo el mismo día.** Cuando falta la hora de un lado, se compara
   el nombre del comercio dentro del mismo día. Esto también protege contra un
   gasto que ya habías escrito a mano.

Fechas distintas son **dos cobros**, siempre: dos parqueos de Q20 el lunes y el
martes son dos parqueos. Si un transporte llegara a reportar al día siguiente,
vas a ver un duplicado que podés borrar, y eso es a propósito: un duplicado que
se ve se arregla, un cobro que se borró solo no.

## Categorías

1. **Reglas que le enseñaste.** Siempre ganan.
2. **Reglas de fábrica.** Palabras clave de comercios, con sesgo Guatemala
   (`lib/expenseCategorize.js`).
3. **Otros Gastos**, marcado con `?` en la lista para que lo revises.

Cuando corriges la categoría de un gasto automático en la lista de
transacciones, se guarda la regla para ese comercio y el siguiente cobro entra ya
clasificado. Las reglas aprendidas se ven y se borran en Configuración →
Automático. Corregir un gasto que escribiste a mano no enseña nada, para no
guardar reglas a partir de descripciones sueltas.

## Si algo no entra

| Síntoma | Causa probable |
|---|---|
| El atajo responde 401 | Token mal copiado, o falta el prefijo `Bearer ` |
| El atajo responde 400 `MISSING_AMOUNT` | No llegó ningún monto. Causa dominante: correr la automatización **a mano** desde Atajos, donde no hay ninguna transacción de Wallet de la cual sacarlo. Probar con una compra real de Apple Pay |
| El atajo responde 400 `INVALID_AMOUNT` | Llegó un monto pero no se puede leer como número. Revisar que el campo use la variable Transacción → Monto y no texto escrito |
| La automatización no dispara | Lo seguro: un cargo al número de tarjeta **sin** Apple Pay (tarjeta física, o una guardada en un sitio) nunca la dispara, y eso lo recoge el camino de correo. Si el cobro SÍ fue con Apple Pay: revisar en Atajos → Automatización que **Ejecutar inmediatamente** esté encendido, que **no** tenga filtro de tarjeta ni de comercio, y que esté en el mismo teléfono con que se pagó (las automatizaciones no se sincronizan entre dispositivos). Si todo eso está bien y aun así no disparó **con un pago en línea**, ver la duda abierta al inicio de esta guía |
| La hora del gasto sale corrida | El atajo arma `occurredAt` con *Format Current Date → ISO 8601*. Si iOS emite esa hora **sin zona**, el servidor (UTC) la leería seis horas corrida. Desde FASE JR el servidor descarta una hora sin zona y usa la de llegada, que para el atajo es prácticamente el instante de la compra — así que no hay nada que configurar. Quitar el campo `occurredAt` del cuerpo también es válido y da el mismo resultado |
| No sé si el atajo llegó al servidor | Configuración → Automático muestra, bajo cada token, **cuándo se usó por última vez y cómo terminó**. "Nunca se ha usado" significa que la petición no llegó ni una vez: el problema está en el teléfono, no en el servidor |
| Responde `"status": "duplicate"` | Ya estaba registrado, no es error |
| Responde **503** `error:quota` | La base de datos llegó a su límite diario de uso. Se reinicia sola en unas horas; ese gasto no se registró, así que agregarlo a mano o esperar a que llegue por el estado de cuenta |
| Responde **503** `error:14` (o `error:4` / `error:13`) | Hipo de la base de datos. El servidor ya lo reintenta solo tres veces, así que llegar acá significa que no cedió: es pasajero y la próxima compra debería entrar |
| Responde **500** | Fallo del servidor que no es de la base. La línea de "último uso" del token guarda el código; hay que reportarlo |
| El correo no entra | La regla de reenvío perdió el `+<token>`, o el correo llegó sin monto reconocible |
| Todo cae en Otros Gastos | Aún no hay regla para ese comercio: corrígelo una vez y se aprende |

Las devoluciones y reversos se detectan y **no** se registran como gasto, para no
inflar el mes. Esos siguen entrando por la importación del estado de cuenta.
