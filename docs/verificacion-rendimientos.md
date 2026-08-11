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

### Preguntas abiertas (bloquean el cierre de esta tanda)

1. **IDC muestra "5 pos." pero el cálculo tiene 3 bonos.** ¿Cuáles son las
   otras dos? (Sospecha: el Fondo Líquido que recibe los cupones de VITALI, y
   quizá otro.) Si la cuenta que recibe los cupones vive DENTRO de IDC, el
   dinero nunca sale del alcance medido, mientras que el cálculo del usuario
   asume que sale: eso mueve el nivel, no la brecha.
2. **FX.** El cálculo usa 7.63 constante; la app convierte con la tasa vigente
   de cada momento. Con dos tercios del portafolio en GTQ, un movimiento del
   1.5% del quetzal explica por sí solo un desvío de ~1 pp.
3. **¿Los cupones de XOCHI y Credicorp están registrados en la app?** (ver
   Hallazgo 2).

### Estado

- [ ] Tanda 1 (IDC) — en verificación, esperando respuestas a las 3 preguntas.
