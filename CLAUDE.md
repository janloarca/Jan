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

### Depósitos auto-importados de IBKR fuera del Dietz del dashboard (FASE AD)
- Los cash-flows `_source:'ibkr'` (FASE AA, marcados `_ibkrTxnId`) existen SOLO para el retorno
  "scoped" de Amigos (`computeScopedReturns` los netea contra el NAV real del broker). Contra el
  baseline reconstruido/held-flat del dashboard, restarlos DOBLE-cuenta y jala el número abajo.
- **Regla:** el YTD/MTD del dashboard (`useDashboardData` → `dietzTransactions`) y el return series
  del chart (`mwrData`/`twrData` → `dietzScopedTransactions`) filtran `tx._source !== 'ibkr'`.
  Los depósitos MANUALES (sin `_source:'ibkr'`) SÍ cuentan. Amigos usa el `transactions` completo.

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
