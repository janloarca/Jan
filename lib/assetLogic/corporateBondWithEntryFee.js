// ============================================================================
//  ESPECIFICACIÓN CONGELADA: BONO CORPORATIVO CON COMISIÓN DE ENTRADA
//  Caso de referencia: VITALI (institución IDC)
// ============================================================================
//
//  ⛔ NO CAMBIAR NADA DE LO QUE ESTE ARCHIVO DESCRIBE SIN PREGUNTAR PRIMERO.
//
//  Esto aplica a quien haga el cambio: una persona, un asistente de IA, o un
//  refactor automático. Antes de tocar cualquiera de las fórmulas, campos o
//  superficies listadas abajo hay que DETENERSE y preguntar explícitamente a
//  quien pidió el cambio:
//
//     "Este cambio toca la lógica congelada del bono corporativo con comisión
//      de entrada (lib/assetLogic/corporateBondWithEntryFee.js). Esa lógica se
//      estabilizó después de ~15 iteraciones de bugs reales. ¿Confirmás que
//      querés cambiarla, y por qué? ¿Revisaste los comentarios de ese archivo
//      y los invariantes que fija? ¿Sigue siendo viable lo que describe?"
//
//  Y NO proceder hasta tener respuesta. Si el cambio se hace igual, hay que
//  actualizar ESTE archivo y sus tests en el mismo commit: la especificación y
//  el código no pueden divergir.
//
//  El test lib/__tests__/corporateBondWithEntryFee.test.js recalcula el caso
//  completo con las funciones REALES. Si alguien mueve la lógica, ese test se
//  pone rojo con los números exactos del antes y el después. Está puesto a
//  propósito para que el cambio sea imposible de hacer en silencio.
//
// ----------------------------------------------------------------------------
//  ALCANCE: ESTE tipo de activo, no todos
// ----------------------------------------------------------------------------
//
//  Lo de abajo está fijado para ESTA configuración exacta:
//
//     · Instrumento de renta fija a valor nominal (un bono corporativo), sin
//       precio de mercado propio: su valor solo se mueve por eventos que la app
//       tiene registrados.
//     · Comprado con una COMISIÓN DE ENTRADA pagada aparte
//       (`entryFeeMode: 'separate'`).
//     · Que paga CUPÓN EN EFECTIVO a OTRA cuenta (`incomeDestination`), no
//       reinvertido.
//     · Comprado a MITAD DE AÑO, así que la ventana YTD abre antes de que el
//       activo existiera.
//
//  CADA TIPO DE ACTIVO TIENE SU PROPIA LÓGICA. Una acción con precio de
//  mercado, un fondo que reinvierte, una cuenta bancaria, un CDT, un SAFE, una
//  posición sincronizada de un broker: ninguno se comporta igual y ninguno
//  hereda esto automáticamente.
//
//  Esto NO es limitante: sí se puede apalancar. Si aparece otro activo con
//  costo de entrada (bonos, fondos, alternativos, CDs), copiar esta lógica es
//  lo correcto. Lo que no se puede es CAMBIARLA para acomodar al activo nuevo
//  — se extiende, no se reescribe.
//
// ============================================================================

// ----------------------------------------------------------------------------
//  LOS NÚMEROS DEL CASO DE REFERENCIA
// ----------------------------------------------------------------------------
export const VITALI = Object.freeze({
  principal: 6000,        // lo que costó el bono EN SÍ
  entryFee: 98,           // corretaje, pagado aparte del principal
  entryFeeMode: 'separate',
  cashOutOfPocket: 6098,  // principal + comisión = el DEPOSIT de apertura
  couponPaid: 240,        // cupón cobrado en efectivo, a otra cuenta
  acquisitionDate: '2026-01-06',
  couponDate: '2026-05-15',
  destinationOpeningBalance: 0, // el Fondo Líquido se creó vacío
  // Lo que TIENE que salir en pantalla, en TODAS las superficies:
  expectedReturnPct: 3.94, // 240 / 6098
  expectedGain: 240,       // (valorActual - principalCost) + ingresos
  expectedNetWorth: 6240,  // bono 6,000 + efectivo 240
})

