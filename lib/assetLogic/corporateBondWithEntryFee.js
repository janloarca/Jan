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
//     NOTA (solo de UBICACIÓN, la fórmula no cambió): este componente ya NO se
//     monta en el dashboard. Sus filas repetían número por número la vista
//     "Inst." de la superficie (A), así que el tablero muestra una sola de las
//     dos. El archivo sigue en disco, intacto, y remontarlo es una línea en
//     app/dashboard/page.jsx. Quien verifique el +3.94 % agrupado por
//     institución hoy lo ve en (A) con la vista "Inst." seleccionada.
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
//       · FASE LU (extensión confirmada por el usuario, 28 ago 2026): el
//         universo del YTD/MTD/desde-inicio son los ACTIVOS. endValue pasa de
//         netWorth a totalAssets, el ancla se lee con snapshotAssetsUSD
//         (lib/assetReturns.js: ver la nota de FASE MG abajo), y la
//         lista de flujos pasa por assetOnlyFlows (los vinculados a una deuda
//         no entran; los que cruzan la frontera entran como el flujo externo
//         que son). La FÓRMULA no cambia: cambia qué portafolio mide, igual
//         que FASE GE cambió qué lista recibe. Sin deudas todo es
//         byte-idéntico (misma identidad de lista, mismo número), que es por
//         lo que el candado de 3.94% pasa sin tocarse.
//       · FASE MG (extensión confirmada por el usuario, 30 ago 2026): cómo
//         decide snapshotAssetsUSD cuál de los tres campos del snapshot es el
//         total de activos. FASE LU lo escribió como "prefiere totalActivosUSD
//         SOLO cuando el doc declara totalDebtUSD, porque en un NAV de broker
//         ese campo no existe y ahí manda netWorthUSD". Esa premisa era FALSA:
//         parseEquitySummary SIEMPRE emite totalDebtUSD (= |totalShort|, 0 en
//         una cuenta normal) e ibkrSnapshotPlan siempre lo archiva, así que la
//         rama de respaldo era código muerto y TODO doc de broker se leía por
//         totalActivosUSD = totalLong + cash, que FASE FX documenta como no
//         confiable. Medido con el parser real: un NAV de $10,000 se leía como
//         $11,000, o sea la gráfica principal salía inflada todos los días.
//         La vara pasa a ser la EVIDENCIA que el propio doc trae, no el nombre
//         de su fuente (una lista de brokers se queda vieja con el siguiente):
//         los docs que escribimos nosotros cumplen `activos - deuda = neto` por
//         construcción y ahí totalActivosUSD manda; los del broker no cumplen
//         esa identidad (sus campos vienen de columnas distintas del Flex) y
//         ahí manda netWorthUSD. Cuando la identidad cierra las dos lecturas
//         dan lo mismo, así que este guard solo puede corregir un caso que
//         estaba mal, nunca cambiar uno que estaba bien. La FÓRMULA no se
//         mueve: cambia de dónde sale el ancla, y el candado de 3.94% pasa sin
//         tocarse (VITALI es manual, no tiene docs de NAV de broker).
//       · FASE MT (extensión confirmada por el usuario, 1 sep 2026): una ventana
//         Dietz arranca donde arranca su VALOR, no donde arranca el calendario.
//         findYearStartAnchor acepta un snapshot dentro de ±15 días del 1 de
//         enero (incluido uno de fines de DICIEMBRE), y startTs se quedaba
//         clavado en Date.UTC(year, 0, 1). La corrección jan1Ts que ya existía
//         SOLO corre en la rama de respaldo (sin ancla), o sea justo en el
//         camino menos frecuente. Las dos puntas fallan y las dos INVENTAN
//         rendimiento: con el ancla DESPUÉS del 1, un depósito del día 5 ya está
//         dentro del valor de arranque y además se netea como flujo, o sea se
//         resta dos veces y el año se lee como que no rindió (medido con el hook
//         real: 0% contra el 4.76% verdadero); con el ancla ANTES (el 28 de
//         diciembre), un depósito del 30 no está en el valor de arranque y
//         tampoco se netea, porque cae fuera de la ventana, o sea se lee como
//         ganancia (10% contra ~5%). El arreglo es una línea: startTs sale de
//         anchorStartTs(bestSnap, yearStartTs), la MISMA definición que FASE MM
//         escribió para el MTD y los retornos por broker (components/dashboard/
//         utils.js), así que las tres ventanas no pueden divergir; sin fecha
//         legible cae al borde del período, que es el comportamiento de siempre.
//         El propio comentario de findYearStartAnchor ya documentaba el
//         mecanismo ("that row already holds January's deposit and gain, so
//         anchoring YTD there would make Modified Dietz subtract January's flows
//         a second time") y se defendía ACOTANDO la ventana a 15 días: el
//         defecto estaba mitigado, no cerrado. La FÓRMULA no se toca (ni el
//         numerador, ni el denominador, ni entryFeeAddbacks, ni ytdCostBase):
//         cambia en qué instante ABRE la ventana. El candado de 3.94% pasa sin
//         tocarse, y no por casualidad: ancla en el día del FONDEO y va por la
//         rama ytdCostBase, que ya movía startTs por su cuenta.
//       · FASE MW (corrección de una REGRESIÓN de MT, misma aprobación): mover
//         la ventana no alcanza por sí solo. computeModifiedDietz cuenta un
//         flujo fechado EXACTO en startTs (`txTs >= startTs`) y estas anclas
//         son snapshots DIARIOS, o sea el del día D ya contiene lo del día D.
//         El YTD ya dropeaba esos flujos, pero SOLO bajo
//         `if (startTs > yearStartTs)`, que describía el único caso posible
//         antes de MT; la rama de DICIEMBRE que MT habilitó quedó sin ese
//         guard, así que un depósito fechado el mismo día de un ancla del 28 de
//         diciembre volvía a restarse de un valor que ya lo contenía (medido
//         con el hook real: 0% sobre un año que ganó 4.76%). Antes de MT ese
//         caso salía bien por casualidad, porque el flujo caía fuera de una
//         ventana que abría el 1 de enero. El drop pasa a ser INCONDICIONAL vía
//         `flowsAfterAnchor` (utils.js), la misma definición que usan el MTD,
//         los retornos por broker y computePeriodicReturns. `ytdCostBase` no
//         cambia de semántica: sigue recibiendo el total dropeado y sigue
//         entrando SOLO al denominador, así que el candado de 3.94% pasa sin
//         tocarse (fijado además como control POSITIVO en el test del hook: un
//         depósito de apertura de 6,098 fechado el día del ancla sobre un bono
//         de 6,000 sigue dando 3.94%, nunca 4.00% ni 2.33%).
//       · FASE NL (extensión confirmada por el usuario, 4 sep 2026): la FÓRMULA
//         no se toca; lo que cambia es que el DOC del que sale el ancla ya no
//         es inmortal. Todo el YTD cuelga de un único documento (el que elige
//         findYearStartAnchor), y una calibración global escrita en el id plano
//         de esa fecha quedaba congelada para siempre: `CalibrateReturnModal`
//         la escribe con `_source:'manual'`, y eso la disfraza de transcripción
//         del usuario ante los TRES reparadores (staleBackfillDates le da el
//         rango más alto y el día nunca cuenta como hueco; divergentDailyDates
//         salta `_calibrated`; y el guard de FASE JW solo impide PISAR un día
//         que ya tiene dato, no repara el que ya se escribió). O sea la promesa
//         que el propio modal imprime ("si después importas el historial real,
//         esos datos reemplazan la calibración automáticamente") se cumplía del
//         lado del ESCRITOR y nunca del lado del archivo.
//         Medido con los números de la captura del usuario (patrimonio
//         10,032.65, flujos 3,945): el ancla despejada del Dietz daba 9,305.22
//         contra los 5,432.98 que el propio broker reporta para diciembre, o
//         sea inflada casi exactamente por los depósitos del año, que es la
//         firma del doble conteo; la tarjeta decía −$3,217.57 sobre un año que
//         iba +$532.65. `contradictedCalibrationDates` (lib/snapshotBackfill.js)
//         la marca para reescritura con TRES restricciones: solo con
//         `c.composed` (o sea cuando la composición se apoyó en el NAV REAL del
//         broker; sin él no pasa nada y la calibración se queda, que es su
//         razón de existir), la misma banda de su hermana (8%, piso de $50), y
//         solo calibraciones GLOBALES (un ancla por cuenta vive en su propio id
//         y compararla contra el portafolio completo sería mezclar universos,
//         la lección de FASE MI). Al reescribir se APAGAN las marcas de
//         calibración: `saveSnapshot` fusiona, así que sin eso el doc quedaría
//         con el valor bueno y la insignia "calibrado" encima.
//         El candado de 3.94% pasa sin tocarse: VITALI no tiene calibraciones.
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
//       · FASE LU (extensión confirmada por el usuario, 28 ago 2026): la
//         card entera mide ACTIVOS. La deuda sale del universo en el tope del
//         componente (items filtrados, transacciones vía assetOnlyFlows, la
//         serie leída con snapshotAssetsUSD), así que la línea, los chips, el
//         % del período y TWR/MWR no pueden verla. computeAnchoredReturnSeries
//         y computeAnchoredMWRSeries NO cambian: cambia qué items/lista/serie
//         reciben, el mismo contrato de FASE GE/GF. Sin deudas, byte-idéntico.
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
//       · FASE IX: el ledger que rebobina la LÍNEA DE EFECTIVO del broker solo
//         puede llevar movimientos de ESA cuenta, y solo los trades cuyas
//         acciones el server también rebobina. Se le pasaba la lista COMPLETA
//         de transacciones del portafolio, así que el depósito de apertura de
//         VITALI (6,098, comisión adentro) se deshacía DOS veces: una en el
//         propio bono (por balanceEventsById, que es lo correcto) y otra en la
//         caja de IBKR. El efectivo del broker en el pasado quedaba ~la suma de
//         todos los depósitos manuales por debajo de lo real y el portafolio
//         reconstruido caía en NEGATIVO: la vista "Todas" arrancaba en -$6.3K
//         (≈ el depósito de VITALI) con un "Max drawdown -45.4%" que nunca
//         ocurrió, porque esos puntos negativos se anteponen ESCALADOS al
//         primer snapshot real. Misma familia por el otro lado: la venta de una
//         posición que hoy ya no existe le restaba sus ingresos al efectivo sin
//         devolver las acciones que los produjeron. CERO contacto con la
//         fórmula: no toca numerador, denominador ni el re-base de abajo, solo
//         corrige QUÉ movimientos entran a la reconstrucción del valor (y el
//         candado de 3.94% pasa SIN tocarse: VITALI es una cuenta manual, cuyo
//         depósito sigue rebobinando su propio saldo exactamente igual que
//         siempre). Mismo arreglo en la copia de (C), buildHistoryItemsPayload.
//       · FASE MZ: ese mismo ledger tiene que saber CUÁL ítem es su caja
//         (`cashAccountId`). FASE MY hizo que un gasto con `_paidFromItemId` no
//         moviera la caja del broker, porque casi siempre lo pagó otra cuenta;
//         pero cuando lo paga la caja DEL PROPIO broker, esa caja sí se movió,
//         y saltarlo lo PIERDE: acá la caja recibe `accountCashFlows` EN VEZ de
//         su entrada de `balanceEventsById` (los ítems 'ibkr' quedan fuera de
//         `perItemCashFlows` por un `return` explícito), así que el evento que
//         FASE MX sí registra del otro lado no lo recoge nadie. El guard pasó
//         de "trae el campo" a "lo pagó OTRA cuenta". CERO contacto con la
//         fórmula: cambia QUÉ movimientos entran a la reconstrucción del valor,
//         igual que FASE IX, y el candado de 3.94% pasa SIN tocarse (VITALI no
//         tiene ninguna fila FEE). El mismo cambio va en la copia de (C).
//
//  E) getIncomeReceivedByItem + getInvestedCapital · components/dashboard/utils.js
//     Un ítem tipo banco guarda su SALDO en purchasePrice (ahí ese ES su costo,
//     por diseño), así que cada cupón que aterriza en el Fondo Líquido subía el
//     denominador. Se resta el ingreso recibido del capital invertido, si no
//     los mismos 240 se cuentan como ingreso arriba y como capital abajo
//     (daba 3.79 % en la tarjeta por institución contra 3.94 % en la de tipo).
//       · FASE KZ3 (extensión, aprobada explícitamente por el usuario el 26 ago
//         2026; era el pendiente escrito en liquidFundYield.js sección 9): el
//         rendimiento PROPIO de una cuenta bank-like que reinvierte (los
//         DIVIDEND `inferred_yield`/`manual_yield`/auto vinculados a ELLA
//         misma) también vive dentro de su saldo, o sea dentro de su costo, y
//         también se resta (getOwnReinvestedYieldByItem, tercer argumento
//         OPCIONAL de getInvestedCapital: un caller que no lo pasa es
//         byte-idéntico). SOLO bank-like: en un bono o un activo de mercado
//         reinvertir sube cantidad o valor y el costo no se mueve, así que
//         restar ahí quitaría capital real. VITALI es un Bond: su capital
//         invertido no cambia y el candado de 3.94% pasa sin tocarse.
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
//       · FASE MG (extensión, aprobada explícitamente por el usuario el 30 ago
//         2026): el PRECIO con el que se reconstruye el pasado tiene que salir
//         de la misma prioridad que usa la columna del mes actual. La
//         reconstrucción tenía su propia cascada (`_originalPrice ??
//         currentPrice ?? ...`) que NO conocía `lastManualValuation`, mientras
//         `getItemPrice` la antepone en un ítem ilíquido. Un inmueble revaluado
//         a mano mostraba el valor VIEJO en todos los meses históricos y el
//         NUEVO solo en la columna de hoy: medido, $200,000 en todo el
//         histórico contra $250,000 en el mes en curso, o sea un salto
//         inventado de $50,000. `EditAccountModal` escribe esa valuación sin
//         tocar `currentPrice` y el enriquecido tampoco la considera, así que
//         `_originalPrice` se queda con el precio anterior. `rawItemPrice()` es
//         ahora la única definición y la usan los DOS sitios que reconstruyen
//         (el bucket estático y la red de seguridad); la condición es
//         EXACTAMENTE la de getItemPrice (`isIlliquid` y valuación > 0), para
//         que no puedan divergir. Bump a SNAPSHOT_VERSION 31: los meses ya
//         cacheados tienen el valor viejo horneado y el caché nunca se
//         autocorrige por merge.
//       · FASE IX6 (extensión, aprobada explícitamente por el usuario el 16 ago
//         2026): el ingreso REINVERTIDO se guardaba en un cajón indexado por
//         SÍMBOLO (`reinvestBySym`), y un símbolo no identifica una cuenta. Dos
//         cuentas con el mismo nombre y sin ticker propio (el caso real: DOS
//         "ClubCashIn") caían en el mismo cajón y cada una rebobinaba el
//         rendimiento de AMBAS. La prueba está en los datos del usuario: la
//         primera cuenta subía ~$5.89 al mes y pasó a ~$13 exactamente el mes en
//         que apareció la segunda, que también sube ~$13; si cada una ganara lo
//         suyo serían ~$6 y ~$7.4, y $13 es justo la suma. Es la MISMA lección
//         de FASE IO (un mapa indexado por símbolo no puede guardar nada que
//         dependa del ACTIVO), acá una capa más abajo. Ahora manda
//         `reinvestById` (por id de cuenta, que toda transacción de rendimiento
//         estampa) y el cajón por símbolo queda como RESPALDO para movimientos
//         sin vínculo, así que un ítem cuyos eventos no traen id se reconstruye
//         byte-idéntico. Cero contacto con la fórmula: no toca numerador,
//         denominador ni el ruteo de un cupón EN EFECTIVO a otra cuenta (que
//         sigue yendo a balanceEventsById[destino]); el candado de 3.94% pasa
//         SIN tocarse. Requiere bump de SNAPSHOT_VERSION: los meses cacheados
//         tienen la mezcla horneada.
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
//       · ⛔ 24 ago 2026 (extensión, aprobada explícitamente por el usuario
//         sobre un bug REAL suyo): ese supuesto de "una conversión única cubre
//         ambos extremos" vale con UNA moneda y es FALSO con dos. Movió Q2,500
//         a su cuenta monetaria en dólares y la app le acreditó $2,500: su
//         saldo pasó de 5,350 a 8,092, que es exactamente 5,350 + 2,500 + 242.
//         Ahora el registro guarda los DOS montos (`totalAmount`/`currency` es
//         lo que SALIÓ; `_toAmount`/`_toCurrency` lo que ENTRÓ) y cada lado se
//         convierte a base por separado. `transferCredit` (lib/transferTx.js)
//         es la ÚNICA lectura del lado del destino, compartida por todos los
//         consumidores para que ninguno se olvide del respaldo.
//         LA TASA LA PONE EL USUARIO, no la app: el banco le mete su propio
//         spread, así que la única fuente de verdad es su estado de cuenta; la
//         app sugiere con su tasa y jamás decide. Se pide CUÁNTO LLEGÓ (no la
//         tasa) porque eso se lee directo del estado sin hacer cuentas.
//         Deja de valer que los dos lados se cancelen a nivel de portafolio, y
//         eso es CORRECTO: un cambio de divisa con spread cuesta dinero real y
//         ese costo tiene que verse. Una fila SIN `_toAmount` (todas las
//         viejas) y una transferencia de misma moneda quedan byte-idénticas.
//       · FASE MX (extensión, aprobada explícitamente por el usuario el 2 sep
//         2026): un gasto sobre un activo pagado DESDE una cuenta registrada
//         (reparar el techo de un inmueble, FASE KW) baja el saldo de esa
//         cuenta el día que se paga, pero la fila se archiva contra el
//         INMUEBLE y esta función no tenía rama para `FEE`: la cuenta que pagó
//         se reconstruía PLANA en su saldo de HOY hacia atrás, o sea el pasado
//         decía que ese dinero nunca estuvo ahí. Mismo defecto que v30 cerró
//         para la hipoteca, y la tercera vez que el id del otro extremo viaja
//         en un campo propio (`_paidFromItemId`) porque el reparto normal de
//         esa fila sería el equivocado.
//         SOLO se registra el lado de la CUENTA QUE PAGÓ, y la asimetría es la
//         decisión de producto de FASE KW y no un olvido: un gasto NO revalúa
//         el activo sobre el que se hizo (reparar el techo no sube el precio
//         de la casa), así que el inmueble no recibe evento y su serie no se
//         mueve un centavo. Una fila FEE sin `_paidFromItemId` (toda comisión
//         de broker, todo costo importado) no produce ningún evento y queda
//         byte-idéntica, así que el radio del cambio es exactamente la
//         población que la feature de FASE KW creó. El monto se toma en
//         MAGNITUD y convertido a base como sus hermanas. Bump a
//         SNAPSHOT_VERSION 32. El candado de 3.94% pasa SIN tocarse: VITALI no
//         tiene ninguna fila FEE.
//
//  G) Depósito de apertura · components/AddAccountModal.jsx + app/dashboard/page.jsx
//     El DEPOSIT vale principal + comisión (6,098) y lleva
//     _source:'manual_new_account' + _linkedItemId. El wrapper de onAdd DEBE
//     devolver el id del ítem: sin eso el depósito nace huérfano y TODO motor
//     que pregunta "¿qué explica este saldo?" (que indexa por _linkedItemId)
//     lo ignora.
//
//     ⛔ EXTENSIÓN (23 ago 2026, aprobada explícitamente por el usuario).
//     Su FECHA sigue a la fecha de adquisición del ítem: corregirla en
//     EditAccountModal re-fecha el depósito vía `openingDepositDateFix`
//     (lib/originDeposits.js), y SOLO cuando hay exactamente uno.
//     Por qué: AddAccountModal lo fecha al CREAR, y editar después la fecha
//     actualizaba solo el ítem, mientras el rebobinado del Spreadsheet
//     (applyStaticHistory) reconstruye el pasado restando todo evento
//     posterior al mes, o sea usa la fecha del DEPÓSITO. Con el depósito en
//     agosto y la fecha corregida a enero, cada mes anterior quedaba en 0.00
//     y ninguna corrección de fecha lo arreglaba jamás.
//     El MONTO y el VÍNCULO no se tocan: lo que viaja en la corrección es
//     `{ id, date }` y nada más, fijado por test.
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

