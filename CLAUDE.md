# Jan — Portfolio Tracker

## Pendientes

- [ ] (usuario) Verificar en el dashboard de Vercel que los deploys corren bien — el límite de 100/día del free tier bloqueó PR #62 en junio 2026; si vuelve a pasar, considerar Pro o menos deploys.
- [ ] (usuario) Activar el recordatorio de finanzas: crear buzón `recordatorios@chispu.xyz` (Zoho Mail gratis: dominio + MX/SPF/DKIM + app password) y setear `SMTP_HOST/SMTP_USER/SMTP_PASS` + `CRON_SECRET` en Vercel. Pasos completos en `.env.local.example`.
- [x] Intro interactiva para usuarios nuevos: hecha (Fase Q). `OnboardingTour` ofrece "Explorar con datos de ejemplo" → seed de `lib/demoData.js` vía bulkImport → walkthrough con spotlight sobre las cards reales (`data-card-id` / `data-tour`) → "Borrar demo y agregar lo mío". Mientras existan items `_source:'demo'`: banner de salida en el dashboard y VETO a saveSnapshot/saveItemSnapshots/processDividends (cero side-effects persistentes). Limpieza selectiva con `deleteDemoData()`.

## Lecciones — Módulo Amigos / social (FASE X)

- **Todo lo cross-user va por Admin SDK, nunca cliente Firestore.** `firestore.rules`
  es default-deny salvo `users/{uid}/**`. Las colecciones sociales (`friendProfiles`,
  `friendGroups`) son top-level → inalcanzables desde el navegador. Se acceden SOLO por
  `app/api/friends/route.js` (Admin SDK + `verifyAuth`), patrón exacto de `shareTokens`.
  No se tocan las rules. Sin este modelo, cualquier usuario leería el portafolio de otro.
- **Privacidad: solo % y símbolos, JAMÁS montos.** `lib/friendsStats.js` (puro) publica
  `{ ytd, day, movers[] }` donde movers = `{symbol, name, changePct, impactPct}` con
  `impactPct = weight × change1d` (ratio, no monto). El server re-valida y re-clampa
  todo lo que envía el cliente (untrusted): `sanitizeStatBlock` recorta movers, clampa
  a [-200,200] y descarta cualquier campo. El ranking global es aún más estricto: solo
  seudónimo + ytd (sin uid, sin movers, sin símbolos).
- **El número ya está calculado.** `useDashboardData` expone `returnYTD` (Modified Dietz,
  currency-independent) y `dailyChange` — el cliente los publica vía `sync`; no se
  recomputa en el server (self-reported, suficiente entre amigos). Verificado por broker
  = Fase 2.
- **Grupos con `array-contains`.** `list` = `where('memberUids','array-contains',uid)`;
  join usa `runTransaction` para respetar el cap de miembros atómicamente. Owner que sale
  transfiere la propiedad al miembro más antiguo (o borra el grupo si queda vacío).
- **Nav gated por preferencia.** `settings.friendsEnabled` (default true; ausente = true).
  `Header`/`MobileNav` reciben prop `friendsEnabled`; apagarlo en Settings oculta la
  pestaña Y llama `/api/friends {action:'disable'}` (borra el perfil público + saca de
  todos los grupos). No hay precedente de nav gated por pref — se pasa la bool como prop.

## Lecciones — Módulo Finanzas (FASE R/S/T)

### Moneda del módulo (GTQ)
- Finanzas está denominado en GTQ: TODA transacción se normaliza con `convert(amount, from, 'GTQ')` antes de sumar/comparar, SIEMPRE con fallback `isFinite` (moneda sin rate no puede producir NaN en cards)
- Los exports etiquetan la moneda CONVERTIDA (`Currency=GTQ` + columnas `OriginalAmount/OriginalCurrency`) — nunca el monto convertido junto a la moneda original
- Umbrales de negocio (ej. gastos hormiga < Q75) se aplican DESPUÉS de convertir

### Matching de estados de cuenta (`lib/statementMatcher.js`)
- Buckets: `exact` (se omite) / `likely` (default NO importar, el usuario confirma) / `new` (pre-marcado)
- Matching en centavos (`Math.round(amount*100)`) + descripción normalizada (lowercase, sin acentos, token overlap) — el formato de moneda y las tildes nunca deben romper un match
- Dedup DENTRO del archivo además de contra lo ya registrado (los bancos repiten filas entre páginas)
- Import BI: preseleccionar la cuenta existente para el update de saldo + opción `'skip'` — un default "crear nueva cuenta" duplica items en cada re-import mensual

### Motor mensual (`lib/financeMonth.js`)
- Motor puro (sin React/Firestore); fechas por prefijo de string `'YYYY-MM'` (nunca `new Date('YYYY-MM-DD')` que corre el mes en UTC-6)
- Deltas MoM/YoY son `null` cuando no hay data comparable — nunca 0 ni Infinity; la UI oculta el delta con `!= null`
- El ingreso de inversión (read-only, de DIVIDEND `!_reinvested` del portafolio) entra vía `extras` en CADA mes comparado (actual/prev/yoy) para que cards e insights cuenten la misma historia de ahorro
- 'Inversiones' está bloqueada en captura manual (`MANUAL_INCOME_BLOCKED`) pero permitida al categorizar imports (un depósito de dividendo externo en el banco es válido)

### Recordatorio por correo (cron)
- SMTP genérico con nodemailer contra un buzón del PROPIO dominio — sin servicios de envío de terceros (decisión del usuario); el código no se casa con ningún host
- Gating silencioso por env vars (`SMTP_HOST/USER/PASS`; sin ellas → no-op) — patrón kvConfigured
- Dedup mensual con `_lastFinanceReminder: 'YYYY-MM'` en preferences; solo se marca DESPUÉS de un envío exitoso
- El cron usa fechas UTC y queries de Firestore por rango de string `'YYYY-MM-01'..'YYYY-MM-31'` (funciona para todos los meses por comparación lexicográfica)

## Rendimiento de activos con costo de entrada (caso de referencia: VITALI)

Caso real que fija la convención para CUALQUIER activo con comisión de entrada
(bonos, fondos, alternativos, CDs). Si aparece otro, copiar esta lógica.

