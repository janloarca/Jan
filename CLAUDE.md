# Jan — Portfolio Tracker

## Pendientes

- [ ] (usuario) Verificar en el dashboard de Vercel que los deploys corren bien — el límite de 100/día del free tier bloqueó PR #62 en junio 2026; si vuelve a pasar, considerar Pro o menos deploys.
- [ ] (usuario) Activar el recordatorio de finanzas: crear buzón `recordatorios@chispu.xyz` (Zoho Mail gratis: dominio + MX/SPF/DKIM + app password) y setear `SMTP_HOST/SMTP_USER/SMTP_PASS` + `CRON_SECRET` en Vercel. Pasos completos en `.env.local.example`.
- [x] Intro interactiva para usuarios nuevos: hecha (Fase Q). `OnboardingTour` ofrece "Explorar con datos de ejemplo" → seed de `lib/demoData.js` vía bulkImport → walkthrough con spotlight sobre las cards reales (`data-card-id` / `data-tour`) → "Borrar demo y agregar lo mío". Mientras existan items `_source:'demo'`: banner de salida en el dashboard y VETO a saveSnapshot/saveItemSnapshots/processDividends (cero side-effects persistentes). Limpieza selectiva con `deleteDemoData()`.

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