// ----------------------------------------------------------------------------
//  EXTENSIÓN (FASE JJ, OK explícito del usuario el 25 ago 2026): QUÉ SIGNIFICA
//  CORREGIR UN NÚMERO EN LA HOJA
// ----------------------------------------------------------------------------
//
//  El usuario lo planteó así: "cuando uno cambia el spreadsheet el cambio no es
//  por pérdida, solo mal número, y no se tiene que tomar en cuenta en pérdida o
//  ganancia". La Hoja ya decidía por él, distinto según el tipo y en silencio:
//  una cuenta de banco escribía valor Y costo (toda corrección = dato malo) y
//  un bono solo el valor (toda corrección = ganancia o pérdida). Solo quien
//  teclea sabe cuál es, así que ahora se pregunta (lib/spreadsheetEdit.js).
//
//  NINGUNA FÓRMULA DE ARRIBA CAMBIA. Lo único que cambia es qué campos escribe
//  una edición, que son entradas que estas fórmulas ya leían.
//
//  ⛔ El invariante de la rama "el número anterior estaba mal": la ganancia de
//     la cuenta NO se mueve. Por eso el costo se DESPLAZA por la diferencia en
//     vez de sobreescribirse con el valor nuevo. Sobreescribir solo conserva la
//     ganancia cuando costo y valor ya coincidían; sobre este mismo bono
//     (comprado a 6,000, hoy 6,200) corregir el 6,200 a 6,100 con
//     sobreescritura borraría los 200 de apreciación REAL. Desplazando quedan
//     cp=6,100 y pp=5,900, o sea los 200 sobreviven.
//
//  `entryFee` y `entryFeeMode` NUNCA se tocan en una corrección: la comisión
//  pagada es un hecho del pasado y no cambia porque el valor estuviera mal
//  tecleado. El % SÍ se mueve, y eso es correcto: si de verdad invertiste
//  5,900 y no 6,000, tu retorno sobre ese capital es otro.
//
//  El caso de referencia de este archivo no pasa por ahí (VITALI se carga con
//  su valor correcto), así que los números fijados abajo no se mueven.

// Tolerancia de comparación para los tests (los % se muestran con 2 decimales).
export const PCT_TOLERANCE = 1e-9