**Los datos de VITALI:** bono de USD 6,000 comprado el 2026-01-06, comisión de
entrada USD 95.78 pagada aparte (total desembolsado 6,095.78), cupón 8% anual
pagado semestral (240 en mayo + 240 en diciembre), los pagos salen en efectivo
a otra cuenta (`incomeDestination` = Fondo Líquido), no se reinvierten.

**Las tres funciones, en `components/dashboard/utils.js`:**
- `getItemPrincipalCost(item)`: lo que costó el activo EN SÍ, sin comisiones.
  Es contra esto que se mide la ganancia ("qué hizo el activo").
- `getItemCostBasis(item)`: todo el efectivo que salió del bolsillo. Es entre
  esto que se divide ("cuánto tuve que poner en total").
- `getDividendIncomeByItem(...)`: los pagos que el activo GENERÓ. Necesario
  porque un activo que paga en efectivo a otra cuenta nunca mueve su propio
  `currentPrice`: sin esto siempre mostraría 0% por más que haya rendido.

**La fórmula, idéntica en AssetAllocation y en InstitutionPerformance:**

    ganancia = (valorActual - principalCost) + ingresosGenerados
    retorno% = ganancia / costBasis

Con VITALI hoy: `(6000 - 6000) + 240 = 240`; `240 / 6,095.78 = 3.94%`.

**Los tres errores que ya se cometieron aquí (no repetirlos):**
1. Usar `getItemCostBasis` en AMBOS lados de la fracción cobra la comisión dos
   veces: como pérdida de capital en el numerador Y otra vez inflando el
   denominador. Daba 2.37% en vez de 3.94% (FASE DD).
2. Dividir entre el valor total del portafolio en vez del costo del propio
   grupo. Eso mide "aporte a la ganancia total", una pregunta distinta, y hace
   que el mismo activo muestre dos números sin relación según la tarjeta que
   mires (FASE DB).
3. Contar el capital nuevo como si fuera retorno. Un depósito NO es ganancia:
   si entra en el numerador, financiar una cuenta se ve como +100% (FASE DB).

**Qué NO hace la fórmula (decisión consciente del usuario):** no anualiza ni
proyecta. El número es realizado puro y sube solo conforme entran los pagos:
3.94% hoy, 7.87% cuando caiga el cupón de diciembre (480/6,095.78). La comisión
se queda en el denominador mientras se mida desde la compra, así que estas
tarjetas siempre muestran "sobre el total desembolsado". El 8% flat de un año
2 aislado (480/6,000, comisión ya hundida) necesitaría un selector de periodo
por tarjeta, que hoy no existe.

**`entryFeeMode`** decide de qué lado del valor de compra cae la comisión:
- `'separate'` (default, y lo normal en corretaje): se pagó encima.
  `costBasis = principal + fee`, `principalCost = principal`.
- `'deducted'`: salió del monto que mandaste, así que al activo entró menos.
  `costBasis = principal`, `principalCost = principal - fee`.
En ambos `costBasis - principalCost === fee`, y ESE es el invariante que hace
que la fórmula de arriba funcione igual para los dos modos. Cualquier lugar que
sume la comisión por su cuenta (el DEPOSIT inicial de `AddAccountModal`, la
línea de capital invertido del chart) tiene que saltarse el modo `'deducted'`
o la cuenta doble.

**Movimientos huérfanos:** `EditAccountModal` y `PortfolioGrowthChart` tienen
que emparejar movimientos con el MISMO criterio (`_linkedItemId` o, si no hay,
el símbolo). Cuando divergieron, una transacción sin vínculo inflaba el capital
invertido en la gráfica pero era invisible en la lista, así que un duplicado no
se podía ni encontrar ni borrar (FASE DC).

## "HOY" y el cambio diario: eventos del día, nunca diff de snapshots

`computeDayChange` (en `components/dashboard/utils.js`, usado por `dailyChange`
de `useDashboardData`) mide SOLO lo que pasó hoy:

    hoy = Σ(valor × change1d) + ingresos con fecha de HOY (DIVIDEND/INTEREST)

**Por qué no un diff contra el snapshot de ayer.** Ese diff no distingue un
movimiento de mercado de una posición que apenas capturaste: meter el bono que
tienes desde enero hace que el patrimonio de hoy suba por su saldo completo
mientras el snapshot de ayer no sabe que existe. Netear depósitos por fecha
tampoco lo salva, porque un backfill está FECHADO en enero, no hoy. Así fue como
la tarjeta llegó a decir "+$6,119.62 hoy (+60.94%)" un día en que el mercado se
movió unos $58 (FASE DG).

**Reglas que se derivan:**
- El capital nuevo nunca aparece: no hay término de flujos porque no hay diff.
- Un cupón semestral aparece los DOS días que paga (15 mayo, 15 diciembre), no
  el día que se registra. La comisión de entrada ya se pagó al comprar; no
  vuelve a restar aquí.
- `null` (línea oculta) cuando no hay nada priceado ni ingreso hoy. Un "+0.00%"
  seguro sería un dato inventado.
- Ventaja lateral: "HOY" y "Mayores movimientos hoy" ahora salen de la misma
  fuente, así que la tarjeta ya no se contradice a sí misma.
- `computeScopedReturns` (el día por broker que se publica a Amigos) usa la MISMA
  función. Si aparece otro cálculo de "cambio diario", tiene que llamarla también.

## Ingresos automáticos: dedup por MES, y la cuenta destino debe VER lo que recibe

`lib/autoDividends.js` (puro, con tests) decide qué paga el motor de
`processDividends`. Dos reglas que costaron un bug de saldo permanente (FASE DH):

- **"¿Ya se pagó?" se compara por MES (`YYYY-MM`), nunca por fecha exacta.** El
  calendario paga en `incomePayDay` (día 1), pero un cupón que el usuario captura
  a mano trae el día real (el 15). Con comparación exacta el motor no veía pago y
  escribía el suyo: DOS transacciones y, peor, DOS `addToDestination`. El saldo de
  la cuenta destino sube el doble y SE QUEDA ahí, y todos los meses pasados que se
  reconstruyen desde ese saldo heredan el número malo (Fondo Líquido en 480 desde
  julio en vez de 240).
