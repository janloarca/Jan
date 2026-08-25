'use client'

/**
 * El campo donde se teclea un número con decimales, con la convención en UN
 * solo lugar.
 *
 * ⛔ NUNCA `type="number"` para algo con decimales. Con teclado en español el
 * separador decimal es COMA, y un input numérico devuelve `''` ante lo que no
 * puede parsear, así que el campo SE BORRA TECLA POR TECLA. Es el reporte
 * literal del usuario: "BTC no me dejaba poner 0.0001".
 *
 * `inputMode="decimal"` conserva el teclado numérico del teléfono, así que no se
 * pierde nada al pasar a texto.
 *
 * Por qué existe como componente y no como dos atributos escritos a mano: para
 * cuando se escribió, SEIS archivos ya habían resuelto lo mismo por su cuenta
 * (los tres de FASE KV más `CashFlowModal` y `TransferModal` después), cada uno
 * con su propio comentario, y quedaban ~21 campos sin migrar. Seis copias de la
 * misma decisión es exactamente cómo una se queda atrás: la lección que este
 * repo ya tiene escrita para `InfoTip` y para `lib/transferTx.js`.
 *
 * ⛔ LA OTRA MITAD NO ESTÁ ACÁ, Y SIN ELLA ESTO NO SIRVE. Cambiar el input hace
 * que se pueda TECLEAR una coma; que se LEA bien es responsabilidad del caller,
 * y hay tres lecturas distintas en `lib/numberParse.js`:
 *
 *   DINERO     → `parseAmount`    ('2.500' = dos mil quinientos, convención LatAm)
 *   CANTIDAD   → `parseQuantity`  ('2.500' = dos y medio; y pisa negativos en 0)
 *   TASA / %   → `parseRate`      ('2.500' = 2.5; conserva el signo)
 *
 * Con `parseFloat` el campo deja de borrarse pero '95,78' se archiva como 95,
 * en silencio, que es peor que el bug original: un monto que se borra se nota.
 *
 * `step` / `min` / `max` NO se reenvían aunque alguien los pase: sobre un input
 * de texto no hacen nada, y un atributo inerte sugiere una validación que no
 * ocurre. El piso lo ponen los lectores (`parseQuantity` pisa en cero) y los
 * guards que cada pantalla ya tiene.
 */
export default function AmountInput({ step, min, max, type, ...props }) {
  return <input {...props} type="text" inputMode="decimal" />
}