// ----------------------------------------------------------------------------
//  LAS TRES CANTIDADES, Y POR QUÉ SON TRES Y NO UNA
// ----------------------------------------------------------------------------
//
//  1. principalCost  = 6,000  → lo que costó el activo EN SÍ, sin comisiones.
//                               Contra esto se mide la GANANCIA ("¿qué hizo el
//                               activo?").  getItemPrincipalCost()
//
//  2. costBasis      = 6,098  → todo el efectivo que salió del bolsillo.
//                               Entre esto se DIVIDE ("¿cuánto tuve que poner
//                               en total?").  getItemCostBasis()
//
//  3. ingresos       =   240  → lo que el activo GENERÓ. Hace falta porque un
//                               activo que paga a otra cuenta nunca mueve su
//                               propio currentPrice: sin esto siempre mostraría
//                               0%.  getDividendIncomeByItem()
//
//  LA FÓRMULA, idéntica en todas las superficies:
//
//        ganancia  = (valorActual − principalCost) + ingresosGenerados
//        retorno % = ganancia / costBasis
//
//  Con VITALI hoy:  (6000 − 6000) + 240 = 240 ;  240 / 6098 = 3.94 %
//
//  ⚠️ EL ERROR QUE YA SE COMETIÓ TRES VECES:
//  usar costBasis en AMBOS lados cobra la comisión dos veces (como pérdida de
//  capital en el numerador Y otra vez inflando el denominador). Da 2.33 %.
//  Si ves 2.33 % en cualquier lado, es este error.
//  El espejo: usar principalCost en ambos lados PERDONA la comisión y da
//  4.00 %. Si ves 4.00 %, es ese.
//  El único par correcto es principalCost arriba, costBasis abajo → 3.94 %.
//
// ----------------------------------------------------------------------------
//  DÓNDE ESTÁ IMPLEMENTADO (todas las superficies deben coincidir al decimal)
// ----------------------------------------------------------------------------
//
//  A) Asignación de Activos  · components/dashboard/AssetAllocation.jsx
//     gain = (val − getItemPrincipalCost) + dividendIncome
//     cost = getInvestedCapital(it, incomeReceived)   ← ver (E)
//     Imprime con toFixed(2). Fila "Bonds" → +3.94 %.
//
//  B) Rendimiento por Institución · components/dashboard/InstitutionPerformance.jsx
//     Misma fórmula, agrupada por institución. Fila "IDC" → +3.94 %.
//     Agrupa VITALI + Fondo Líquido; por eso necesita (E) o el cupón se cuenta
//     dos veces (como ingreso arriba y como capital abajo).
//
//  C) Encabezado YTD  · hooks/useDashboardData.js  (memo returnYTD)
//     Modified Dietz, pero con dos ajustes obligatorios para este caso:
//       · jan1Ts: el ancla del YTD viaja con SU FECHA. El primer punto con
//         valor > 0 es el 6 de enero, no el 1: medir desde el 1 restaría el
//         depósito que CREÓ el valor de arranque (daba −51 %).
//       · ytdCostBase: los depósitos descartados (6,098) son el capital que
//         creó el ancla y pueden ser MAYORES que el valor que compraron. Se
//         usan como DENOMINADOR únicamente. Subir startVal en su lugar mete la
//         comisión en el numerador → 2.33 %.
//       · FASE GE: qué flujos se netean depende de la NATURALEZA del ancla,
//         no solo de su _source. Un doc 'backfill' TRANSACCIONAL (rebobinado a
//         través del ledger real de depósitos/trades; el efecto de backfill lo
//         marca _transactional) refleja el timing de los flujos igual que un
//         NAV real: las compras de mitad de año no existen en su valor de
//         enero, así que los depósitos del broker (_source:'ibkr') DEBEN
//         netearse contra él. La regla vieja (netear solo con fuentes reales)
//         venía del mundo hold-flat puro y, aplicada a un backfill lot-aware,
//         leía cada depósito a IBKR como ganancia (+27% sobre un año menor).
//         Los flujos MANUALES (VITALI) se netean en AMBOS casos, igual que
//         siempre: este cambio no toca ningún número de este archivo.
//       · FASE IA (extensión confirmada por el usuario, 13 ago 2026): una
//         compra hecha DENTRO de la ventana entra al Dietz como su DEPOSIT
//         completo, comisión adentro (6,098). Restar ese flujo del valor final
//         cobra la comisión como pérdida EN EL NUMERADOR: la misma violación
//         que este archivo prohíbe, en el caso "el ancla NO se movió" (compra
//         de enero con ancla del 1-ene; el candado de 3.94% ancla en el día
//         del fondeo y va por la rama ytdCostBase, que no cambia). La prueba
//         empírica: encabezado +$664.96 contra gráfica "Todas" +$762.96, $98.00
//         exactos de diferencia = la comisión de VITALI. El fix:
//         entryFeeAddbacks (utils.js, puro, con tests) devuelve al NUMERADOR
//         las comisiones de compras dentro de la ventana cuyo DEPOSIT sí fue
//         neteado (guard: el depósito vinculado tiene que estar en la lista
//         filtrada que el Dietz recibió; los depósitos descartados por el
//         ancla movida no están, así que en el caso congelado el addback es
//         CERO y la rama ytdCostBase queda byte-idéntica). El DENOMINADOR no
//         se toca: sigue siendo capital all-in ponderado (comisión incluida),
//         igual que costBasis en las tarjetas. Mismo addback, por cuenta, en
//         el desglose "De dónde viene tu YTD" (restado del flow de la fila,
//         nunca de flowBase), para que cada fila diga lo mismo que la gráfica
//         escopada de esa cuenta y todas sigan sumando el encabezado. Con esto
//         las TRES lecturas (tarjetas, gráfica, encabezado+desglose) miden
//         ganancia contra principal y dividen entre all-in: 3.94%, nunca 2.33%
//         (comisión cobrada doble) ni 4.00% (comisión perdonada).
//
//  D) Gráfica de Rendimiento · components/dashboard/PortfolioGrowthChart.jsx
//       · reconstructionIsExact: un portafolio de puros activos estáticos se
//         rebobina EXACTO desde el saldo de hoy. No se dibuja punteado, no se
//         rebasea a los últimos días, no se muestra el aviso de broker.
//       · La serie empieza a medir en el ancla de fondeo (computeAnchoredReturnSeries,
//         analytics.js), no en el primer punto con valor > 0: con UN solo
//         activo, fondeado desde $0, son la misma fecha. Con DOS (XOCHI desde
//         2024 + VITALI fondeado este año) no lo son — el arranque de la
//         ventana ya no es $0, así que "primer valor > 0" deja de servir para
//         encontrar el momento en que entró el dinero nuevo. El ancla real es
//         el primer DEPOSIT/WITHDRAWAL que cae DENTRO de la ventana (mismo
//         dato que usa el encabezado en $, ver E de abajo). Antes de esto, la
//         comisión de VITALI aparecía como una pérdida instantánea en el
//         momento exacto del depósito, que se iba "sanando" según el peso
//         temporal de Dietz — el mismo error de comisión-en-el-numerador que
//         ya documenta este archivo, solo que repartido en toda la serie en
//         vez de en un número (FASE EJ).
//       · FASE EO: la ventana puede tener MÁS de un fondeo nuevo (tres bonos,
//         tres fechas). El arreglo de FASE EJ solo trataba el PRIMERO; el
//         segundo y tercero volvían a mostrar el mismo error, uno por evento.
//         La generalización encadena N tramos (uno por cada punto donde
//         aterriza capital nuevo), multiplicativos: (1+r1)×(1+r2)×...−1, la
//         propiedad que hace que el capital nuevo nunca diluya lo que ya se
//         ganó. Cada tramo que CIERRA justo en el instante en que aterriza el
//         siguiente depósito no puede medir ese instante con Dietz normal
//         (restar solo el EFECTIVO del flujo, como hacía el ancla única,
//         repite el mismo bug: el efectivo del depósito, con comisión, nunca
//         es igual al valor que agrega). En vez de eso, a ese último punto del
//         tramo que cierra se le resta el SALTO DE VALOR real que la gráfica ya
//         reconstruyó (comisión incluida) antes de correr Dietz — así ese
//         capital queda completamente afuera del tramo que cierra, y se
//         convierte en la base limpia del tramo que abre. TWR (encadenar
//         tramos) generaliza el ancla única a N eventos; MWR/Dietz simple no lo
//         hace, porque cada evento nuevo re-pesa TODO el histórico anterior.
//       · FASE FZ: el límite de flujos del tramo que cierra cubre el ÚLTIMO
//         intervalo entre puntos COMPLETO (flowBeforeTs = punto penúltimo + 1),
//         no solo el timestamp exacto de la frontera. El salto que se excluye
//         es el delta entre los dos últimos puntos, así que un flujo fechado
//         DENTRO de ese intervalo (depósito del 1 jun, punto más cercano el
//         2 jun) es el mismo dinero que ese salto: dejarlo dentro del Dietz
//         del tramo lo resta DOS veces (como flujo y como salto). Así fue como
//         ClubCashIn marcó -125.74% de TWR sobre una cuenta ganando (+5.38%
//         MWR, que no segmenta y no lo sufre). Con el flujo fechado exacto en
//         la frontera (este caso VITALI, todos los tests del candado) ambos
//         límites excluyen lo mismo: byte-idéntico.
//       · FASE GE: flowAware (qué transacciones entran a la serie de retorno)
//         acepta también un primer punto _transactional (doc 'backfill'
//         rebobinado por el ledger real, ver C). computeAnchoredReturnSeries y
//         computeAnchoredMWRSeries NO cambian: solo cambia QUÉ lista de
//         transacciones se les pasa cuando la serie arranca en un backfill
//         transaccional (la completa, con flujos de IBKR, en vez de la
//         filtrada). Con series ancladas en NAV/daily/manual (VITALI y todos
//         los fixtures del candado) la decisión es idéntica a antes.
//       · FASE GF: scopedTransactions (la vista escopada a UNA institución)
//         incluye los flujos CASH de IBKR por su _source, no solo cuando
//         sobrevive un holding CASH-*. Sin esto la vista escopada neteaba
//         CERO flujos y Valor/TWR/MWR imprimían el mismo número (el cambio
//         crudo, depósitos como ganancia). Los flujos manuales de este caso
//         (VITALI/IDC) se escopan igual que siempre: por _linkedItemId o
//         símbolo.
//       · FASE IT: en esa MISMA función, un movimiento cuyo _linkedItemId
//         apunta a un activo que EXISTE y no está en el scope ya no cae a la
//         regla del símbolo: el vínculo es autoritativo y dice que pertenece a
//         otra cuenta. Antes se colaba cuando el mismo símbolo vive en dos
//         cuentas, y esa cuenta ajena lo dibujaba como "Entró dinero" y lo
//         restaba como capital nuevo (computeWindowGrowth), así que su gráfica
//         y su fila del desglose por cuenta (que sí respeta el vínculo, ver
//         lib/ytdAttribution.js) divergían por un monto FIJO. Un vínculo
//         MUERTO (activo borrado) sigue cayendo al símbolo: ahí el vínculo no
//         dice nada. Cero cambio para VITALI/IDC, cuyos movimientos apuntan a
//         activos de su propia cuenta.
//       · FASE GS: el overlay de activos manuales sobre un NAV de broker
//         (staticAt, ahora lib/staticOverlay.js) sostiene su valor conocido
//         más VIEJO hacia atrás en el borde izquierdo, igual que ya sostenía
//         el más nuevo hacia adelante en el derecho. Antes devolvía 0 para
//         cualquier fecha anterior al primer punto de la reconstrucción, que
//         no es "no sé" sino la afirmación de que esos activos no existían:
//         un snapshot de broker de esa era se dibujaba como si fuera el
//         portafolio COMPLETO (un portafolio de ~$17K graficado en $4,000, y
//         "+475.00%" medido desde ahí en la vista ALL). Acotado por dos
//         hechos, nunca por una estimación: el valor conocido más viejo tiene
//         que ser > 0 (si es 0, el broker de verdad ERA todo el portafolio y
//         su NAV pelado es la cifra correcta), y nunca se sostiene más atrás
//         que la primera fecha de adquisición de esos activos. Sin fecha de
//         adquisición no sostiene nada. Cero contacto con la fórmula: no toca
//         numerador, denominador, ni el re-base de abajo; solo corrige QUÉ
//         valor tiene un punto de la serie que antes estaba incompleto.
//       · Re-base final por (principalDesplegado / costoDesplegado) para
//         dividir entre el costo total, no solo el fondeo nuevo. Con un solo
//         activo desde $0, esto es exactamente anchorVal/funded de antes: una
//         escala UNIFORME de toda la curva ya encadenada, nunca introduce una
//         bajada nueva (estira o encoge la forma, no la reforma). La escala NO
//         toca el numerador, por la misma razón que (C).
//       · Período ALL: antes nunca anteponía historial reconstruido antes del
//         primer snapshot real de Firestore, sin importar el motivo — correcto
//         para un broker (esa reconstrucción SÍ es un estimado: sin NAV real
//         no hay forma de saber la fecha real de inicio de la cuenta), pero
//         truncaba a los últimos ~30 días a un portafolio 100% estático, cuya
//         reconstrucción es EXACTA. Ahora antepone cuando reconstructionIsExact
//         es true (mismo flag ya usado arriba). El lado del API
//         (portfolio-history/route.js) tenía su propio bug independiente: el
//         punto ancla que agrega para ALL (earliest − 1 día) dejaba `allTs`
//         con tamaño 1, así que la síntesis semanal para activos estáticos
//         (gateada en `allTs.size === 0`) nunca se activaba. Arreglado
//         gateándola en si hay series de MERCADO reales, no en si `allTs` ya
//         tiene algo (FASE EJ).
//
//  E) getIncomeReceivedByItem + getInvestedCapital · components/dashboard/utils.js
//     Un ítem tipo banco guarda su SALDO en purchasePrice (ahí ese ES su costo,
//     por diseño), así que cada cupón que aterriza en el Fondo Líquido subía el
//     denominador. Se resta el ingreso recibido del capital invertido, si no
//     los mismos 240 se cuentan como ingreso arriba y como capital abajo
//     (daba 3.79 % en la tarjeta por institución contra 3.94 % en la de tipo).
//
//  F) Spreadsheet · lib/historicalValues.js + components/dashboard/PortfolioSpreadsheet.jsx
//       · indexBalanceEvents(): UNA sola función decide qué transacción mueve
//         el saldo de qué ítem. La usan las TRES reconstrucciones (spreadsheet,
//         baseline del YTD, gráfica). Cuando cada una tenía su copia, la del
//         spreadsheet sabía de cuentas destino y las otras no, y los números no
//         cuadraban entre pantallas.
//       · applyStaticHistory(trueStatic = true): el valor de un bono mantenido
//         plano entre eventos rastreados es EXACTO. Se marca estimated:false y
//         NO lleva "~". "Estimado" no es lo mismo que "incierto".
//       · El cupón backfilleado acredita el saldo destino solo si ese saldo es
//         0 (creditableBackfills): una cuenta vacía no puede "ya contenerlo".
//       · FASE GU (extensión, aprobada explícitamente por el usuario): un
//         TRANSFER entre dos cuentas del propio usuario mueve los DOS saldos en
//         su fecha, así que indexBalanceEvents empuja el evento a ambos lados
//         (−monto al origen, +monto al destino). Antes no manejaba el tipo en
//         absoluto y el pasado de las dos cuentas quedaba mal: la que recibe se
//         mantenía plana hacia atrás en su saldo ALTO de hoy (como si el dinero
//         siempre hubiera estado ahí) y la que envía en su saldo BAJO (como si
//         nunca lo hubiera tenido). Cada lado se registra por separado (una
//         fila que nombra solo un extremo arregla ese extremo), los dos son
//         iguales y opuestos así que el total del portafolio no se mueve, y una
//         conversión única a moneda base cubre ambos (el monto viene en la
//         moneda de la cuenta que ENVÍA). Las filas escritas antes de que
//         lib/transferTx.js fuera el constructor único no llevan ids y se
//         saltan, igual que antes de que esta rama existiera. Este caso
//         (VITALI/IDC) no tiene ninguna transferencia, así que el candado de
//         3.94% pasa sin tocarse.
//
//  G) Depósito de apertura · components/AddAccountModal.jsx + app/dashboard/page.jsx
//     El DEPOSIT vale principal + comisión (6,098) y lleva
//     _source:'manual_new_account' + _linkedItemId. El wrapper de onAdd DEBE
//     devolver el id del ítem: sin eso el depósito nace huérfano y TODO motor
//     que pregunta "¿qué explica este saldo?" (que indexa por _linkedItemId)
//     lo ignora.
//
//  H) "HOY" · computeDayChange en components/dashboard/utils.js
//     El cupón aparece el día que PAGA (15 de mayo), no el día que se captura.
//     La comisión ya se pagó al comprar; no vuelve a restar aquí.
//
// ----------------------------------------------------------------------------
//  LO QUE ESTA LÓGICA NO HACE (decisión consciente del usuario)
// ----------------------------------------------------------------------------
//  No anualiza ni proyecta. El número es realizado puro y sube conforme entran
//  los pagos: 3.94 % hoy, 7.87 % cuando caiga el cupón de diciembre
//  (480 / 6,098). La comisión se queda en el denominador mientras se mida desde
//  la compra. El 8 % flat de un año 2 aislado (480/6,000, comisión ya hundida)
//  necesitaría un selector de período por tarjeta, que hoy NO existe y no se
//  debe agregar sin preguntar.
// ----------------------------------------------------------------------------

// Invariantes verificables. El test los recalcula con las funciones reales.
export const INVARIANTS = Object.freeze([
  Object.freeze({
    id: 'gain-vs-principal',
    rule: 'La ganancia mide contra el principal (6,000), nunca contra el costo total.',
    expected: 240,
  }),
  Object.freeze({
    id: 'pct-vs-cost-basis',
    rule: 'El porcentaje divide entre el costo total (6,098), nunca entre el principal.',
    expected: 3.935716628402755, // (240 / 6098) * 100
  }),
  Object.freeze({
    id: 'fee-never-on-both-sides',
    rule: 'Comisión en ambos lados = 2.33 %. Comisión en ninguno = 4.00 %. Ambos son bugs.',
    wrongBothSides: 2.3286323384716303,  // (142 / 6098) * 100
    wrongNeitherSide: 4,                 // (240 / 6000) * 100
  }),
  Object.freeze({
    id: 'income-is-not-invested-capital',
    rule: 'El cupón que aterriza en la cuenta destino no cuenta como capital invertido.',
    destinationInvestedCapital: 0,
  }),
])

// Tolerancia de comparación para los tests (los % se muestran con 2 decimales).
export const PCT_TOLERANCE = 1e-9