- **Al limpiar duplicados gana el registro REAL.** `redundantAutoDividendIds`
  borra el `_source:'auto'` cuando el mes ya tiene un pago no-auto, nunca al revés,
  y cada borrado revierte su crédito en el destino (`queueReversal`).
- **Un pago BACKFILLEADO no toca el saldo del destino.** El saldo que el usuario
  escribió es una foto de HOY, así que todo cupón de un mes ya cerrado ya está
  adentro. Sumarlo otra vez deja la cuenta permanentemente arriba: un cupón de
  240 en mayo dejó el Fondo Líquido en 480 en agosto con UNA sola transacción en
  la lista (por eso no parecía duplicado). La transacción sí se escribe (la
  historia es real); solo el saldo se deja quieto, y lleva
  `_destinationCredited:false` para que una limpieza posterior no "revierta" un
  crédito que nunca ocurrió. Solo el pago del mes EN CURSO acredita.

**La cuenta destino tiene que poder ver el dinero que le llega.** Un cupón se
archiva contra el activo que lo generó (`_linkedItemId` = VITALI), así que el
`EditAccountModal` del Fondo Líquido no listaba NADA: el saldo crecía sin
explicación y un pago duplicado no se podía ni ver ni borrar. `linkedTransactions`
ahora suma también lo entrante (`_destinationItemId`, o dividendo cuyo origen
tiene `incomeDestination` = esta cuenta), marcado `_incomingFrom`: se ve y se
borra, pero no se edita ni se re-vincula (el movimiento vive en el origen).

## Paleta de clases de activo (`lib/colors.js`)

Seis clases invertidas con color (`stocks/bonds/funds/crypto/realestate/
alternatives`); efectivo, por cobrar y "otros" son neutros a propósito. Elegida
en OKLCH y VERIFICADA con `scripts/validate_palette.js` del skill `dataviz`, no
a ojo: banda de luminosidad para tema claro y oscuro, piso de croma, y el par
más cercano en visión normal a ΔE 18 (la paleta vieja tenía pares bajo 8: tres
morados casi idénticos en stocks/funds/alternatives). El par más apretado en
daltonismo queda en ΔE 6, por eso TODO lugar donde salen estos colores imprime
también el nombre de la clase: la identidad nunca la carga el color solo.
**Seis es el techo:** un séptimo tono tumba a otro bajo el piso legible, así que
lo que sobre se agrupa en un "Otros" neutro.

## Copy / texto visible — reglas del usuario

- **PROHIBIDO el guión largo (—) en cualquier string visible de la UI** (decisión del usuario,
  FASE AH). Usar `:`, coma o punto. En comentarios de código sí se permite. Al escribir copy
  nuevo, revisar antes de commitear: `grep -rn "—"` sobre los strings tocados.
- Sin em dashes tampoco en los prompts copiables (ej. el prompt de IA del FileImportModal).

## React/JSX — reglas duras (bugs encontrados 2+ veces)

- **NUNCA `return null` antes de un hook.** Todos los gates de render van DESPUÉS del último hook del componente. Si el gate está entre hooks y los datos llegan async (items/snapshots cargando), el conteo de hooks cambia entre renders y React tumba el árbol entero ("Rendered more hooks than during the previous render"). Crashes reales: TopMovers, SnapshotComparison.
- **Un solo prop `style` por elemento JSX.** Con dos, el último gana EN SILENCIO (sin warning en build) — así se volvieron invisibles las barras de progreso de AccountReviewModal y FileImportModal. Merge siempre en un objeto.
- Filtrar con `isFinite()` antes de `Math.min/max(...values)` para SVG (regla vieja, reconfirmada en AssetDetailModal: un FX rate faltante o un close null rompe todo el path).

## Lecciones Aprendidas — Integración IBKR (para futuras integraciones)

### Arquitectura de datos enriched
- Los items pasan por `useDashboardData` que convierte precios a `baseCurrency`
- `currentPrice` / `purchasePrice` en items enriched ya están en baseCurrency
- `_originalPrice` / `_originalPurchasePrice` / `_originalCurrency` guardan valores raw
- **Regla:** Componentes de UI usan valores convertidos. APIs reciben valores originales + campo `currency` para que computen correctamente

### Errores comunes de moneda (evitar en futuras integraciones)
- **No mezclar monedas en cálculos:** Si `value` está en baseCurrency, `cost` también debe estarlo. Nunca usar `_originalPurchasePrice` para cost basis cuando el value viene de `getItemValue()` (que retorna baseCurrency)
- **No enviar precios ya convertidos a APIs:** Los APIs de precios históricos asumen USD. Enviar `_originalPrice` + `_originalCurrency`, y convertir la respuesta del API al baseCurrency del usuario
- **Currency picker:** Cuando el usuario cambia moneda temporalmente, TODOS los valores mostrados deben convertirse, no solo el total. Usar helper `cv()` pattern

### IBKR CSV Parser
- El parser soporta tanto API (flex query) como archivos CSV exportados
- `formatIBKRFileResult()` debe preservar campos de identificación: `conid`, `_ibkrAccountId`
- El campo `accounts` debe extraerse de las positions reales, no hardcodear `[]`
- Multi-account: Los usuarios de IBKR pueden tener múltiples cuentas en un solo archivo CSV

### Firestore / bulkImport
- `bulkImport` debe validar `uid` antes de escribir (throw, no silent return)
- Firestore rechaza valores `undefined` — usar `strip()` helper para limpiar objetos antes de write
- Usar `writeBatch` con chunks de 30 para operaciones masivas
- Los items importados deben persistir después de refresh — verificar que el write realmente se ejecuta
- **No usar `persistentLocalCache`** — causa datos stale en iOS Safari porque IndexedDB no se sincroniza cuando el tab va a background. Usar `getFirestore()` default (in-memory cache) para siempre fetch fresco del servidor

