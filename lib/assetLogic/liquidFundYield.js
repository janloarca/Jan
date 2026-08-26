/**
 * ⛔ LÓGICA DE REFERENCIA: rendimiento propio de una cuenta líquida
 * ================================================================
 *
 * Caso de referencia: IDC, FONDO LÍQUIDO Q y FONDO LÍQUIDO $. Dos cuentas que
 * (a) reciben los cupones EN EFECTIVO de tres bonos, y (b) además rinden lo
 * suyo a una tasa variable (4%-5%) que el usuario no conoce mes a mes.
 *
 * Este archivo NO exporta código. Es la especificación: qué se decidió, por qué,
 * y qué NO se vale cambiar sin volver a pensarlo. El código vive en
 * `lib/liquidYield.js` y sus tests en `lib/__tests__/liquidYield.test.js`.
 *
 * El protocolo de cambio es el mismo que el de `corporateBondWithEntryFee.js`:
 * antes de tocar una fórmula o una superficie que este archivo liste, DETENERSE
 * y preguntar. Si igual se cambia, la spec y los tests se actualizan en el MISMO
 * commit.
 *
 *
 * 1. LA PREGUNTA, Y POR QUÉ SE CONTESTA AL REVÉS DE LO OBVIO
 * ---------------------------------------------------------
 * Lo obvio sería pedirle la tasa al usuario y devengar hacia adelante. No
 * funciona: la tasa es variable y no la sabe con precisión. Lo que SÍ sabe, y
 * lee de su estado de cuenta, es el SALDO.
 *
 * Así que el saldo es el dato duro y la tasa es lo que se deduce:
 *
 *     interés propio = saldo tecleado - aportes que ya conocíamos
 *
 * "Aportes conocidos" son los movimientos que la app ya tiene archivados hasta
 * la fecha del saldo: depósito de apertura, cupones ruteados a esta cuenta,
 * transferencias, menos retiros. Lo que sobra no lo puso nadie: lo generó la
 * cuenta.
 *
 * De regalo, la tasa realizada sale como subproducto y el usuario puede
 * mirarla y decir "sí, ese es mi fondo" o "no, acá falta un depósito".
 *
 *
 * 2. `balanceAsOf`: la fecha que le faltaba a la foto
 * --------------------------------------------------
 * El valor guardado de una cuenta que no cotiza es una FOTO de un momento. Esa
 * convención ya existía (un cupón backfilleado no acredita el destino porque se
 * asume que la foto ya lo contiene, FASE DI), pero la foto no tenía FECHA: la
 * app aproximaba con "¿el pago es del mes en curso o de un mes ya cerrado?".
 *
 * Esa aproximación falla en los dos bordes:
 *   - un cupón que aterrizó hace tres días, mismo mes, se acredita otra vez
 *     encima de un saldo que ya lo contenía;
 *   - un saldo tecleado hace dos meses no recibe ninguno de los cupones
 *     posteriores, porque solo el mes en curso acredita.
 *
 * `balanceAsOf` (fecha ISO, por ítem) contesta exacto: DESDE CUÁNDO ES CIERTO
 * EL SALDO GUARDADO. Se sella en cada guardado de un activo que no cotiza, o
 * sea hoy: el usuario está mirando el campo y apretando Guardar, y eso es
 * afirmar que ese número vale hoy.
 *
 * La regla que gobierna todo lo demás:
 *
 *     HASTA `balanceAsOf` MANDA EL SALDO. DESPUÉS MANDA LA TASA.
 *
 * Retrocompatible: un ítem sin el campo se comporta EXACTAMENTE como antes.
 *
 *
 * 3. LOS INVARIANTES (romper uno es un bug, no una decisión de diseño)
 * -------------------------------------------------------------------
 *
 * (I1) El saldo tecleado es la verdad de hoy y NADA lo empuja. El interés
 *      deducido jamás modifica el saldo: se dedujo de él, así que sumárselo
 *      sería sumarle un número sacado de él mismo.
 *
 * (I2) El interés es el RESIDUO, nunca una segunda afirmación. Si además se
 *      escribiera interés a partir de una tasa tecleada, habría dos
 *      afirmaciones sobre el mismo dinero: la familia de bug de FASE HU.
 *
 * (I3) Nunca se infiere un residuo negativo como "interés negativo". Un fondo
 *      líquido no pierde dinero: si el saldo es menor que lo aportado, falta
 *      registrar un retiro. Eso se REPORTA, no se inventa.
 *
 * (I4) El reparto en el tiempo es por saldo-tiempo, partiendo la línea en CADA
 *      fecha de aporte. El dinero que llegó en junio rinde menos que el que
 *      está desde 2024: eso es literalmente "devenga desde que entra".
 *
 * (I5) La identidad cierra POR CONSTRUCCIÓN, no por suerte:
 *
 *          Σ aportes + Σ interés repartido == saldo tecleado   (al centavo)
 *
 *      La tasa se resuelve justamente para que cierre, y el redondeo a centavos
 *      se cuadra contra el último mes.
 *
 * (I6) El orden de carga no cambia el resultado. Cargar los bonos primero y el
 *      fondo después da lo mismo que al revés: el motor solo mira los aportes
 *      que existen HOY y el saldo de HOY.
 *
 * (I7) El dato real siempre gana, y lo inferido es DERIVADO: ante cualquier
 *      cambio del saldo, su fecha o los aportes, se recalcula entero. Nunca se
 *      parcha.
 *
 * (I8) Nada se escribe sin que el usuario lo vea y lo apruebe (mismo trato que
 *      los flujos inferidos de FASE DQ).
 *
 *
 * 4. POR QUÉ NO HIZO FALTA TOCAR NINGUNA FUNCIÓN CONGELADA
 * -------------------------------------------------------
 * Una cuenta que recibe cupones y además rinde sobre su propio saldo es
 * EXACTAMENTE la forma de ClubCashIn, que ya funciona y ya tiene tests: un ítem
 * estático con depósito propio Y rendimiento reinvertido en sí mismo (FASE FD).
 * Los dos motores de reconstrucción ya la manejan:
 *
 *   - `applyStaticHistory` (lib/historicalValues.js, Spreadsheet)
 *   - `staticItemValueAtTs` (lib/portfolioRewind.js, gráfica y API)
 *
 * Y el enrutado a UN solo bucket ya está resuelto en `indexBalanceEvents`: un
 * DIVIDEND con `_reinvested` va a `reinvestBySym` y NUNCA a `balanceEventsById`,
 * así que no puede contarse dos veces.
 *
 * Por eso el interés deducido se escribe como el MISMO evento que todo lo demás
 * ya entiende (un DIVIDEND reinvertido del propio ítem, `_source:'inferred_yield'`)
 * en vez de estrenar un concepto nuevo. Ningún motor aprende nada. Es la lección
 * que este repo pagó caro varias veces: dos motores que reconstruyen el pasado y
 * solo uno sabe de X.
 *
 *
 * 5. LAS SUPERFICIES (todo lugar que participa)
 * --------------------------------------------
 *  1. `lib/liquidYield.js`            el motor puro: aportes, tasa, reparto
 *  2. `lib/ventureMetrics.js` (xirr)  quien resuelve la tasa. Su convención de
 *                                     año (365.25) es la que el reparto TIENE
 *                                     que usar; con 365 la identidad (I5) deja
 *                                     de cerrar por ~10 centavos en dos años
 *  3. `AddAccountModal` / `EditAccountModal`   sellan `balanceAsOf`
 *  4. `processDividends` (useDashboardData)    el piso del backfill y la
 *                                     decisión de acreditar (ver 6)
 *  5. `liquidYieldCandidates` + `acceptLiquidYield` / `dismissLiquidYield`
 *  6. `LiquidYieldModal`              la revisión
 *  7. `ChispuSuggestions`             el hallazgo que lleva ahí
 *
 *
 * 6. LOS DOS CAMBIOS EN EL MOTOR AUTOMÁTICO, Y QUÉ BUG ARREGLA CADA UNO
 * --------------------------------------------------------------------
 *
 * (a) PISO DEL BACKFILL para ingreso REINVERTIDO. Un ingreso que se reinvierte
 *     en la propia cuenta ya está adentro del saldo tecleado, así que
 *     backfillear esos meses le suma cantidad ENCIMA (la rama de reinvest hace
 *     `updateItem` con `quantity + newShares`). Una cuenta creada hoy con
 *     calendario explícito se inflaba hasta 24 meses de interés sobre un número
 *     que ya lo incluía. Bug real y preexistente.
 *
 *     Solo aplica a reinvest: un bono que paga a OTRA cuenta no crece por su
 *     cuenta, y su backfill de cupones (el que trajo los pagos de 2025 de
 *     XOCHI) tiene que seguir corriendo.
 *
 * (b) ACREDITAR AL DESTINO se decide contra el `balanceAsOf` del DESTINO, no
 *     contra "¿es el mes en curso?". Es el requisito 2 del usuario hecho exacto:
 *     un cupón anterior o igual a la foto ya está tomado en cuenta en el total
 *     del fondo líquido; uno posterior es dinero que llega después. Sin el campo
 *     (cuentas de antes) se conserva la regla vieja tal cual.
 *
 *
 * 7. CUÁNDO REHÚSA (la parte que evita inventar dinero)
 * ----------------------------------------------------
 *   residuo <= 0.5% de lo aportado ....... redondeo del estado de cuenta: nada
 *   residuo negativo ..................... hallazgo ("¿falta un retiro?"), nunca
 *                                          un interés negativo
 *   tasa > 25% anual, o > 3x la declarada  se marca y NO se aplica sola: la
 *                                          explicación probable es un depósito
 *                                          sin registrar, no un fondo generoso
 *   sin aportes conocidos ................ no hay contra qué medir: no infiere
 *   el IRR no converge ................... no devuelve un número inventado
 *
 *
 * 8. QUÉ NO HACE (decisiones conscientes, no huecos)
 * -------------------------------------------------
 *  - NO modela la variabilidad mes a mes de la tasa. El saldo real ya la
 *    contiene: lo que se reparte es el resultado, no un sorteo de tasas.
 *  - NO anualiza el interés mostrado ni proyecta hacia el futuro más allá de lo
 *    que el motor automático ya hace con la tasa configurada.
 *  - NO adivina una fecha de saldo. Si el usuario nunca guardó la cuenta desde
 *    que existe el campo, no hay foto fechada y no se infiere nada.
 *  - NO toca `getItemPrincipalCost`, `getItemCostBasis`, `getDividendIncomeByItem`,
 *    `computeAnchoredReturnSeries`, `computeAnchoredMWRSeries`,
 *    `indexBalanceEvents` ni `applyStaticHistory`.
 *
 *
 * 9. PENDIENTE CONOCIDO (toca zona congelada: preguntar antes)
 * -----------------------------------------------------------
 * `getInvestedCapital` (utils.js, FASE DY) calcula "lo que el usuario PUSO" como
 * costo menos el ingreso que llegó DE OTRO ítem, y `getIncomeReceivedByItem`
 * salta a propósito todo lo `_reinvested`. Para un activo de mercado eso es
 * correcto (reinvertir sube la cantidad y la ganancia se ve en el valor), pero
 * para una cuenta estática el saldo ES su costo, así que el rendimiento propio
 * infla el denominador: con el ejemplo de arriba, "invertido" leería 636.73
 * (2,236.73 - 1,600 de cupones) cuando el usuario puso 500, y el retorno del
 * fondo sale subestimado.
 *
 * Es la misma regla de FASE DY aplicada a un caso que entonces no existía. NO se
 * cambió porque el denominador del retorno es superficie congelada
 * (`corporateBondWithEntryFee.js`): se arregla preguntando primero.
 */

