# Gastos automáticos: atajo de iPhone + reenvío de correo

Cada compra con tarjeta entra sola a Finanzas, con categoría, monto, moneda,
comercio y ubicación. Hay dos caminos y están pensados para usarse juntos.

| | Camino A: atajo | Camino C: correo |
|---|---|---|
| Qué captura | Pagos con Apple Pay | Todo lo que el banco avisa por correo |
| Cuándo entra | Al instante | Barrido diario (o "Sincronizar ahora") |
| Cubre tarjeta física | No | Sí |
| Trae ubicación GPS | Sí | No (solo la que traiga el texto) |

Los dos escriben en el mismo lugar y el mismo cobro nunca se guarda dos veces
(ver "Doble conteo" más abajo).

> Nota sobre lo que iOS **no** permite: Shortcuts no tiene un disparador de
> "llegó una notificación". El push de tu banco no se puede leer. Por eso el
> camino A se cuelga de la automatización *Transacción* de Wallet, que solo ve
> Apple Pay, y el camino C existe para cubrir el resto.

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
| `currency` | Texto | `GTQ` |
| `merchant` | Texto | variable *Comercio* de la transacción |
| `date` | Texto | variable *Fecha* con formato `yyyy-MM-dd` |
| `lat` | Número | *Latitud* de Ubicación actual |
| `lon` | Número | *Longitud* de Ubicación actual |

Los nombres exactos de las variables cambian entre versiones de iOS. Si la
automatización no te expone *Comercio* o *Monto* por separado, usa la variable
completa de la transacción en `merchant` y el parser se queda con el nombre: lo
único indispensable es que `amount` sea un número.

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
  -d '{"amount":17,"currency":"GTQ","merchant":"Rally Padel Guatemala","date":"2026-08-03"}'
```

## Paso 3 (camino C): reenvío de correo

### Del lado del servidor (una sola vez)

1. Crea el buzón `gastos@chispu.xyz` en la misma cuenta de Zoho que
   `recordatorios@chispu.xyz`.
2. Genera una contraseña de aplicación (Zoho → Seguridad → App Passwords).
3. En Vercel, define `IMAP_HOST`, `IMAP_USER`, `IMAP_PASS` y
   `NEXT_PUBLIC_INGEST_EMAIL`. Los detalles están en `.env.local.example`.

Sin esas variables el barrido es un no-op silencioso y la pestaña Automático
esconde la opción de correo, así que se puede desplegar antes de crear el buzón.

### Del lado del usuario

1. Activa las alertas por correo de tu tarjeta en la banca en línea del banco.
2. En tu correo, crea una regla que reenvíe esas alertas a la dirección que
   aparece en Configuración → Automático, con esta forma:

   ```
   gastos+<tu token>@chispu.xyz
   ```

   En Gmail: Configuración → Filtros → crear filtro con `De: alertas@tubanco.com`
   → "Reenviar a" (hay que verificar la dirección de reenvío una vez).

El token en la dirección es lo que identifica tu cuenta. El remitente **no** se
usa para eso a propósito: la cabecera `From:` se falsifica sin esfuerzo, y rutear
por ella dejaría que cualquiera escribiera gastos en la cuenta de otro.

### Cadencia

El barrido corre una vez al día. Es límite del plan Hobby de Vercel, que solo
permite crons diarios, no una decisión de diseño. Si no quieres esperar, el botón
**Sincronizar ahora** en Configuración → Automático corre el mismo barrido.

## Doble conteo

El mismo cobro llega por los dos caminos con frecuencia: pagas con Apple Pay
(camino A lo ve al instante) y el banco además te manda el correo (camino C lo ve
en la noche). No se duplica, por dos capas:

1. **Id determinístico.** El mismo evento repetido resuelve siempre al mismo
   documento, así que reintentar el atajo no escribe dos veces.
2. **Barrido de casi-duplicados.** Mismo monto y moneda, con ±1 día de diferencia
   y un comercio que se parece, cuenta como ya capturado. La ventana de ±1 día
   existe porque el cargo puede postearse al día siguiente de la compra. Esto
   también protege contra un gasto que ya habías escrito a mano.

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
| El atajo responde 400 `INVALID_AMOUNT` | `amount` llegó vacío o como texto no numérico |
| Responde `"status": "duplicate"` | Ya estaba registrado, no es error |
| El correo no entra | La regla de reenvío perdió el `+<token>`, o el correo llegó sin monto reconocible |
| Todo cae en Otros Gastos | Aún no hay regla para ese comercio: corrígelo una vez y se aprende |

Las devoluciones y reversos se detectan y **no** se registran como gasto, para no
inflar el mes. Esos siguen entrando por la importación del estado de cuenta.