### Portfolio History API (NAV chart)
- Para calcular valores históricos correctos, enviar `lots` individuales con `acquisitionDate`, `quantity`, y `closedDate`
- El API debe computar `qtyAtTime`: sumar lots donde `acquiredTs <= ts AND (!closedTs OR ts < closedTs)`
- Enviar TODOS los lots (open + closed), no solo open — los closed son necesarios para reconstruir posiciones vendidas
- Sin lots, el API usa cantidad total actual para todas las fechas (infla valores históricos)
- Para período ALL con snapshots de IBKR: no prepend datos del API antes del primer snapshot
- `jan1Value` (usado para YTD return) DEBE incluir lots en el request, igual que el chart

### Lots / FIFO — Modelo de datos
- Open lot: `status: 'open'`, `quantity` = shares actuales, `acquisitionDate`
- Closed lot (venta parcial): `status: 'closed'`, `quantity` = shares vendidas, `closedDate`, `realizedGain`
- Closed lot (venta total): `status: 'closed'`, `quantity` = shares vendidas (NO 0), `closedDate`, `realizedGain`
- **Regla:** `closeLotsFIFO` debe guardar `quantity: closable` (no 0) al cerrar completamente un lot — el qty representa cuántas shares se vendieron, y es necesario para reconstruir cantidades históricas
- `closeLotsFIFO` filtra `status === 'open' && quantity > 0` para encontrar lots a cerrar, así que lots closed con qty > 0 no interfieren
- Para cálculos históricos: `qtyAtMonth = sum(lot.qty) where acquired <= date AND (open OR closedDate > date)`

### Sistema de valores históricos (3 fuentes, en orden de prioridad)

#### 1. IBKR Equity Snapshots (más confiable)
- Importados desde Flex Query / CSV como `equityHistory`
- Guardados en `users/{uid}/snapshots/{date}` con `_source: 'ibkr'`
- Contienen el valor REAL del portfolio en cada fecha (directamente de IBKR)
- El chart (`PortfolioGrowthChart`) los usa como fuente primaria cuando existen
- YTD return usa el snapshot más cercano a Jan 1 (ventana de 15 días)

#### 2. API Portfolio History (fallback)
- `/api/prices/portfolio-history` — calcula `current_items × historical_prices`
- Requiere lots para cantidades correctas; sin lots usa qty actual (INCORRECTO)
- Se usa cuando no hay snapshots, o para periodos cortos (1W, DAY)
- Para YTD: `jan1Value` se calcula con este API como fallback si no hay snapshot de enero

#### 3. Item Snapshots (spreadsheet)
- `users/{uid}/itemSnapshots/{monthKey}` — valor por item por mes
- Calculados con `lib/historicalValues.js` usando Yahoo Finance + lots
- `qtyAtMonth()` reconstruye cantidad por mes usando lots (open + closed)
- Cacheados en Firestore para no re-calcular
- Solo se usan en el Spreadsheet, no en el chart principal

### Flujo de retornos YTD / ALL
1. Buscar snapshot de IBKR cerca de Jan 1 → `startVal`
2. Si no hay → usar `jan1Value` del API (con lots)
3. Calcular Modified Dietz: `(endValue - startValue - netDeposits) / startValue`
4. Transactions de tipo DEPOSIT/WITHDRAWAL se restan del retorno (no son ganancia)

### Spreadsheet: cobertura por ítem, y "estimado" ≠ "incierto" (FASE DS)
- **Un ítem agregado después que el resto del portafolio se quedaba sin historial para
  siempre.** `PortfolioSpreadsheet.jsx` decidía qué meses re-computar con una barra de
  70%: si la mayoría de los ítems ya tenían dato en un mes, ese mes se daba por
  "cubierto" y nunca se volvía a pedir, aunque UN ítem específico (ej. VITALI, agregado
  meses después que el resto) siguiera sin entrada ahí. Ese ítem quedaba en blanco en
  esos meses de forma permanente: el 70% ya lo había "pasado". Arreglado: un mes se
  marca para re-fetch si CUALQUIER ítem elegible (ya existía para esa fecha, según
  `effAcqTs`) le falta dato, nunca según un porcentaje del portafolio completo.
- **`estimated` mezclaba dos preguntas distintas.** `applyStaticHistory`
  (`lib/historicalValues.js`) marcaba TODO lo que reconstruye como "mantener plano"
  con `estimated:true`, sin importar la razón. Pero hay dos razones muy distintas: (a)
  un activo de verdad estático (un bono, un saldo bancario) mantenido plano entre
  eventos rastreados es su valor REAL, no una suposición, porque solo se mueve por
  transacciones que ya conocemos exactas; (b) una acción/cripto que cayó a este mismo
  camino porque Yahoo no tenía precio SÍ es una suposición (asumimos que la cantidad no
  cambió). Confundir (a) con (b) hacía que un bono de exactamente 6,000 se mostrara como
  "~6,000" en el spreadsheet, con el tooltip de "valor estimado" sobre un número que no
  tenía nada de incierto. Arreglado con un parámetro `trueStatic` en
  `applyStaticHistory`: `true` solo en la llamada directa para ítems no-mercado
  (`staticItems`), `false` (default, sin cambio de comportamiento) en las tres llamadas
  de fallback dentro del loop de `marketItems`.
- **El total de una categoría no debe confundir "no hay dato" con "el dato suma cero".**
  La fila de categoría en el spreadsheet decidía mostrar "-" con `catHistTotal !== 0`,
  así que una categoría cuyo total reconstruido de verdad fuera 0 (ej. todo vendido)
  mostraba el mismo guión que un mes sin ningún dato real. Se cambió a un booleano
  `foundAny` que se marca cuando al menos un ítem real contribuyó, independiente del
  signo o magnitud de la suma.
- Bump a `SNAPSHOT_VERSION` (20): el caché de `itemSnapshots` en Firestore es
  merge-on-save y nunca se autocorrige (`saveItemSnapshots` pisa valores nuevos SOBRE
  los viejos, nunca invalida uno malo por su cuenta) — un doc cacheado bajo la lógica
  vieja (`estimated:true` en un bono exacto, o un mes que nunca se re-fetcheó) se queda
  ahí para siempre sin el bump forzando el recálculo completo.

