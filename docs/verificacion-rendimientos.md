# Verificación de rendimientos, activo por activo

Revisión por tandas de 5, contrastando lo que muestra la app contra un cálculo
independiente hecho por el usuario. El objetivo NO es que los números coincidan
al decimal: es separar tres cosas distintas que se ven iguales en pantalla.

1. **Diferencia de CONVENCIÓN** (las dos respuestas son correctas, contestan
   preguntas distintas). Ej.: anualizar o no; contar la comisión de entrada en
   el denominador; qué cuenta como "el portafolio".
2. **Diferencia de DATOS** (una de las dos fuentes tiene un hecho que la otra
   no). Ej.: un cupón que la app no tiene registrado, o un ítem extra dentro de
   la institución.
3. **BUG** (misma pregunta, mismos datos, número distinto).

Solo el tercero se arregla en código. Los otros dos se documentan, y si la
convención de la app es la menos útil, se cambia a propósito y con su spec.

## Convenciones de la app (para leer la tabla)

- **No anualiza**, salvo el `≈ %/yr` que la pestaña ALL muestra al lado. Los
  porcentajes de cada período son ACUMULADOS del período.
- **TWR** encadena sub-períodos por evento de fondeo (elimina el timing de los
  aportes). **MWR** corre una sola ventana Dietz donde los flujos netean con su
  peso temporal (el timing cuenta). Ver FASE FP y `lib/assetLogic/`.
- Un cupón pagado a otra cuenta **del mismo usuario** no es retorno de la
  cuenta que lo recibe ni pérdida de la que lo paga (FASE GR7): se netea entre
  cuentas. Si la cuenta destino está DENTRO de la misma institución, el dinero
  nunca sale del alcance medido.
- La comisión de entrada va en el DENOMINADOR y solo ahí (caso VITALI: 3.94%,
  ⛔ congelado en `lib/assetLogic/corporateBondWithEntryFee.js`).

---

## Tanda 1: IDC (bonos corporativos)

Corte: 10 ago 2026. Cálculo del usuario: 3 bonos (XOCHI 15,000 GTQ,
Credicorp 10,000 GTQ, VITALI 6,000 USD + 98 de corretaje), FX constante
7.63, cupones tratados como DISTRIBUIDOS (salen del portafolio).

### Contraste

| Período | Métrica | App (acumulado) | Usuario (acumulado)¹ | Δ |
|---|---|---|---|---|
| ALL | TWR | +11.53% | +12.61% | app −1.08 pp |
| ALL | MWR | +12.47% | +12.12% | app +0.35 pp |
| YTD | TWR | +5.28% | +4.04% | app +1.24 pp |
| YTD | MWR | +4.31% | +3.10% | app +1.21 pp |
| Hoy / 1W / MTD / 1M | ambas | (por verificar) | 0.0000% | - |

¹ Convertido de anualizado a acumulado para poder comparar con la app, que no
anualiza: `(1+r_anual)^años − 1`, con 2.0698 años (ALL) y 0.6051 (YTD). El
TWR acumulado del usuario también se verifica multiplicando sus siete factores
de cupón: 1.024 × 1.016 × 1.024 × 1.016 × 1.008477 × 1.025872 × 1.005651 =
1.126144, o sea +12.6144%. Coincide con su 5.9075% anualizado.

### Hallazgo 1: la separación TWR-MWR coincide casi exacto

- YTD app: 5.28 − 4.31 = **0.97 pp**
- YTD usuario: 4.04 − 3.10 = **0.94 pp**

Que la BRECHA coincida a 0.03 pp mientras el NIVEL difiere ~1.2 pp es
informativo: el motor que separa TWR de MWR (el timing de los aportes) está
haciendo lo correcto. Lo que difiere es el punto de partida o el conjunto
medido, no la fórmula de retorno.

### Hallazgo 2: la curva TWR de ALL arranca plana en 0% hasta ~mediados de 2025

En la captura, el eje de ALL empieza en jul 24 (correcto: XOCHI se compró el
15 jul 2024), pero la línea se queda en 0% hasta ~jul 2025 y recién ahí da su
primer escalón. El primer cupón del usuario es **15 feb 2025 (+2.40%)** y el
segundo **15 jun 2025 (+1.60%)**: ambos deberían verse como escalones antes
de esa fecha.