/**
 * EXTENSIÓN (FASE JJ, OK explícito del usuario el 25 ago 2026): el rendimiento
 * que el usuario DECLARA al corregir el saldo en la Hoja.
 *
 * Antes, corregir el saldo de una cuenta líquida desde la Hoja escribía valor y
 * costo, así que un rendimiento real desaparecía sin dejar rastro. Ahora la
 * Hoja pregunta, y si la respuesta es "son intereses que ganó" escribe un
 * DIVIDEND con `_source:'manual_yield'`, EXACTAMENTE la misma forma que produce
 * `acceptLiquidYield`, para que todo consumidor ya existente lo trate igual.
 *
 * Dos reglas que hacen que los dos motores no se pisen:
 *
 *  1. El costo SIGUE al saldo en esa rama. `acceptLiquidYield` escribe el
 *     ingreso sin tocar el costo, así que dejar el costo quieto acá haría que
 *     la diferencia se contara DOS veces: como ganancia no realizada y como
 *     ingreso.
 *  2. `knownContributions` cuenta un `manual_yield` como ya explicado. Sin eso
 *     el residuo lo volvería a incluir y el motor propondría registrar los
 *     mismos intereses que se acaban de registrar. Es lo contrario de
 *     `inferred_yield`, que se excluye a propósito porque una corrida nueva
 *     REEMPLAZA a la anterior (supersededYieldTxIds).
 *
 * La identidad del módulo (Σ aportes + Σ interés == saldo tecleado) se conserva
 * por construcción: lo declarado entra del lado de los aportes conocidos.
 *
 * ── FASE JJ2: la tercera respuesta, "entró o salió dinero" ──────────────────
 *
 * Un saldo que cambió solo puede deberse a tres cosas, y las tres pesan
 * distinto sobre el retorno: un FLUJO (capital tuyo moviéndose, que hay que
 * netear), un RENDIMIENTO (ganancia o pérdida real) o una CORRECCIÓN (ni una ni
 * otra). Con solo dos respuestas, un retiro de una cuenta líquida se registraba
 * como PÉRDIDA y un depósito como INTERESES: las dos deforman el retorno en la
 * dirección más visible que hay.
 *
 * El movimiento lo construye `buildContributionFields` (lib/contributions.js),
 * el MISMO motor que usan Movimiento y el editor de cuenta, no una segunda
 * copia. Para una cuenta líquida eso DESPLAZA los dos campos, así que la
 * ganancia no se mueve, que es lo correcto: sacar dinero no es perder.
 *
 * El origen es `manual_balance_flow` y NO `manual_edit_adjustment`, que es lo
 * que escribe EditAccountModal ante la misma diferencia de saldo. Aquel está
 * EXCLUIDO de "invertido" porque ahí la app no preguntó y asume que una
 * corrección de saldo suele ser rendimiento acumulado; acá el usuario dijo
 * explícitamente que metió o sacó dinero, así que tiene que contar como
 * capital. `knownContributions` lo cuenta como aporte por su rama de
 * DEPOSIT/WITHDRAWAL vinculado, sin cambios.
 */

export {}