### El "journey" de conectar un broker, y leer más que las barras de la captura (FASE DT)
- **Un solo componente visual para las dos secuencias de pasos que ya existían.**
  `lib/brokerHowTo.js` (instrucciones "cómo consigo esto") y `lib/brokerCompletion.js`
  (checklist "llevar esto al 100%") son conceptualmente lo mismo: una secuencia
  ordenada de pasos hacia "totalmente conectado". Antes se veían como dos UIs sin
  relación: una `<ol>` plana (`BrokerSteps`) y una lista de tarjetas con check
  (`BrokerCompletionModal`, código propio). Unificadas en `components/ui/StepJourney.jsx`:
  timeline vertical con círculos conectados por una línea (verde donde ya se completó),
  el paso actual resaltado con fondo/borde propio ("estás aquí"), acción inline por
  paso. `BrokerSteps` ahora es un wrapper delgado sobre `StepJourney` (mismo API, cero
  cambios en los callers de ConnectionsModal/FileImportModal); `BrokerCompletionModal`
  mapea su estado `done`/`skippable` a `status: 'done'|'skippable'|'active'|'todo'`
  (`active` = el primer paso ni hecho ni saltable). Aplica a CUALQUIER broker: los
  pasos son datos (`brokerHowTo.js`/`brokerCompletion.js`), el componente no conoce IBKR.
- **La captura de Portfolio Analyst trae más que las barras.** El reporte de IBKR
  (`FullSizeRender.jpeg` de referencia) trae, arriba de la gráfica, "Net Asset Value"
  (Beginning/Ending/Change), "Return" (Best/Worst con fecha, y Period) y
  "Deposits & Withdrawals" (Net); y sobre algunas barras, marcadores "D"/"W" señalando
  en qué trimestre entró o salió dinero. `app/api/import/parse-chart-image/route.js`
  ahora pide ese resumen también (`summary: {...} | null`, solo si la imagen
  realmente lo trae) y por barra `deposit`/`withdrawal` (true solo si esa barra
  específica tiene el marcador visible). `QuarterlyHistoryModal` muestra el resumen
  como panel de cross-check (nunca se guarda, es solo para comparar) y un badge
  D/W junto a cada trimestre marcado.
- **Un marcador D/W es evidencia real, no una adivinanza estadística.** Se persiste
  como `_flowMarker` en el snapshot trimestral guardado. `lib/inferredFlows.js`
  (`quarterlyOnlyPoints`) lo pasa como `marker`, y `detectGapFlow` lo trata distinto
  de su detección normal: con marcador, SIEMPRE genera un candidato (salta el techo de
  "esto es plausible", que solo aplica cuando estamos adivinando puramente del salto de
  valor) y el TIPO lo decide el marcador, no el signo del delta, porque un depósito
  compensado por pérdidas de mercado en el mismo trimestre puede bajar el NAV aunque sí
  entró dinero. Cada candidato lleva `source: 'photo'|'estimate'` para que
  `InferredFlowsModal` distinga "tu captura marca esto" (badge azul) de "posible,
  estimado" (framing genérico) — mismo flujo de revisión/edición para ambos, la
  diferencia es solo de dónde salió la evidencia.

### Reconstrucción transaccional: rebobinar, no aplanar (FASE AO)
- La reconstrucción CORRECTA del pasado rebobina las transacciones importadas desde el estado
  actual: `qty_t = qty_actual − compras_post_t + ventas_post_t` y `cash_t = cash_actual −
  depósitos_post_t + retiros_post_t + costo_compras_post_t − procedido_ventas_post_t −
  dividendos_post_t`. Motor puro en `lib/portfolioRewind.js` (buildTxEvents/buildCashFlows/
  qtyAtTs/cashAtTs); `/api/prices/portfolio-history` acepta `txEvents` por item y `cashFlows`
  en el item de cash, con prioridad sobre hold-flat/lots, y responde `transactional: true`.
- Con serie transaccional los flujos SÍ se netean en TODO el rango del TWR/Dietz (la serie los
  contiene), el rebase de AM no aplica y el banner de historial corto se apaga. El hold-flat de
  AD queda como fallback cuando no hay transacciones.
- El sync por API ahora también importa dividendos (`kind:'dividend'` en parseCashTransactions →
  transacciones DIVIDEND). Tercera aparición del bug "regex solo self-closing" (`/>` en
  CashTransaction): TODA regex de tags Flex debe ser `\b[^>]*>`.

### Fecha de adquisición NO confiable (import IBKR) — hold-flat (FASE AD)
- Una posición importada de IBKR trae `acquisitionDate` = fecha del SYNC, no de la compra real.
  Sin historia previa, el reconstructor ponía en CERO todo antes de ~junio → `jan1Value` = valor
  de junio → YTD medía "desde junio" (~1% en vez de ~10%) y el chart YTD arrancaba en $0 → "+0.00%".
- **Regla:** `shouldHoldFlat(item, transactions, lots)` (en `utils.js`) marca `_holdFlat` para
  items `_source:'ibkr'` SIN historial real (sin BUY/SELL para el símbolo, sin multi-lot ni lot
  closed). `/api/prices/portfolio-history` mantiene la cantidad ACTUAL plana hacia atrás
  (`Σ qty × precio histórico`) en vez de gatear por `acquisitionDate`. Espeja `dateUnreliable`
  de `lib/historicalValues.js` — ambos deben coincidir en qué posiciones son de fecha no confiable.
- Es un ESTIMADO (asume cantidad constante — riesgo de inflar historia temprana). Arregla YTD/MTD
  y periodos acotados; **ALL sigue limitado** porque el chart no antepone el API antes del primer
  snapshot en ALL (línea `period !== 'ALL'`). Para ALL real: ensanchar el Flex Query o valor de inicio manual.

### El Flex Query tope 365 días: el otro camino al historial (FASE DL, corregida en DR)
- **El límite es de IBKR, no nuestro, y es por CUENTA, no por archivo.** Un Flex Query
  nunca entrega más de ~365 días atrás desde hoy, sin importar el rango que pidas, así
  que una cuenta de 2023 llega con historia desde hace un año y una gráfica donde el
  dinero aparece de la nada. Las instrucciones (`lib/brokerHowTo.js`) ahora lo dicen
  explícito en vez de dejar que el usuario lo descubra.