Dos explicaciones posibles, y son distinguibles:
- **(datos)** esos cupones de 2025 no están registrados como transacciones en
  la app, o
- **(bug)** están registrados pero la serie no los toma antes del primer punto
  de valor real.

Discriminador: abrir XOCHI y Credicorp en la app y ver si los pagos de feb/jun
2025 aparecen en su lista de movimientos.

### Respuestas del usuario (11 ago 2026)

1. El texto cubre **solo 3 de las 5 posiciones** de IDC. Las otras dos se
   revisan después; primero se cierra esta lógica.
2. Los cupones de XOCHI y Credicorp de 2025 **sí están registrados**.
3. **FX: la app usa la tasa del día**; el 7.63 constante era solo ejemplo del
   cálculo manual.

La respuesta 1 cambia el estatus de todo el bloque de "nivel": el cálculo mide
3 bonos y la app mide 5 posiciones, así que NO son el mismo conjunto y las
diferencias de nivel no son comparables todavía. La respuesta 3 agrega un
segundo término que el cálculo manual no tiene: en base USD, el movimiento del
quetzal ES parte del retorno.

### Lecturas capturadas de la app (IDC, 11 ago 2026 8:09)

| Período | TWR app | MWR app | Usuario (acumulado) | ¿Coincide? |
|---|---|---|---|---|
| 1W | +0.00% | +0.00% | 0.0000% | **sí, exacto** |
| MTD | +0.00% | +0.00% | 0.0000% | **sí, exacto** |
| 3M | +3.61% | (falta) | +3.1669% | no: app +0.44 pp |
| YTD | +5.28% | +4.31% | TWR +4.04% / MWR +3.10% | no: app +1.2 pp |
| ALL | +11.53% | +12.47% | TWR +12.61% / MWR +12.12% | no |
| DAY | (falta) | (falta) | 0.0000% | - |
| 1M | (falta) | (falta) | 0.0000% | - |
| 1Y | (falta) | (falta) | TWR +8.24% / MWR +6.24% | - |

Valor (IDC): $9,408.18 el 26 feb 2026; hoy ~$9.8K; "+$502.17 (+5.32%) este año".

### Hallazgo 3: los períodos SIN eventos coinciden exacto

1W y MTD dan 0.00% en las dos metodologías y en las dos fuentes. Eso no es
trivial: valida que la app no inventa retorno donde no pasó nada (ni por ruido
de reconstrucción, ni por FX, ni por un flujo mal fechado). Toda la diferencia
vive en los períodos CON eventos.

### Hallazgo 4: el 3M descompuesto en sus dos escalones

La ventana 10 may - 10 ago contiene exactamente dos cupones, y la curva de la
app muestra exactamente dos escalones (fechas consistentes con 15 may y 15
jun): la ESTRUCTURA es correcta. Lo que difiere es el tamaño del segundo.

- Esperado por el usuario: 15 may = +2.5872%, 15 jun = +0.5651% -> +3.1669%
- App: primer escalón ~+2.4/2.55%, segundo ~+1.0/1.18% -> +3.61%

El primer escalón cuadra. El segundo es ~2x el esperado. Dos candidatos, y son
distinguibles:

- **(conjunto)** una de las 2 posiciones no cubiertas por el cálculo pagó algo
  en junio. Sería un ingreso real que el cálculo manual no tiene.
- **(FX)** el cálculo congela el quetzal en 7.63; la app mide en USD con la
  tasa de cada día, así que un movimiento del ~0.4% del GTQ en la ventana
  aparece como retorno real en la app y como cero en el cálculo. El factor
  extra observado (1.0361 / 1.031669 = 1.0043) es exactamente de ese orden.

Discriminador: mirar el Valor de IDC al 10 may y al 10 ago. Si la diferencia
excede la suma de los dos cupones, sobra FX (o un ingreso no contemplado).

### Falta capturar

- DAY, 1M y 1Y (TWR y MWR), y el 3M en MWR.
- Las 2 posiciones de IDC no cubiertas por el cálculo: nombre, monto y si
  pagan cupón (y en qué fechas).

### Estado

- [ ] Tanda 1 (IDC) — estructura validada (períodos sin eventos exactos, número
      y fecha de escalones correctos). Pendiente cerrar el NIVEL, que necesita
      el conjunto completo de 5 posiciones para ser comparable.