- **FASE DR, corrección:** esta sección tenía un "Camino 1" que ya no existe: "descarga
  un Flex Query por año calendario (Custom Date Range) y sube uno por uno para llegar
  más atrás de 365 días". Sonaba razonable (un archivo, un rango; otro archivo, otro
  rango) pero es falso: el tope es de la CUENTA, no del archivo, así que ningún rango
  de fecha, sin importar qué tan viejo, trae de vuelta datos de hace más de ~365 días.
  El usuario lo confirmó de primera mano (`BrokerCompletionModal` seguía mostrando el
  paso como pendiente y accionable). Se sacó por completo de `IBKR_STEPS`
  (`lib/brokerCompletion.js`, ahora 3 pasos: conectar → transcribir → copiar retornos),
  de `brokerHowTo.js` (steps + notes de csv y api) y de `ConnectionsModal` ("Completar
  historial (3 pasos)"). El único camino real más allá de esos ~365 días es transcribir
  por trimestre.
- **Transcribir por trimestre.** Portfolio Analyst SÍ muestra toda la historia,
  pero solo como gráfica (no hay export detrás): "Holdings" + "Since Inception" +
  "Quarterly" sin benchmarks. `QuarterlyHistoryModal` recibe esos ~4 números por año y
  escribe un snapshot por trimestre con `_source:'ibkr_quarterly'`. Esa fuente es
  observación real del broker (gana sobre reconstrucciones) pero más gruesa que un NAV
  diario sincronizado (pierde contra `ibkr`): prioridad 3 de 5. Va en `BROKER_NAV_SOURCES`
  para que `augmentSnapshots` le sume los activos manuales de esa fecha; si no, la curva
  sería solo la rebanada del broker. El trimestre EN CURSO se fecha HOY, no en su cierre
  futuro.
- **Apalancarse en los % del broker.** `CalibrateReturnModal` toma los seis
  períodos que toda app de broker muestra (1W, 1M, 3M, YTD, 1Y, desde el inicio) y
  resuelve cada uno a un valor de arranque (`solveDietzStartValue`). YTD y ALL los
  consume el memo de retornos; los otros cuatro se convierten UNA vez en anclas de
  portafolio (`chartSnapshots` en `useDashboardData`, vía `combineAccountCalibrations`) y
  se le pasan a la gráfica. **Ojo: ytd/all se excluyen de esa conversión a propósito** —
  el memo de retornos ya los aplica y aplicarlos dos veces cuenta la corrección doble.
  Un ancla nunca pisa una observación real de esa fecha.

### El checklist post-conexión (FASE DN, corregido en DR)
- Conectar ya no es el final del flujo: `lib/brokerCompletion.js` define, por broker,
  los pasos para llegar al 100% de historial. Solo IBKR tiene los tres reales
  (conectar → transcribir trimestres → copiar retornos; el paso "subir años
  anteriores" que hubo entre conectar y transcribir se quitó en FASE DR, no existía
  de verdad); el resto cae al fallback genérico (un solo paso: el que tenga en
  `brokerHowTo.js`, api primero). Ningún paso es obligatorio, es un nudge con
  checkmarks, no un gate.
- `done`/`skippable` son funciones puras sobre un objeto de estado
  (`ibkrConnected`, `ibkrSnapshotSpanDays`, `hasQuarterlyHistory`,
  `hasIbkrCalibration`, `earliestNeededDays`), no leen Firestore directo: así el
  modal y cualquier badge futuro (ej. un contador en el pill del header) están
  garantizados a coincidir.
- **Se abre solo, una vez, en la conexión real.** `IBKRSyncModal` se usa tanto para
  conectar por primera vez como para re-sincronizar; el dashboard captura
  `ibkrConnected` en un ref al ABRIR el modal y compara al CERRARLO
  (`ibkrWasConnectedRef`). Sin esa comparación, cada sync rutinario reabriría el
  checklist encima del usuario. También queda alcanzable después, sin depender de
  ese momento: un link en `ConnectionsModal` ("Completar historial") y un botón en
  "Completar información" (`EnrichModal`) abren el mismo modal.

### Un ancla de calibración es del PORTAFOLIO, nunca de una sola institución (FASE DO)
- `chartSnapshots` (useDashboardData) combina la cuenta calibrada CON el valor
  actual de todo lo demás (`combineAccountCalibrations`) para producir un punto de
  portafolio completo. Pasarlo tal cual como `snapshots` de `PortfolioGrowthChart`
  rompe la vista "por institución": un ancla de 1M para IBKR llevaba adentro el
  valor de VITALI (otra institución, IDC), y la gráfica filtrada a "Interactive
  Brokers" mostraba un salto de $16K de la nada, con drawdown fantasma incluido.
- **Regla:** cualquier punto `_calibrated:true` se descarta cuando `selectedInst
  !== 'ALL'`. Un NAV real (`ibkr`/`ibkr_quarterly`) no necesita este filtro: por
  construcción YA es el valor de esa sola cuenta, sin mezcla.
- De paso, el filtro de "punto aislado corrupto" del chart (dip en V) vivía
  duplicado inline en vez de llamar `filterValueSpikes` de `analytics.js`, que sí
  cubre el caso espejo (subida en Λ). Dos copias de la misma regla es como este
  tipo de bug se cuela: una se actualiza, la otra no.

### Preguntas que solo se hacen una vez: `_newMoneyConfirmed` (FASE DP)
- El finding `no-history`/`partial-history` de `lib/dataCompleteness.js` pregunta
  "¿de dónde vino este dinero?" leyendo `flows` (derivado en vivo de las
  transacciones). Es un cálculo LIVE, no cacheado, así que si el DEPOSIT inicial
  se edita, se borra en una limpieza de duplicados, o nunca llegó a escribirse
  del todo, la pregunta vuelve a aparecer, aunque el usuario YA la respondió al
  crear la cuenta ("es dinero nuevo" en `AddAccountModal`).
- **Regla:** responder la pregunta la deja contestada para siempre, vía un flag
  en el ITEM (`_newMoneyConfirmed`), no vía la transacción. Se estampa en dos
  puntos: `AddAccountModal` (cuando `isNewMoney && !isDebt`, al crear la cuenta)
  y `CashFlowModal` (cuando "Capturar historia" se usa con "ya está incluido en
  el saldo" marcado). El finding lo respeta y no vuelve a evaluar `flows` para
  ese item, salvo `stale-value`: es una pregunta distinta (¿sigue valiendo lo
  mismo?) y sigue sonando aunque el origen ya esté confirmado.
- Sin este flag, un clic bien intencionado en "Capturar historia" para
  "resolver" un finding que en realidad ya estaba resuelto arriesgaba crear un
  segundo DEPOSIT (aunque `alreadyReflected` evita que toque el saldo, sí
  duplicaba la transacción en el historial).
- **El botón para confirmarlo solo vivía en UNA de las dos pantallas que muestran
  findings (FASE DS).** `ChispuSuggestions` (la card del dashboard) sí traía un botón
  "Capturar historia" que abre `CashFlowModal` con `alreadyReflected` prefileado, pero
  `AccountReviewModal` (el wizard de "Completar información" → revisar por cuenta o
  institución) solo mostraba el texto del finding, sin ninguna acción: el único botón
  era "Editar" (abre el editor de ítem, no el flujo que estampa `_newMoneyConfirmed`).
  Un finding visto DESDE ahí no tenía forma de resolverse sin cerrar el modal y buscar
  el otro camino. Arreglado con un botón "Resolver" por finding accionable
  (`f.action.kind === 'cashflow'`) que cierra el wizard y abre `CashFlowModal` con el
  mismo prefill, vía un nuevo prop `onOpenCashflow`.

### Depósitos/retiros inferidos: SOLO con el broker al 100% (FASE DQ)
- El único hueco real que queda una vez completado el checklist de FASE DL/DN es el
  tramo transcrito por trimestre: 4 números al año, sin detalle de Cash Transactions.
  Todo lo demás (los ~365 días que el Flex Query alcanza, vía API o archivo) ya trae
  depósitos/retiros EXACTOS, importados como transacciones reales; ahí no hay nada
  que inferir.
- **La compuerta es dura y compartida.** `hasCompleteBrokerData(brokerId, howTo,
  state)` (`lib/brokerCompletion.js`) reusa los mismos `done`/`skippable` del
  checklist — si a la cuenta le falta un paso, `lib/inferredFlows.js` ni corre.
  `brokerCompletionState` se calcula UNA vez en `useDashboardData` y se pasa a
  `BrokerCompletionModal` en vez de que el modal lo recalcule por su cuenta: two
  copies of the same gate is exactly how se cuela un bug de este tipo.
- **El techo de "esto es plausible" sale de la propia cuenta, no de una constante.**
  `plausibleReturnCeiling` escala por `√tiempo` (una regla de trimestre recibe la
  mitad del rango de un año) usando la volatilidad REAL de la cuenta
  (`computeVolatility` sobre los snapshots `_source:'ibkr'`, nunca los trimestrales).
  Un cambio de valor que cabe en esa banda se asume mercado puro; el excedente es
  el flujo inferido (depósito si es positivo, retiro si es negativo).
- **Nunca se escribe solo.** Cada candidato pasa por `InferredFlowsModal`: el
  usuario acepta (edita el monto si quiere), o descarta ("fue puro mercado"). Solo
  al aceptar se escribe una transacción real (`_source:'inferred_flow'`, symbol
  'CASH', sin `_linkedItemId` — mismo shape que un cash transaction real de IBKR),
  fechada al punto medio del hueco (la fecha exacta no se puede saber con solo el
  total del trimestre). `computeModifiedDietz` la neta igual que cualquier otra:
  cero motor de retorno nuevo.
- **Se reconcilia sola con cada sync nuevo.** Si un Flex Query real (sync diario, o
  un XML recién subido cubriendo los ~365 días que sí alcanza) llega a una fecha que
  antes solo tenía inferencia, esa inferencia ya no aporta nada: el dato real la
  confirmó o la refutó por su cuenta. `staleInferredFlowIds` + un efecto en
  `useDashboardData` la borra automáticamente — el dato real SIEMPRE gana, nunca queda una
  adivinanza vieja compitiendo al lado de un hecho.
- **Decisión del usuario, memoria persistida.** Un hueco que el usuario ya
  descartó (o aceptó) se marca `_flowReviewed:true` en el snapshot trimestral del
  extremo del hueco (mismo patrón que `_newMoneyConfirmed`), no se recalcula en
  vivo cada render.
- El spreadsheet (`lib/historicalValues.js`) no necesitó cableado aparte: ya
  reconstruye meses desde transacciones DEPOSIT/WITHDRAWAL por `_linkedItemId`
  sin mirar `_source`, así que un flujo inferido aceptado aparece ahí automático.
  Sí hubo que subir `SNAPSHOT_VERSION` (19) para invalidar el caché calculado
  antes de que esta lógica existiera.

### Credenciales IBKR: DOS almacenes que deben mantenerse sincronizados (FASE AF)
- Hay dos almacenes: (a) el **vault del servidor** (`users/{uid}/settings/ibkr`, token encriptado)
  vía `/api/brokers/ibkr` `save/get-credentials`; (b) el **doc `settings` del cliente**
  (`ibkrToken/ibkrQueryId/_ibkrVaultMigrated`). TODO lo que decide "¿está conectado?" —
  `ibkrConnected` (`useDashboardData`), el pill del header, el auto-sync y el estado `connected` de
  `IBKRSyncModal` — lee el doc de `settings`. `ConnectionsModal` guardaba SOLO al vault → el resto
  de la app creía IBKR desconectado y `IBKRSyncModal` re-pedía el token (doble entrada).
- **Regla:** cualquier flujo que guarde credenciales IBKR debe escribir AMBOS: el vault Y
  `onSaveCredentials({ ibkrToken:null, ibkrQueryId, _ibkrVaultMigrated:true })` en `settings`.
  `ibkrConnected = (ibkrToken || _ibkrVaultMigrated) && ibkrQueryId` (incluir el flag de migración,
  si no una conexión vault-only lee como desconectada).

### Sync IBKR NO bloqueante (FASE AF)
- El pill del header y el botón "Sync" de `ConnectionsModal` disparan `triggerIBKRSync()`
  (`useDashboardData`) — mismo camino que el auto-sync (`syncIBKR('__stored__') → handleIBKRSync
  ('merge')`) pero forzado; prende `ibkrAutoSyncing` (pill gira) + toast; el usuario sigue usando la
  app. El `IBKRSyncModal` completo (bloqueante) queda solo para el PRIMER connect y "Replace".
- Feedback de borrado en `SettingsModal`: la advertencia se revela con `max-height`/`opacity`
  DEBAJO del row (no re-centra el botón) y el botón muestra spinner + `disabled` durante los awaits.

### Equity Summary = la ÚNICA fuente de NAV histórico real de IBKR (FASE AE)
- El historial de valor diario del portafolio viene de la sección **"Equity Summary"** del Flex
  Query → tag `<EquitySummaryByReportDateInBase>`. `lib/parsers/ibkrEquitySummary.js` lo parsea
  (regex `\b[^>]*>` para self-closing Y pareado) y cada fila se escribe como `snapshots/{date}`
  `_source:'ibkr'`. Con esos snapshots, YTD se ancla en enero (`findYearStartAnchor`) y ALL arranca
  en el snapshot más viejo → retornos REALES (no el estimado hold-flat de AD).
- **Trampa histórica:** las instrucciones del Flex Query pedían solo Open Positions/Trades/Cash
  Transactions — NUNCA Equity Summary. Sin ella el import "tiene éxito" con cero historial en
  SILENCIO (el gate `EMPTY_REPORT` no chequea `equityHistory`). Arreglado: instrucciones ahora
  piden Equity Summary + período amplio, y `IBKRSyncModal` muestra un aviso ámbar tras el sync
  cuando hay posiciones pero `equityHistory <= 1`.
- El período del Flex Query (lado IBKR) gobierna el rango; la app importa TODO lo que reciba sin cap.

### Flujos IBKR en el Dietz/TWR: depende de la FUENTE de la serie (FASE AD, corregida en AI)
- Los cash-flows `_source:'ibkr'` (FASE AA, `_ibkrTxnId`) entran o no al retorno según de dónde
  viene la serie de valor:
  - **Serie de NAV real** (snapshots `_source` 'ibkr'/'daily'/'manual'): el NAV YA contiene el
    efecto de depósitos/retiros → los flujos DEBEN netearse. Un TWR/MWR ciego a flujos lee cada
    retiro como pérdida de mercado (bug real: Chispudo +1.98% TWR vs IBKR +10.99%, drawdown -17%
    vs -8%).
  - **Baseline reconstruido** (hold-flat/`jan1Value` del API, snapshots 'backfill'): la cantidad
    actual se mantiene plana hacia atrás, lo que pre-data los depósitos implícitamente → restar
    los flujos DOBLE-cuenta. Ahí se excluyen (razón original de AD2).
- **Implementación:** `useDashboardData` decide por anchor (`REAL_SNAPSHOT_SOURCES.includes(
  anchor._source)` → `transactions` completo; si no → `dietzTransactions` filtrado); el chart
  decide con `flowAware` (primer punto de `snapshotData` con `src` real). Los depósitos MANUALES
  siempre cuentan. Amigos (`computeScopedReturns`) usa NAV crudo + flujos completos, sin cambio.

### Colores / CSS
- **No usar Tailwind classes para colores dinámicos** — los JS chunks de Next.js se cachean agresivamente y cambios de classes como `text-blue-400` no se reflejan en producción
- Usar inline styles con hex: `style={{ color: '#60a5fa' }}`
- Esto aplica a TODOS los colores que cambian según estado (positivo/negativo, activo/inactivo)

### iOS Safari
- **No usar `persistentLocalCache` en Firestore** — iOS mata websockets en background, dejando datos stale en IndexedDB
- Usar `getFirestore()` default (in-memory cache) para siempre fetch fresco
- Auto-reload en `layout.jsx`: compara build ID del HTML vs `/api/version`, recarga si son diferentes
- Batch commit timeout: 60s (no 30s) para conexiones móviles lentas

### Geometría SVG / Charts
- Siempre filtrar valores con `isFinite()` antes de calcular min/max para evitar NaN que rompe el SVG
- Pattern: `const allVals = [...values].filter(v => isFinite(v))`

### Testing de integraciones
- Probar con baseCurrency !== USD para detectar bugs de conversión
- Probar con múltiples cuentas para verificar filtros
- Probar refresh después de import para verificar persistencia
- Probar currency picker con todos los valores derivados
- **Comparar YTD/ALL con el broker real** — si los retornos no cuadran, revisar si lots incluyen closed y si jan1Value usa lots
- Probar venta parcial y total de posición → verificar que el chart histórico refleja la cantidad correcta antes y después de la venta

### Guía para futuras integraciones de brokers
1. **Parser:** Crear `lib/parsers/{broker}Parser.js` — extraer items, transactions, equityHistory
2. **Items:** Cada item necesita `symbol`, `quantity`, `currentPrice`, `purchasePrice`, `acquisitionDate`, `currency`, `type`
3. **Lots:** Crear un lot por cada posición importada con `symbol`, `quantity`, `costBasis`, `acquisitionDate`
4. **Equity History:** Si el broker provee NAV diario, importar como snapshots — es la fuente más confiable para el chart
5. **Transactions:** Importar BUY/SELL/DIVIDEND con `date`, `symbol`, `quantity`, `pricePerUnit`, `totalAmount`
6. **Deposits/Withdrawals:** Importar como transactions tipo DEPOSIT/WITHDRAWAL para que Modified Dietz los descuente
7. **Merge logic:** Match por `conid`/`symbol` + `institution` — actualizar existentes, crear nuevos, NO borrar los que no vienen
8. **Credenciales:** Encriptar con AES-256-GCM (`lib/crypto.js`), guardar en `users/{uid}/settings/ibkr/`
