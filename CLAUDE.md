# Jan — Portfolio Tracker

## ⛔ LÓGICA CONGELADA: preguntar ANTES de cambiar

Hay tipos de activo cuya lógica ya se estabilizó después de muchas iteraciones de
bugs reales y quedó CONGELADA. Están especificados en `lib/assetLogic/`.

**Hoy hay uno: `lib/assetLogic/corporateBondWithEntryFee.js`** (bono corporativo
con comisión de entrada que paga cupón en efectivo a otra cuenta; caso de
referencia VITALI/IDC). Ese archivo describe la fórmula, las tres cantidades que
NO son la misma, las ocho superficies donde está implementada, y los dos errores
concretos que ya se cometieron (2.33% y 4.00%, cuando el número correcto es
3.94%).

**El protocolo, para quien haga el cambio (persona, IA o refactor automático):**

1. Antes de tocar cualquier fórmula, campo o superficie que ese archivo liste,
   DETENERSE y preguntar explícitamente a quien pidió el cambio:
   *"Este cambio toca lógica congelada (`lib/assetLogic/<archivo>.js`). Se
   estabilizó después de muchas iteraciones de bugs reales. ¿Confirmás que querés
   cambiarla, y por qué? ¿Revisaste los comentarios y los invariantes que fija?
   ¿Sigue siendo viable lo que describe?"*
2. NO proceder hasta tener respuesta.
3. Si aun así se cambia, actualizar la spec Y sus tests en el MISMO commit. La
   especificación y el código no pueden divergir.
4. `lib/__tests__/corporateBondWithEntryFee.test.js` recalcula el caso completo
   con las funciones reales. **Si ese test falla, la respuesta correcta NO es
   actualizar el número esperado**: es volver al paso 1.

**Alcance:** lo congelado aplica a ESE tipo de activo con ESA configuración
exacta. Cada tipo de activo tiene su propia lógica y ninguno hereda esto
automáticamente. No es limitante: si aparece otro activo con costo de entrada
(bonos, fondos, alternativos, CDs) apalancarse en esta lógica es lo correcto. Lo
que no se vale es CAMBIARLA para acomodar al activo nuevo: se extiende, no se
reescribe.

## Pendientes

- [ ] (usuario) Verificar en el dashboard de Vercel que los deploys corren bien — el límite de 100/día del free tier bloqueó PR #62 en junio 2026; si vuelve a pasar, considerar Pro o menos deploys.
- [ ] (usuario) Activar el recordatorio de finanzas: crear buzón `recordatorios@chispu.xyz` (Zoho Mail gratis: dominio + MX/SPF/DKIM + app password) y setear `SMTP_HOST/SMTP_USER/SMTP_PASS` + `CRON_SECRET` en Vercel. Pasos completos en `.env.local.example`.
- [x] Intro interactiva para usuarios nuevos: hecha (Fase Q). `OnboardingTour` ofrece "Explorar con datos de ejemplo" → seed de `lib/demoData.js` vía bulkImport → walkthrough con spotlight sobre las cards reales (`data-card-id` / `data-tour`) → "Borrar demo y agregar lo mío". Mientras existan items `_source:'demo'`: banner de salida en el dashboard y VETO a saveSnapshot/saveItemSnapshots/processDividends (cero side-effects persistentes). Limpieza selectiva con `deleteDemoData()`.
- [x] Modo oscuro del Spreadsheet: hecho (FASE EV). Todo `PortfolioSpreadsheet.jsx` (toolbar, encabezados de mes, filas de categoría/institución/ítem, popover de edición, pie con TOTAL/retornos, banners de bloqueo/guardado) pasó de clases Tailwind fijas de tema claro (`bg-white`, `text-slate-XXX`, hex sueltos) a las variables de tema (`var(--text-primary)`, `bg-theme-surface`, `bg-theme-tertiary`, tokens `--alert-*`) que usa el resto de la app. Dos tokens nuevos a nivel de módulo (`CURRENT_COL_BG`, `EDITING_CELL_BG`) calculados con `color-mix` contra `var(--bg-card)` para que el tinte de "mes actual" y "celda en edición" escale con cada tema en vez de un `#eff6ff`/`#dbeafe` fijo para claro. `CATEGORY_ACCENT` (las franjas de color por categoría) se dejó intacto a propósito: son colores de acento saturados, ya seguros en ambos temas. Verificado visualmente con Playwright en una ruta de preview aislada (claro/oscuro/editando/Año a año), cero cambios en cálculos, matching de meses o datos mostrados: solo `npx jest` (996/996) y `npm run build` de por medio, sin tocar ninguna función de `historicalValues.js` ni la lógica del componente.
- [x] Enrich Data, primera mejora concreta: hecha (FASE EW). El usuario acotó "más inteligente" a algo específico: "solo avisa, no ayuda a resolver". `lib/dataCompleteness.js` ahora calcula un `suggestion` opcional en 4 de los 12 hallazgos, SOLO cuando hay un valor real ya en los datos (nunca inventado): `no-acq-date` (fecha del primer movimiento vinculado, o si no `createdAt` de la cuenta), `income-no-months` (los meses exactos donde ya vimos pagos DIVIDEND/INTEREST reales), `income-no-dest` (la cuenta a la que esos pagos ya llegaron, vía `_destinationItemId`), `broken-link` (limpiar la referencia muerta, no inventa una nueva). Botón "Usar esto" en `ChispuSuggestions` (dashboard) y `AccountReviewModal` (wizard) que llama `updateItem` directo, sin pasar por el modal de edición manual; el hallazgo desaparece solo en el siguiente render porque `dataCompleteness` es un `useMemo` sobre `items`. Los 8 hallazgos sin dato real que ofrecer (`no-history`, `stale-value`, `past-maturity`, etc.) se quedan igual que antes, solo con el botón de siempre. Verificado con Playwright en una ruta de preview aislada (aplicar sugerencia en ambas superficies, estado "Aplicado"), `npx jest` (1003/1003, 7 tests nuevos) y `npm run build`. `EnrichModal.jsx` no se tocó (no muestra hallazgos individuales, solo cuenta huecos). El resto de "más inteligente" (más tipos de hallazgo, menos fricción en general) queda abierto si el usuario pide seguir.
- [x] Enrich Data, segunda mejora concreta: hecha (FASE EX). El usuario eligió "más tipos de hallazgo" entre las tres opciones de cómo seguir. 4 checks nuevos en `lib/dataCompleteness.js` (de 12 a 16), los cuatro son bugs de correctitud reales que hoy pasan en silencio, no huecos cosméticos: `no-market-price` (activo de mercado con cantidad > 0 pero `currentPrice` en cero: se cuenta como $0 en el patrimonio; colocado ANTES del filtro de dust porque el propio bug hace que su balance sea 0 y el filtro lo escondería), `no-cost-basis` (tiene precio actual pero no de compra: la ganancia mostrada asume que costó $0), `no-symbol` (activo de mercado sin símbolo: hoy queda invisible hasta para `uncovered-shares`, que ya lo excluía en silencio por falta de símbolo), `bad-maturity-date` (vencimiento anterior a la fecha de adquisición: contradicción interna, casi siempre un typo). Sin sugerencia automática en ninguno de los cuatro (no hay un valor real que ofrecer: el precio de mercado hay que sincronizarlo, el precio de compra no está en ninguna transacción salvo para brokers ya excluidos, el símbolo no se puede adivinar, y no se sabe cuál de las dos fechas es la equivocada). Verificado con Playwright (los 4 hallazgos nuevos renderizando con la severidad y el color correctos en `ChispuSuggestions`), `npx jest` (1016/1016, 13 tests nuevos) y `npm run build`.
- [ ] Spreadsheet: en cada carga fría, el efecto que decide qué meses recalcular dispara una llamada de red a Yahoo Finance/CoinGecko EN PARALELO con la lectura del caché de Firestore, antes de saber si el caché ya alcanza. Casi siempre gana el caché y esa respuesta de red se descarta (no corrompe nada, es una llamada de más). Arreglo correcto: que el efecto de cómputo espere la primera resolución del caché antes de evaluar `missingMonths` en el mount frío. Zona con historial largo de bugs sutiles (FASE DS/DW/DY/EL), no tocar sin avisar antes.
- [x] Conexión de brokers, primer paso: hecha (FASE EZ). El usuario pidió cambiar el cluster de 2-3 botones por fila (API / Pasos / CSV) por un solo botón "Empezar" bonito, con una estructura de pasos detrás. Nuevo componente `BrokerConnectModal.jsx`: wizard de pantalla completa, "Paso X de 3 → Continuar/Atrás", que ofrece los 3 caminos posibles (Archivo, Captura de pantalla, API) como pasos SIEMPRE visibles y no excluyentes entre sí (nunca "elegí uno"), con la frase explícita "ningún paso es obligatorio, mientras más completes mejor" pedida por el usuario. El paso de captura de pantalla no inventa una IA nueva: apunta al flujo de prompt-copiable que `FileImportModal` ya tenía (`¿Solo tienes una captura...?`), solo le da su propio paso numerado en vez de quedar enterrado al fondo del importador. `lib/brokerConnectSteps.js` (puro, con tests) arma los 3 pasos por broker a partir de `lib/brokerHowTo.js` + `lib/brokerRegistry.js`, con fallback correcto cuando falta investigación (`no hay howTo` → usa `broker.instructions`; `no tiene API` → paso 3 se muestra como no disponible en vez de desaparecer, para que la forma del wizard no cambie de broker a broker). Aplica a las 21 tradicionales + crypto; IBKR queda con su flujo dedicado (token + query ID + su propio checklist de `lib/brokerCompletion.js`), tal como pidió el usuario. De paso, un bug real de `components/ui/StepJourney.jsx` (componente compartido, no solo de este cambio): esperaba `step.title` anidado pero `lib/brokerHowTo.js` guarda el texto plano (`{es, en, detail}`), así que CADA lugar que ya usaba `BrokerSteps`/`StepJourney` con esos datos (incluido `FileImportModal`) mostraba círculos numerados sin texto al lado. Arreglado en el componente compartido, no en cada lugar que lo llama. Verificado con Playwright en una ruta de preview aislada (4 variantes de broker: con API+archivo, sin API, OAuth, sin investigación previa), `npx jest` (1026/1026, 10 tests nuevos) y `npm run build`.
- [x] Conexión de brokers, IBKR: hecha (FASE EZ2). El usuario notó que el paso anterior dejó a IBKR con su cluster viejo de botones API/CSV mientras los otros 21 brokers ya tenían "Empezar". Mismo wizard (`BrokerConnectModal`), sin duplicar el componente: `IBKR_PSEUDO_BROKER` (en `ConnectionsModal.jsx`, no en `lib/brokerRegistry.js`, porque el endpoint de IBKR toma `{token, queryId}` en vez del `{fields:[...]}` genérico) alimenta el mismo wizard, y el paso de API detecta `broker.id === 'ibkr'` para mostrar los dos campos reales (Flex Token + Query ID) en vez del formulario genérico. El formulario inline viejo (`showConfig`) se eliminó del todo. El estado ya conectado (Sincronizar, Desvincular, "Completar historial (3 pasos)" hacia `lib/brokerCompletion.js`) no cambió. Verificado con Playwright (los 7 pasos investigados de IBKR renderizando completos gracias al fix de `StepJourney` de FASE EZ, campos Token/Query ID habilitando "Conectar" al llenarse), `npx jest` (1026/1026) y `npm run build`.
- [x] Banner "IBKR bloqueó tu token": ya no alarma de inmediato (FASE EZ3). El usuario señaló que IBKR bloquea temporalmente si se le pide demasiado seguido, y eso es justo lo que `LOCKED` significa: un candado que el propio IBKR levanta solo tras un enfriamiento (`useDashboardData.js` ya lo sabía: reintenta cada 12h en vez de detener el sync). Pero `ibkrNeedsAttention` (`app/dashboard/page.jsx`) trataba `LOCKED` igual que `TOKEN_EXPIRED`/`INVALID_QUERY` (errores genuinamente fatales que sí necesitan al usuario) y encendía el banner rojo y el pill "IBKR ⚠" del header desde el PRIMER intento fallido. Ahora `LOCKED` cae en la misma regla que cualquier otro fallo transitorio (`RATE_LIMITED`/`TIMEOUT`/`UNKNOWN`): silencioso hasta que pasen 5 días hábiles sin un sync exitoso (`businessDaysSince`, ya existía y ya se usaba para esos otros códigos). Al cruzar el umbral, sigue mostrando la copia específica ("genera un token NUEVO...") en vez de cambiar a la genérica. Una sola fuente (`ibkrNeedsAttention`) alimenta banner, pill del header y el punto rojo de `ActionButtons`, así que el fix aplica a los tres sin tocarlos por separado. El feedback DENTRO de `IBKRSyncModal` cuando el usuario sincroniza a mano y falla con `LOCKED` no se tocó a propósito: es reacción a una acción que el usuario acaba de tomar, no una alarma silenciosa acumulándose sola. Verificado simulando la lógica real contra `businessDaysSince` (día 0 y día 4 sin alarma, día 5 sí, con la copia correcta) y `npx jest` (1026/1026).
- [x] Falsos positivos de "sin precio actual" en Enrich Data: arreglado (FASE EZ4). El usuario reportó que Chispu marcaba Bitcoin/Ethereum como "sin precio: contando en $0" cuando el patrimonio SÍ los sumaba bien. Causa raíz: `currentPrice` de un activo de mercado NUNCA se persiste en Firestore por diseño (`AddAccountModal` nunca lo asigna al crear una acción/cripto; `useMarketPrices` lo resuelve en vivo por símbolo en cada render, sin escribirlo de vuelta). Los checks `no-market-price`/`no-cost-basis` de FASE EX leían `it.currentPrice` del item crudo directo, así que marcaban CASI CUALQUIER posición de mercado que funciona bien, no solo las rotas de verdad. `lib/dataCompleteness.js` ahora acepta un `marketPrices` opcional (el mismo mapa que ya produce `useMarketPrices`, por símbolo) y `effectivePrice(it, marketPrices)` lo consulta cuando el precio guardado es 0: si el símbolo resuelve en vivo, no hay hallazgo. `itemBalance()` (el gate que decide "polvo" para CASI todos los demás checks) tenía el mismo problema pero más grave: sin este fix, cualquier chequeo posterior al filtro de dust (no-currency, no-institution, no-cost-basis, etc.) nunca corría en absoluto sobre un activo de mercado con precio solo resuelto en vivo, porque su balance calculaba en $0 y quedaba fuera del piso `MIN_BALANCE_BASE` antes de llegar a esos checks. Ahora cae a `purchasePrice` cuando ni el precio guardado ni el vivo resuelven, igual que el propio fallback de `useDashboardData` (`currentPrice || purchasePrice || price || cost || 0`) para que "polvo" signifique lo mismo aquí que en el resto de la app. Sin `marketPrices` (callers viejos, los tests existentes) el comportamiento es idéntico a antes. Verificado con Playwright reproduciendo el reporte exacto del usuario (2 Bitcoin + 1 Ethereum, precio guardado en 0, símbolo resuelto en vivo): las 3 alertas falsas desaparecen, "Datos completos" sube de 41% a 81%. `npx jest` (1030/1030, 4 tests nuevos) y `npm run build`. De paso, no relacionado: `uncovered-shares` redondea cantidades fraccionarias de cripto a "0 unidades" en el texto (`fmt()` usa `Math.round`), anotado pero no tocado, fuera de lo que se pidió.
- [x] Spreadsheet: el scroll con rueda del mouse no bajaba en algunas computadoras: arreglado (FASE FA). El usuario lo reportó como "en mi iPad con mouse funciona, en la compu de mi amigo no". Causa raíz, no relacionada con dispositivo: el div `overflow-x-auto` que envuelve la tabla NUNCA fue un contenedor de scroll real. Por la spec de CSS Overflow, declarar `overflow-x` distinto de `visible` fuerza a `overflow-y` a computarse como `auto` también, sin importar qué se declare ahí (confirmado en vivo: `overflow-y-visible` de Tailwind no cambia `getComputedStyle().overflowY`, sigue en `"auto"`). Ese quirk hacía que ESTE div, que nunca recibía el scroll real (el scroll de verdad ocurre en el wrapper de `app/spreadsheet/page.jsx`), contara igual como el ancestro de referencia para los `sticky top-0`/`sticky left-0` de la tabla: el encabezado de meses y la columna de nombres estaban rotos en silencio, sin marco de referencia contra el cual pegarse, y se iban con el resto del contenido al hacer scroll. Arreglado dándole al div un alto acotado real: `overflow-auto max-h-[75vh]` en vez de `overflow-x-auto`, para que sea su propio contenedor de scroll en 2D (con su propio scrollbar) y por lo tanto el marco de referencia correcto para los sticky. El `zoom` (no `transform`) que ya evitaba romper el sticky de la columna de nombres no se tocó. Verificado con Playwright en dos pasadas: la primera (`overflow-y-visible`) resultó NO efectiva (el computed style seguía en `auto`) y se descartó antes de commitear; la segunda, con un contenedor forzado a `h-screen` para simular el peor caso, confirmó que el div ahora recibe el delta completo de un wheel event (`scrollTop` de 0 a 600px exacto) y que el encabezado/columna de nombres quedan visiblemente pegados arriba tras el scroll (antes desaparecían del todo). Un portafolio que ya cabe en pantalla no se ve afectado: `max-height` solo limita lo que de otro modo desbordaría. `npx jest` (1030/1030) y `npm run build`. Posiblemente relacionado con el reporte separado del usuario de que un amigo tiene problemas con el historial del spreadsheet: pendiente de confirmar con más detalle, pero el sticky roto es un candidato directo (un header/columna que desaparece al hacer scroll se puede leer fácilmente como "el historial no funciona").
- [x] Pasivos, PE y acciones privadas: extendida la lógica de Bono, no reescrita (FASE FB). El usuario pidió mejorar las secciones que no fueran Acciones/Crypto/Bono ("esos ya están perfectos"), apalancando la misma lógica de comisión de entrada/costBasis del bono (ya sancionado por el protocolo congelado: extender está permitido, reescribir no). Confirmado con el usuario vía preguntas antes de tocar código. Las tres funciones congeladas (`getItemPrincipalCost`/`getItemCostBasis`/`getDividendIncomeByItem`) NO se tocaron: ya son genéricas por item, no por tipo, así que "usar la lógica de bono" es enrutar el tipo nuevo por el mismo camino manual que ya usa Bono. (1) Pasivos: ya estaba excluido de todo cálculo de retorno (`isDebt` se filtra en AssetAllocation/InstitutionPerformance/NetWorthCard), pero era invisible en la UI. `DEBT_CLARIFICATION` (utils.js, copy compartido bilingüe) ahora aparece como caption en `AddAccountModal` al elegir Deuda/Pasivo, y como InfoTip en la fila "Pasivos" de `PortfolioSpreadsheet`, que además lleva un borde superior más grueso separándola visualmente de las categorías de inversión (la fila se queda porque el TOTAL de la tabla la resta para dar el patrimonio neto; ya existe además una pestaña "Deudas" dedicada en `spreadsheet/page.jsx`). (2) PE: ya existía como subtipo "Alternativo > Capital Privado" y ya heredaba la sección de comisión de entrada de Bono (`isAlternative` comparte esa UI); solo hacía falta que fuera reconocible, renombrado a "PE / Capital Privado". (3) Acciones privadas: bug real, no solo un hueco. `item.type === 'Stock'` matchea `MARKET_TYPE_RE` sin importar el subtype, así que el subtipo viejo "Acción > Privada" se trataba como activo de MERCADO (buscaba cotización en vivo por símbolo, sin comisión de entrada ni destino de dividendo). Partido en `private_common`/`private_preferred` (para tener ambos a la vez, ej. fundador con comunes + inversionista con preferentes del mismo cap table); `isPrivateStock` los excluye de `isMarketAsset` en `AddAccountModal` y los suma a Costos y comisiones/Liquidez (sin Vencimiento: la equidad no vence). Mismo bug independiente arreglado en `EditAccountModal` (su propio `isMarket` calculado por regex sobre `form.type`, ciego a subtype) y en `isMarketPriced` de `utils.js` (el runtime de precios de `useMarketPrices`: sin este fix, el símbolo sintético que arma `AddAccountModal` del nombre de la empresa dispararía un fetch a Yahoo Finance que puede coincidir con un ticker real no relacionado). El subtype viejo `'private'` se sigue reconociendo en los tres lugares para no romper items ya guardados. Verificado con Playwright (private stock: sin buscador de mercado, con comisión de entrada/liquidez, sin vencimiento; pasivo: caption visible; spreadsheet: borde + InfoTip en Pasivos sin romper el layout), `npx jest` (1036/1036, 6 tests nuevos) y `npm run build`.
- [x] ToS en login, privacidad más genérica, fechas ambiguas: hechos (FASE FC). Tres pedidos puntuales. (1) Login/crear cuenta: nuevo enlace con el mismo círculo "i" de `InfoTip` junto al texto "Terms of Service" (clickeable, mismo destino `/terms` que el aviso legal que ya existía; se suma, no lo reemplaza; visible en login y signup porque comparten el mismo formulario). (2) Privacidad: la sección "Con quién los compartimos" nombraba los proveedores exactos de precios de mercado (Yahoo Finance, CoinGecko); reemplazado por "Fuentes de datos públicas" sin nombrar proveedores. El resto de esa sección (Firebase, Anthropic, Vercel) se dejó igual a propósito: son subencargados de tratamiento de datos DEL USUARIO, una divulgación legal distinta de "de dónde sacamos los datos de mercado", que fue lo pedido. (3) Fechas ambiguas MM/DD/YYYY: de los ~20 usos de `toLocaleDateString()` en la app, casi todos ya usan nombre de mes ("21 jun 2026", no ambiguo); encontrados y arreglados los únicos dos que caían al formato numérico del navegador por no pasarle locale/opciones (`AssetDetailModal` fecha de vencimiento, `MaturityCalendar` fecha en la lista), ambos ahora pasan por el `formatDate()` compartido de `utils.js` en vez de duplicar lógica. Los `<input type="date">` nativos (selector de fecha al agregar/editar cuentas y transacciones) quedaron fuera a propósito y confirmado con el usuario: su formato en pantalla lo decide el navegador/sistema operativo, no el código de la app, y arreglarlo de raíz requeriría reemplazar los 11 archivos que los usan por un date-picker propio. Verificado con Playwright (ícono ToS visible y linkeando a `/terms` en login y signup; texto de privacidad sin Yahoo Finance/CoinGecko; las dos fechas mostrando "20 nov 2027"/"Nov 20, 2027" según idioma en vez del numérico ambiguo o el ISO crudo), `npx jest` (1036/1036) y `npm run build`.
- [x] ClubCashIn: la gráfica de "Valor" ya refleja el rendimiento reinvertido: arreglado (FASE FD). Causa raíz distinta a la hipótesis inicial (no era `indexBalanceEvents`/`computeAnchoredReturnSeries`/una ancla de calibración): el usuario confirmó con capturas reales (Spreadsheet + EditAccountModal de las dos cuentas ClubCashIn) que ambas tienen su propio depósito de apertura Y una tasa fija que se reinvierte en la misma cuenta cada mes. En `app/api/prices/portfolio-history/route.js` (el motor detrás de "Valor"/"Rendimiento" del dashboard), un ítem estático con AMBAS cosas (depósito propio + ingreso reinvertido) tomaba la rama de "tiene cashFlows" y cortaba ahí con un `return` inmediato: el rebobinado de dividendos reinvertidos nunca corría. Como el único flujo de esa rama era el depósito de apertura (ya en el pasado para cualquier fecha posterior), el valor histórico quedaba fijo en el total DE HOY desde la fecha del depósito en adelante, como si todo el rendimiento ya hubiera llegado el primer día: el "+0.00% from start" de la captura original, sobre una cuenta que sí rendía mes a mes (confirmado en el Spreadsheet, que no tiene este bug porque `applyStaticHistory` en `lib/historicalValues.js` ya combina los dos tipos de evento antes de rebobinar). Arreglado con `staticItemValueAtTs()` nueva en `lib/portfolioRewind.js`: combina el rebobinado de depósitos/retiros (`cashAtTs`) con la reversión de eventos de ingreso para el MISMO ítem, en vez de tratarlos como excluyentes. Los dos flujos son disjuntos por diseño (`indexBalanceEvents` nunca pone un dividendo reinvertido en `balanceEventsById`, va a `reinvestBySym` aparte), así que combinarlos no cuenta dos veces el mismo peso. `⛔ indexBalanceEvents`/`applyStaticHistory` NO se tocaron (lógica congelada F); este cambio solo lleva el motor de la gráfica a la misma paridad que el Spreadsheet ya tenía. `clampZero` se pasa explícito en cada rama para reproducir el comportamiento EXACTO de antes en los casos que ya andaban bien (VITALI/IDC y cualquier ítem con solo uno de los dos flujos, que es todo lo demás hoy): sin cambio de comportamiento salvo para el caso nuevo. Verificado: `lib/__tests__/corporateBondWithEntryFee.test.js` (el invariante de 3.94%) se recalculó sin tocar y sigue exacto; 8 tests nuevos en `lib/__tests__/portfolioRewind.test.js` que recalculan el caso ClubCashIn con la función real, incluida una prueba que fija el comportamiento viejo (buggy) como regresión negativa explícita. `npx jest` (1044/1044) y `npm run build`.
- [x] "Bumps" en la gráfica durante sincronización de precios: arreglado (FASE FE). El usuario reportó números dobles/incorrectos durante la sincronización que "después de un tiempo" se autocorregían pero dejaban un bump pegado en la gráfica. Causa raíz confirmada: `hooks/useMarketPrices.js` solo prendía `loading:true` en el PRIMERÍSIMO fetch de toda la sesión (a propósito, para no destellar una pantalla de carga cada 5 minutos); los refrescos de fondo posteriores corrían con `loading:false` de punta a punta. Tres efectos de `hooks/useDashboardData.js` (snapshot diario, backfill de 30 días, procesamiento de dividendos) usaban esa misma bandera (`pricesLoading`) como semáforo para saber si es seguro escribir — con la bandera sin armar durante los refrescos de fondo, ese semáforo no protegía nada: un precio momentáneamente malo de Yahoo/CoinGecko en pleno refresco podía grabarse directo a Firestore. Con broker conectado era peor: el snapshot del día, una vez escrito, no se corrige el resto de ese día (a propósito, FASE EI), así que el precio malo quedaba pegado hasta que cambiaba la fecha. El arreglo NO fue "prender `loading` en todos los fetches" (eso sí hubiera reintroducido el destello de spinner cada 5 minutos, confirmado: `loading` alimenta el `RefreshRing` del header y el spinner inline de "Datos al día"). En cambio, `useMarketPrices.js` expone una señal nueva y separada, `isFetching`: true en TODO fetch (incluidos los de fondo), invisible para cualquier UI — los tres efectos de `useDashboardData.js` ahora también checan `pricesFetching` antes de escribir, sin tocar el comportamiento de `loading`. Sin evidencia de doble-conteo por escritura no atómica de IBKR (`bulkImport` escribe todo en un solo batch), esa hipótesis se descartó. `npx jest` (1044/1044, sin tests nuevos: son hooks de React con fetch y efectos, sin arnés de testing en este repo, mismo criterio que ya aplicaba a estos dos archivos) y `npm run build`.
- [x] Dividendo de acciones/crypto/fondos: destino real y calendario editable (FASE FF). El usuario pidió, para TODOS los activos, poder decir cuándo generan intereses, si se reinvierten o si van a otra cuenta — ya existía completo para Bono/Alternativo, pero acciones/crypto/fondos con dividendo auto-detectado (Yahoo) solo daban Efectivo/Reinvertir, y "Efectivo" auto-creaba en silencio una cuenta genérica "{Institución} - Cash" sin preguntar. Acotado con preguntas: (1) con Flex Query de IBKR el destino ya se sabe por el propio historial de cash del broker, así que esto solo aplica al alta manual (`AddAccountModal`, no al sync); (2) mejor no inventar ningún destino por default, y dejar que el hallazgo `income-no-dest` (`lib/dataCompleteness.js`, no filtraba por tipo de activo, ya cubría esto sin cambios) lo pregunte después en Enrich Data si queda en blanco; (3) el calendario de pago sigue automático por default, con opción de corrección manual. Implementado: selector "¿A dónde llega el efectivo?" (mismo widget que Bono/Alternativo, cuenta existente + crear nueva, sin preseleccionar nada) reemplaza el auto-creado; link "✏️ Editar manualmente" en la caja de "Dividendo detectado" que siembra % anual/día de pago/meses con lo que Yahoo ya trajo y los deja editables, mismos campos de siempre (`dividendYield`/`incomeMonths`/`incomeFrequency`) así que nada que ya los lea necesita cambiar. `marketDivOverride` se resetea al cambiar de símbolo o tipo. Una segunda fuente de datos de dividendos (pedida como "sería bueno") quedó fuera a propósito: es una integración de API nueva, no algo para este cambio. Verificado con Playwright (búsqueda de símbolo real vía mocks → dividendo detectado → destino en blanco por default → edición manual pre-llena correctamente desde los datos detectados), `npx jest` (1044/1044) y `npm run build`.
- [x] Gráfica de IBKR con pico falso y retorno inflado: arreglado (FASE FG). El usuario reportó, con capturas, que SOLO la vista de Interactive Brokers se veía mal (IDC/Ledger/ClubCashIn/Banco Industrial/OSMO bien): el último punto saltaba a casi el valor del portafolio COMPLETO (~$24K contra los ~$10,012.27 reales de esa cuenta), con un "Max drawdown: -56.8% (Aug 7 → Aug 7)" sin sentido, y el retorno del año salía inflado a +84.25% ("no lee los depósitos"). Toca la zona congelada de `PortfolioGrowthChart.jsx` (surface D); confirmado con el usuario antes de tocar código. Causa raíz, dos piezas del mismo mecanismo: (1) `snapshotData` (el memo que arma la serie histórica) solo excluía puntos `_calibrated` al escopar a una institución — nunca los snapshots `_source:'daily'/'manual'/'backfill'` que el efecto diario de `useDashboardData` escribe SIEMPRE con el total del portafolio COMPLETO, sin importar la institución. El comentario del código ya sabía que "whole-portfolio NAV snapshots can't be split per account" (por eso instituciones sin broker sincronizado descartan TODOS los snapshots y usan el fallback de API ya escopado) pero para IBKR decidió "keep using snapshots" sin filtrar CUÁLES: el doc `daily` de hoy (portafolio completo) se colaba como si fuera el NAV real de IBKR. El override de "ahora" (que sí usa `currentTotal`, correctamente escopado) empuja un punto NUEVO en vez de reemplazar porque el timestamp del doc `daily` (medianoche) no cae dentro del margen de 60s de "ahora" — dos puntos el mismo día, uno falso en ~$24K y uno real en ~$10K: el pico y el drawdown del mismo día. (2) `findYearStartAnchor(snapshots, year)` (el ancla sintética de 1-enero para YTD) se llamaba sobre `snapshots` SIN escopar, así que el arranque del año para la vista de IBKR era el valor del portafolio completo en enero, no el de IBKR solo — con `lastVal` bien escopado contra un `firstVal` mal escopado, el % salía distorsionado. Arreglo, dos puntos, ninguno toca `reconstructionIsExact`/`computeAnchoredReturnSeries`/la fórmula de comisión de entrada: en los 3 filtros de `snapshotData` (DAY, principal, fallback MTD), escopado a una institución ahora exige `BROKER_NAV_SOURCES` (`['ibkr','ibkr_quarterly']`, ya existía en `utils.js`) en vez de solo excluir `_calibrated`; sin NAV real de ese broker cae al mismo fallback de API que ya usa cualquier otra institución. El ancla YTD, escopado, recibe la lista de snapshots ya filtrada a `BROKER_NAV_SOURCES` antes de llamar a `findYearStartAnchor`; sin anchor real cae al mismo fallback que ya existía (`pts[0].value`). Verificado con Playwright en una ruta de preview aislada (props sintéticos: IBKR $10,012.27 + IDC $14,000 = $24,012.27 total; snapshots `daily` mensuales de portafolio completo + snapshots `ibkr` reales solo jun/jul, sin ninguno de hoy — el escenario exacto del bug): la vista "Interactive Brokers" pasó de un eje $8.4K-$24K con pico y aviso de drawdown falso a un eje limpio $8.4K-$10.1K, "+$1,512.27 (+17.79%) desde Jun 1, 2026" (rebase correcto al primer dato real del broker) y CERO banner de drawdown; la vista "Todas" (portafolio completo, sin escopar) y una institución no-IBKR (IDC) quedaron confirmadas sin cambio de comportamiento. `npx jest` (1044/1044) y `npm run build`.
- [x] Spreadsheet: IBKR ya no inventa un desglose por acción en meses pasados, y el hueco de 2024 en Stock Market: arreglado (FASE FH). Dos pedidos del mismo hilo. (1) El usuario notó que meses pasados de IBKR mostraban los 18 tickers de HOY con montos distintos cada mes, sin marca de "~", cuando en realidad nunca hubo dato de posición por acción para esos meses: `getHistoricalItemValues` (`lib/historicalValues.js`) solo conoce el NAV TOTAL de la cuenta ese mes (de un snapshot `ibkr`/`ibkr_quarterly`) y lo repartía proporcionalmente sobre las posiciones de HOY, con nombre y ticker reales, sin `estimated` en ningún caso — leía como "sabemos que NOVO-NORDISK valía $78.71 en jun 2023" cuando lo único real es el total de la cuenta ese mes. Reescrito para escribir un solo bucket sintético por institución+categoría (`IBKR_UNKNOWN_KEY_PREFIX`, export compartido con `PortfolioSpreadsheet.jsx` que arma la MISMA key) en vez de un valor por cada item real; el render agrega una fila "Posiciones no identificadas" (con "~" cuando corresponde) y las filas de acciones individuales quedan en "-" para cualquier mes que no sea el actual. `estimated` ahora sigue la regla exacta que pidió el usuario: NAV real sincronizado (`_source:'ibkr'`) es el total reportado por el broker, sin "~"; NAV transcrito de un screenshot trimestral (`_source:'ibkr_quarterly'`) o el fallback sin ningún snapshot sí lleva "~". (2) El hueco de "Stock Market 2024" (dato real en 2023 y 2025, "-" en el medio) resultó ser el mismo mecanismo: el fallback sin snapshot estaba gateado por `effectiveAcqDate`, que para un item IBKR lee `acquisitionDate` (la fecha del SYNC, no una fecha real — la misma falla de `dateUnreliable` ya documentada en otras partes de este archivo), así que un mes sin NAV que cae antes de un re-sync reciente se leía como "la cuenta no existía todavía" y se dejaba en blanco, aunque el usuario ya tuviera datos de esa cuenta en años antes Y después. Cambiado a gatear por `createdAt` (cuándo el documento de Firestore existe desde) en vez de `acquisitionDate`/`effectiveAcqDate` para ESTE fallback específico: una señal real, nunca stampeada por un re-sync. De paso, un segundo bug real en el mismo cambio: el efecto que decide qué meses re-computar (`PortfolioSpreadsheet.jsx`) chequeaba `monthData[it.id]` para saber si un mes ya está en caché, y como los items IBKR ya NUNCA escriben bajo su propio id, ese chequeo leía CUALQUIER mes con IBKR como "siempre falta", re-pidiendo (y re-guardando) los mismos meses en cada render que tocara las dependencias del efecto — no un bug nuevo del cambio de arriba, sino expuesto por él; `cacheKeyFor(it)` ahora resuelve a la key sintética para items IBKR antes de comparar contra el caché. Verificado con Playwright en una ruta de preview aislada (7 acciones de IBKR + 1 bono, snapshots `ibkr_quarterly` en 2023, ningún snapshot en 2024, `ibkr` real en 2025-2026 — el escenario exacto de ambos reportes): vista mensual y Año a año muestran "Posiciones no identificadas ~400.00" en vez de los 18 tickers repetidos, 2024 ya no es "-", y el total de la categoría sigue cuadrando exacto contra la fila de institución y el TOTAL general. `npx jest` (1047/1047, tests de `spreadsheetIntegration.test.js` reescritos para la nueva key sintética + 3 nuevos) y `npm run build`.
- [x] Conexión de IBKR: el flujo sigue directo al checklist de completar historial en vez de soltar al usuario en la lista de conexiones (FASE FI). El usuario pidió "hacer los pasos bien... mas UI paso por paso sin moverse mucho de pantallas, continuo". IBKR ya corría por el mismo wizard de 3 pasos que el resto de brokers (`BrokerConnectModal`, FASE EZ2: `broker.id === 'ibkr'` cambia los campos genéricos por Token/Query ID), así que el wizard de conexión en sí ya era continuo; el comentario viejo en la cabecera del archivo que decía lo contrario (que IBKR tenía su "propio flujo dedicado") estaba desactualizado y se corrigió de paso. La fricción real estaba DESPUÉS de conectar: `handleIbkrSave` (`ConnectionsModal.jsx`) cerraba el wizard y devolvía al usuario a la lista de conexiones, donde tenía que notar y hacer clic en un botón separado ("Completar historial (3 pasos)") para llegar al checklist de `BrokerCompletionModal` — dos pantallas distintas, sin continuidad. Ahora, en la PRIMERA conexión exitosa (`wasFreshConnect`, capturado antes del guardado: nunca en una actualización de token de una cuenta ya conectada, donde abrir el checklist sin pedirlo sería ruido), se cierra el modal de conexiones y se abre el checklist automáticamente, mismo patrón close+reopen que el botón manual ya usaba. La parte "analizar mejor la data con todas las herramientas que pedimos" del pedido quedó sin tocar por ser demasiado ambigua para implementar sin adivinar qué herramientas específicas faltan; queda abierta si el usuario concreta qué quiere. Verificado con Playwright en una ruta de preview aislada (ConnectionsModal + BrokerCompletionModal montados juntos, credenciales de broker mockeadas): clic en "Empezar" → wizard de 3 pasos → llenar Token/Query ID → "Conectar" → aterriza directo en "Llevar Interactive Brokers al 100%" con el primer paso ya marcado, sin ningún clic intermedio. `npx jest` (1047/1047) y `npm run build`.
- [x] Ingresos Pasivos: proyección hacia adelante, no solo los próximos 3 meses (FASE FJ). El usuario pidió "hacer proyecciones" sobre la card de Ingresos Pasivos, que hoy solo listaba "Próximos pagos esperados" (3 meses hacia adelante, por fuente) y un calendario del año calendario en curso. Agregado `next12` a la misma lógica de `projected` (mismo `perPayment`/`months` por fuente ya usado por `upcoming`, solo extendido a 12 meses en vez de 3 y acumulado por mes en vez de dejarlo como lista plana): dos cifras nuevas ("Resto de [año] (proyectado)": lo que falta por cobrar el resto del año calendario en curso; "Próximos 12 meses (proyectado)": ventana rodante desde el mes actual, no el año calendario) y una gráfica de barras hacia adelante que refleja visualmente a "Historial (12 meses)" (mismo layout, azul en vez de verde: verde = ya cobrado, azul = proyectado). No inventa una tasa de crecimiento ni proyecta años futuros: es la misma matemática de "tasa anual repartida sobre los meses de pago configurados" que ya alimentaba `incomeCalendar`, solo con ventana rodante en vez de año-calendario-fijo. Verificado con Playwright en una ruta de preview aislada (3 fuentes con calendarios de pago distintos): "Próximos 12 meses" coincide en total con "Ingreso anual est." (correcto para una cartera estable), la gráfica hacia adelante coincide mes a mes con el calendario de ingresos ya existente. `npx jest` (1047/1047, sin tests nuevos: componente de dashboard sin arnés de testing en este repo, mismo criterio que otros componentes similares) y `npm run build`.
- [x] Reporte para imprimir: sin colores, formato de estado de cuenta (FASE FK). El usuario pidió "más profesional y sin colores". `PrintSummary.jsx` usaba verde/rojo para activos/deuda/rendimiento y coloreaba la barra de asignación por categoría con `TYPE_COLORS`. Reemplazado: deuda y montos negativos ahora usan paréntesis contables `($8,000.00)` en vez de rojo (la convención que usan los estados de cuenta reales de banco/broker), el rendimiento usa `+`/paréntesis en vez de verde/rojo, la barra de asignación por categoría es gris uniforme en vez de un color por categoría. El botón "Imprimir" de la barra de herramientas se dejó azul a propósito: es chrome de pantalla (`print:hidden`, nunca sale en el PDF/impreso), no parte del reporte en sí, que es lo que el usuario pidió cambiar. `TYPE_COLORS` ya no se importa en este archivo. Verificado con Playwright en una ruta de preview aislada: cero verde/rojo en todo el documento, deuda y rendimiento negativo en paréntesis, barras de asignación en gris. `npx jest` (1047/1047, sin tests nuevos: mismo criterio que otros componentes de dashboard) y `npm run build`.

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

> **⛔ CONGELADO.** La especificación completa y verificada vive en
> `lib/assetLogic/corporateBondWithEntryFee.js`, con el protocolo de cambio
> arriba. Lo de abajo es el resumen histórico; ante cualquier duda manda el
> archivo de spec, que además está cubierto por tests que recalculan el caso.

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

**Borrar/editar un dividendo A MANO tenía la misma trampa, sin el mismo arreglo
(FASE EP).** Todo lo de arriba protegía al motor automático de sí mismo
(`queueReversal` vive DENTRO de `processDividends`); el botón de borrar/editar
una fila de `EditAccountModal` o `RecentTransactions` llamaba a
`deleteTransaction`/`updateTransaction` directo, sin idea de que ese pago ya
había movido el saldo de otra cuenta. Un cupón que el usuario marcó pagado por
error (o cuyo monto había que corregir) dejaba la cuenta destino permanentemente
mal, sin forma de arreglarlo salvo borrar la cuenta entera y rehacerla desde
cero. `dividendCreditTarget` (`lib/autoDividends.js`, puro, con tests) es la
misma pregunta que ya resolvía `queueReversal` pero expuesta para cualquier
caller: dado un tx y los items, ¿movió un saldo, y de cuál cuenta? Si sí,
`deleteTransactionWithReversal`/`updateTransactionWithReversal`
(`useDashboardData`) reversan o ajustan ese crédito con la MISMA
`creditDestinationBalance` antes de tocar la transacción, y son los que ahora
se pasan como `onDeleteTransaction`/`onUpdateTransaction` en las tres
superficies (dashboard, spreadsheet, RecentTransactions) en vez de las
funciones crudas. Los backfilleados (`_destinationCredited:false`) siguen sin
tocar nada al borrarse, por la misma razón que nunca se creditaron al escribirse.

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
- **Un componente compartido (`components/ui/*`) no sirve si un archivo trae su propia copia.** `EditAccountModal.jsx` tenía su PROPIO `InfoTip` local con clases Tailwind fijas (`text-slate-300` sobre `bg-theme-base`) mientras `AddAccountModal.jsx` ya importaba el `InfoTip` correcto de `components/ui/Tooltip.jsx` (temas vía `var(--text-muted)` etc.). Resultado invisible hasta que alguien mira en modo claro: texto gris claro sobre fondo casi blanco, ilegible. Antes de escribir un componente "auxiliar" al final de un archivo, buscar si ya existe en `components/ui/` (FASE EQ2).
- **Un color de acento tiene que venir de la variable, no de su hex de HOY.** `rgba(37,99,235,0.2)` es idéntico a `color-mix(in srgb, var(--accent-blue) 20%, transparent)` mientras `--accent-blue` siga siendo `#2563EB` — pero dos formas de escribir "lo mismo" en el mismo archivo (una fija, otra viva) es exactamente cómo un rediseño de paleta futuro deja la mitad de los botones con el color viejo. Mismo bug con `rgba(168,85,247,0.1)` junto a `color: var(--accent-purple)`: ni siquiera coincidía con NINGUNO de los dos temas (claro/oscuro) de esa variable — nunca fue el color correcto, en ningún tema.
- **Dos estilos de `<label>` en el mismo formulario se notan aunque nadie pueda decir por qué.** La mitad de `EditAccountModal` usaba la constante `labelCls` (`var(--text-secondary)`) y la otra mitad un string literal con `var(--text-muted)` — dos grises distintos para el mismo rol (etiqueta de campo), sin ninguna razón funcional. "Se ve poco pulido" casi siempre es esto: no un solo error grande, sino la misma cosa hecha de dos formas a la vez.

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

### Agregar/editar cuenta: dinero saliendo, y huecos visibles sin cambiar de pantalla (FASE DU)
- **Una transferencia SALIENTE era invisible en la cuenta de origen.** `EditAccountModal`
  ya mostraba dinero ENTRANTE de otro activo (`_incomingFrom`, ver FASE previa), pero su
  `linkedTransactions` ni siquiera incluía el tipo `TRANSFER` en el filtro de tipos: una
  cuenta que mandó dinero a otra (`TransferModal`/`CashFlowModal`, `_originItemId` →
  `_linkedItemId`) no mostraba nada explicando por qué bajó su saldo. Agregado un tercer
  bucket `outgoing` (simétrico a `incoming`, marcado `_outgoingTo`), visible y borrable
  pero no editable aquí: una transferencia toca el saldo de DOS cuentas, y este editor de
  una sola cuenta no está armado para tocar las dos a la vez. `isPositive` para un
  `TRANSFER` ya no puede leerse del tipo de transacción (no es DEPOSIT ni WITHDRAWAL):
  depende de qué lado de la transferencia es esta cuenta (`incoming` → verde, `outgoing`
  → rojo).
- **Los findings de completitud de datos solo vivían en dos pantallas, no en el editor
  mismo.** `AccountReviewModal` (el wizard) y `ChispuSuggestions` (la card del dashboard)
  ya mostraban "Chispu detectó: ..." con un botón "Resolver"; quien abre `EditAccountModal`
  directamente (clic en el nombre de la cuenta desde cualquier lista) no veía nada de esto.
  Mismo patrón agregado ahí: `findings` filtrado por `itemId === item.id`, mismo botón
  "Resolver" → `onOpenCashflow` con el mismo prefill. Tres superficies, un solo motor
  (`lib/dataCompleteness.js`), nunca pueden divergir en qué cuenta con qué se ve mal.
- **`AddAccountModal`**: los encabezados de sección de "detalles avanzados" (🏦 Cuenta,
  📅 Vencimiento, 💰 Costos, 💧 Liquidez, 🔐 Custodia, 🔮 SAFE, 🌍 Fiscal, 📝 Notas)
  usaban `text-slate-500` fijo en vez de `var(--text-muted)`: el único lugar del formulario
  que no seguía el sistema de variables de tema. La estructura por secciones (icono +
  encabezado, condicionadas por tipo de activo, todas detrás de "Detalles avanzados") ya
  existía y ya era razonable; el ajuste fue solo de consistencia visual, no una reescritura.

### La última superficie que dividía entre el valor y no entre el costo (FASE EE)
- La gráfica de rendimiento marcaba 4.00% junto a 3.94% en todas las demás: su
  serie dividía entre el VALOR del ancla (6,000) en vez de entre el efectivo que
  salió del bolsillo (6,098). Con la ventana ya sin flujos adentro, Dietz es
  lineal en la base, así que re-basear es UNA escala de toda la serie
  (`anchorVal / funded`).
- **La escala no toca el numerador**, a propósito: subir el ancla metería la
  comisión también en la ganancia y caería otra vez en el 2.33% que el caso
  VITALI documenta. Tres superficies, una sola definición: ganancia contra el
  principal, porcentaje contra el costo total.

### Un retorno necesita capital contra el cual medirse (FASE ED)
- **La línea de rendimiento salía plana en 0%** sobre un año que de verdad rindió
  3.94%. La ventana YTD abre el 1 de enero, pero el portafolio nació el 6: sus
  primeros puntos valen 0 legítimamente, y `computeModifiedDietz` devuelve 0
  cuando `startValue <= 0`. Cada punto de la serie salía 0 y el resultado era una
  raya recta. La gráfica ahora empieza a medir donde aparece el dinero
  (`findIndex(value > 0)`), igual que el encabezado con `jan1Ts`, y rellena con 0%
  el tramo previo para que la serie siga alineada 1:1 con `chartData` (la
  geometría del SVG indexa por posición).
- **El depósito que fundó el primer punto medido ya está adentro de ese punto**,
  así que no puede netearse otra vez o el propio acto de fondear se lee como
  pérdida. Es la misma trampa que el filtro de flujos descartados del encabezado.
  `computeMWRSeries` de hecho ya abre cada subperíodo DESPUÉS del ancla, así que
  el gate es cinturón y tirantes: queda un test que lo fija, para que un cambio
  futuro en ese borde aparezca ahí y no como un retorno negativo en un portafolio
  que ganó.

### La comisión va en el denominador y SOLO ahí, en las tres superficies (FASE EC)
- **Reincidencia del error que el caso VITALI ya documenta.** Al mover el ancla del
  YTD levanté `startVal` al capital desembolsado (6,098). Eso pone la comisión en
  AMBOS lados: como pérdida en el numerador (6,240 − 6,098 = 142) y como base más
  grande. Da 2.33%, exactamente el número que CLAUDE.md advierte desde FASE DD.
  La forma correcta es la de las tarjetas: la ganancia mide contra el PRINCIPAL
  (240) y solo el divisor es el costo total (6,098) → 3.94%. Implementado como un
  override del denominador (`ytdCostBase`), nunca tocando `startVal`.
- **La gráfica cometía el mismo error por su cuenta.** Con la serie arrancando en 0
  (cuenta fundada dentro de la ventana), `growthPct` hacía
  `(growthAbs − investedBase) / investedBase` con `investedBase` = costo total:
  misma doble cobranza. Ahora el numerador resta el PRINCIPAL (costo total menos
  las comisiones de entrada del scope) y el divisor sigue siendo el costo total.
  De paso el monto en dólares mostraba `+$6,240.00` (el depósito completo) en un
  portafolio que ganó 240: ahora muestra la ganancia, no el aporte.
- **"Actualizado hace 1d" medía la edad del SNAPSHOT.** Un snapshot diario se
  escribe una vez al día, así que en el rato previo a que se escribiera el de hoy
  el banner decía "hace 1d" sobre un dashboard cuyos precios se acababan de
  refrescar. Ahora toma lo MÁS reciente entre el último refresco de precios y el
  último snapshot, con piso en 0.

### "Estimado" tampoco es "incierto" en la gráfica, y el denominador del YTD lleva la comisión (FASE EB)
- **La gráfica dibujaba punteado sobre datos completos.** `firstRealTs` marca dónde
  empieza el NAV real y todo lo anterior se trata como estimado: se dibuja
  punteado, el cambio se mide solo desde ahí, y la vista de Rendimiento se rebasea
  a esa región. Con un portafolio de puros activos ESTÁTICOS (un bono, un saldo
  bancario: sin precio de mercado propio) eso es falso — se mueven solo por
  eventos que ya tenemos en el archivo, así que rebobinarlos desde el saldo de hoy
  es EXACTO. Tres síntomas de una causa: línea punteada sobre información
  completa, "+0.00% desde 5 ago" (ventana de 2 días) y la gráfica de rendimiento
  vacía. `reconstructionIsExact` apaga `firstRealTs` en ese caso. Una posición con
  precio de mercado o sincronizada es lo contrario (mantener la cantidad de hoy
  hacia atrás sí asume algo que no sabemos) y ahí el framing de estimado se queda
  igual. Misma lección que FASE DS, una capa más arriba.
- **El YTD dividía entre el valor post-comisión.** Cuando el ancla se mueve al día
  en que entró el dinero, los depósitos hasta ahí se descartan (ya están dentro
  del valor de arranque). Pero esos depósitos SON el capital que lo creó, y pueden
  ser mayores que lo que compraron: 6,098 desembolsados por un bono de 6,000. Al
  dividir la ganancia del año entre 6,000 la comisión se perdona en silencio y el
  encabezado marcaba +4.00% mientras cada tarjeta por activo, dividiendo entre el
  costo total como manda la convención de CLAUDE.md, marcaba +3.94% sobre los
  mismos activos. Ahora `startVal` se levanta al total de los depósitos
  descartados cuando ese total es mayor.
- **Mismos decimales.** `AssetAllocation` imprimía 1 decimal y las otras dos
  superficies 2: el mismo retorno mostrado de tres formas no puede leerse como
  tres números. Todo a 2.
- **El refresh confirma que pasó algo.** `RefreshRing` hace un flash verde corto en
  su propio espacio al pasar de "cargando" a "listo"; sin eso el anillo
  simplemente desaparecía y nada te decía que la actualización llegó.

### Un wrapper que se come el id deja el depósito huérfano (FASE EA)
- **"sin vincular" no era cosmético.** `AddAccountModal` hace
  `const itemId = await onAdd(item)` y le pone `_linkedItemId: itemId` al DEPOSIT
  de apertura. Pero el wrapper de `onAdd` en el dashboard hacía `await addItem(item)`
  y NO devolvía el id, así que `itemId` salía `undefined` y el depósito nacía sin
  vínculo. La fila igual se ve (el editor de cuenta también empareja por símbolo),
  pero TODO motor que pregunta "¿qué explica este saldo?" indexa por
  `_linkedItemId`: `dataCompleteness` (por eso el finding de origen seguía
  saliendo), `indexBalanceEvents` (por eso la reconstrucción no bajaba el valor
  antes de la compra) y hasta el guard nuevo de FASE DZ. Un `return` faltante
  alimentaba media docena de síntomas.
- `unlinkedOpeningDeposits` (`lib/originDeposits.js`) repara lo que ya quedó
  escrito, pero SOLO lo inequívoco y de nuestra propia autoría:
  `_source:'manual_new_account'`, sin vínculo, y símbolo que empareja con
  EXACTAMENTE un ítem. Dos cuentas con el mismo símbolo (el mismo bono en dos
  brokers) se dejan en paz: adivinar ahí archiva el dinero contra la cuenta
  equivocada, que es peor que el badge.
- **La gráfica reconstruía con su propia copia del indexado.** `PortfolioGrowthChart`
  re-implementaba "qué transacción mueve qué saldo" y su copia solo alimentaba
  ítems tipo banco, así que el depósito de un bono nunca lo rebobinaba: la línea de
  valor daba +0.00% mientras la tarjeta de patrimonio, usando la otra copia, daba
  +4% sobre los mismos activos. Ahora las tres rutas (spreadsheet, YTD, gráfica)
  llaman a `indexBalanceEvents`, con `_flowClampZero` en las tres.
- **El anillo de carga cuenta etapas REALES** (`dataLoading`, `ratesLoading`,
  `pricesLoading`), nunca un temporizador disfrazado de progreso: una barra
  inventada que se arrastra al 90% y espera es la misma clase de mentira que un
  número inventado en una gráfica. `components/ui/RefreshRing.jsx`.

### El origen de una cuenta se registra UNA vez (FASE DZ)
- **"Capturar historia" / "Resolver" no tenía dedupe.** Escribe un DEPOSIT que el
  usuario declara YA incluido en el saldo: no mueve dinero, solo registra de
  dónde vino. Pero `addTransaction` le pone un nonce aleatorio al id de todo lo
  `manual*` (a propósito: dos aportes reales del mismo día no se pueden pisar),
  así que apretarlo en una cuenta cuyo origen ya está en el archivo lo archiva
  dos veces. FASE DP ya lo había señalado; DS y DU pusieron el botón en dos
  superficies más y lo volvieron fácil de tocar.
- **El guard NO es "nunca escribas un segundo depósito".** Aportar cada mes a la
  misma cuenta es normal y tiene que seguir funcionando. `isOriginFullyRecorded`
  (`lib/originDeposits.js`, puro, con tests) es más angosto: rechaza solo cuando
  los depósitos YA registrados cubren todo el saldo, porque entonces no queda
  dinero sin explicar que este pueda explicar. Es el mismo test que
  `lib/dataCompleteness.js` usa para decidir si preguntar, así que la pregunta y
  la respuesta no pueden contradecirse. Tolerancia de 1% para la comisión que
  viaja dentro del depósito de apertura (6,098 fundando un activo de 6,000).
- Cuando el guard corta, la pregunta igual queda contestada (`_newMoneyConfirmed`
  se estampa) y el modal lo dice: el usuario no se queda sin saber qué pasó.

### Los 240 del cupón no son capital invertido, y un overlay sin broker duplica todo (FASE DY)
- **Un ingreso que ATERRIZA en una cuenta no es capital que el usuario puso.**
  Un ítem tipo banco guarda su saldo en `purchasePrice` (ahí ESE es su costo, por
  diseño), así que cada cupón que caía en el Fondo Líquido subía el denominador
  del retorno. Los mismos 240 se contaban dos veces: como ingreso en el
  numerador y como capital en el denominador. Por eso "Rendimiento por
  institución" marcaba 240/6,338 = 3.79% mientras "Asignación de activos" (que
  solo ve el bono) marcaba 240/6,098 = 3.94%. `getIncomeReceivedByItem`
  (espejo de `getDividendIncomeByItem`: por cuenta que RECIBE, no por activo que
  produce) + `getInvestedCapital` lo restan del costo, y **las dos tarjetas usan
  el mismo helper**, así que agrupar por tipo y agrupar por institución no puede
  volver a divergir sobre los mismos activos.
- **El overlay de activos manuales solo existe para un snapshot que es del
  BROKER.** `PortfolioGrowthChart` le suma `staticAt(ts)` a los snapshots que no
  incluyen los activos manuales. Sin ninguna posición sincronizada en el
  portafolio no existe tal snapshot: cada fila ya es el patrimonio completo, así
  que sumarle esos activos otra vez duplica la cartera entera. Un portafolio de
  6,240 dibujaba una línea plana de 12,480 y un "drawdown" de −50% contra su
  propio valor real. Ahora el overlay exige `_source:'ibkr'` entre los ítems.
  Misma forma que el NAV huérfano de FASE DW, una capa más arriba.
- **La regla "snapshot anterior a que agregaras el activo" se compara por DÍA.**
  El `ts` de un snapshot es su fecha a medianoche UTC y `createdAt` es un momento
  de ese día, así que un snapshot escrito minutos DESPUÉS de agregar el activo
  (y que por lo tanto ya lo contiene) comparaba como "anterior" y recibía el
  overlay encima de sí mismo.
- **Un efecto no puede depender de identidades de arrays que cambian con cada
  tick de precio.** El cómputo del historial del spreadsheet dependía de `items`,
  `transactions`, `snapshots` y `lots`; cada refresco de precios los recrea, el
  efecto se re-ejecutaba y su cleanup cancelaba el fetch en vuelo, que retorna
  antes de apagar el spinner. Ahora depende de las MISMAS firmas de contenido que
  ya usaba el efecto de limpieza (`itemContentSig` excluye `currentPrice` a
  propósito), y el spinner se apaga ANTES de escribir el caché: los números ya
  están en pantalla en ese punto, y dejar que una cancelación a media escritura
  se saltara esa línea es lo que dejaba "Calculando historial..." pegado.

### Borrar una cuenta se lleva lo que solo esa cuenta explicaba (FASE DX)
- **De dónde salió el NAV huérfano de FASE DW.** `deleteItemGroup` (el borrado
  "Por cuenta" de Settings) borraba ítems, lots y transacciones, pero NUNCA un
  snapshot. `deleteAllItems({cascade:true})` sí los borra, así que el hueco solo
  aparecía al borrar UN grupo: las posiciones de IBKR se iban y su historial de
  NAV se quedaba describiendo una cuenta que el portafolio ya no tenía.
- **No todo snapshot es del portafolio.** Un NAV de broker es el saldo de UNA
  cuenta y un ancla de calibración es el arranque resuelto de UNA cuenta; un
  snapshot `daily` (o sin `_source`) mide TODO lo que el usuario tenía ese día,
  incluido lo que sobrevive al borrado. `orphanedAccountSnapshotIds`
  (`lib/accountCleanup.js`, puro, con tests) solo devuelve los del primer tipo.
- **La condición es "se fue el ÚLTIMO ítem de esa cuenta", no "se fue un ítem".**
  IBKR puede estar partido en varios grupos (API + archivo), así que borrar uno
  no puede llevarse el NAV que el otro todavía explica. Mismo criterio para el
  `_account` de las anclas de calibración, que aplica también a instituciones
  manuales (borrar el último ítem de IDC se lleva el ancla de IDC).
- El read-time guard de FASE DW (descartar NAV sincronizado huérfano) se queda:
  arregla la data que YA quedó sucia y cubre cualquier otro camino que deje un
  huérfano. Este arreglo evita ensuciarla de entrada. Los dos, no uno.

### Una serie de valor mide el MISMO portafolio que el netWorth (FASE DW)

Tres síntomas del mismo caso (IDC/VITALI), tres causas separadas. El hilo común:
**algo medía un portafolio distinto al que mide `netWorth`.**

- **Un NAV de broker huérfano inflaba todo al doble.** Un Flex Query que trae la
  sección NAV pero NO Open Positions deja snapshots `_source:'ibkr'` sin un solo
  ítem de IBKR en el portafolio. `augmentSnapshots` les sumaba encima los activos
  manuales, así que la serie marcaba 12,000 (5,760 del NAV huérfano + 6,240 real)
  contra un `netWorth` de 6,240: línea plana en 12K todo el año, "drawdown" falso
  de −48% al caer al valor de hoy, y una gráfica que se contradecía con su propio
  encabezado. Ahora un NAV **sincronizado** (`_source:'ibkr'`) se descarta cuando
  el portafolio no tiene ninguna posición de ese broker. **Solo `'ibkr'`, nunca
  `'ibkr_quarterly'`**: un trimestre transcrito a mano normalmente se escribe
  ANTES de importar posiciones (es el punto del flujo de Portfolio Analyst, FASE
  DL) y borrarlo destruiría trabajo recién hecho. Y solo con `items.length > 0`,
  para que un render antes de que carguen los ítems nunca borre historia real.
- **YTD en +0.00% con un cupón realmente cobrado.** Dos motores reconstruyen el
  pasado y solo uno sabía de cuentas destino: `lib/historicalValues.js` (el
  spreadsheet) indexa qué transacción mueve el saldo de qué ítem, incluyendo un
  dividendo ruteado por `incomeDestination`; la reconstrucción que pide
  `useDashboardData` a `/api/prices/portfolio-history` no. Así el Fondo Líquido
  se mantenía plano en 240 hasta enero, o sea el año "empezaba" con un ingreso
  que todavía no se había ganado: `start == end` → 0%. El indexado se extrajo a
  `indexBalanceEvents` (exportado, un solo lugar) y ahora alimenta las dos rutas.
  Con eso: enero = 6,000 (bono solo), hoy = 6,240 → **+4%**, que es el mismo
  número que ya mostraban AssetAllocation e InstitutionPerformance.
  **`_flowClampZero`:** el DEPOSIT de apertura puede ser MAYOR que el activo que
  fundó (trae la comisión: 6,098 para un bono de 6,000), así que rebobinar más
  atrás cae en −98. Eso no es "cuánto valía", es "todavía no existía", así que
  esos flujos van marcados y el API los pisa en 0. El ledger reconciliado del
  broker se queda igual: una línea de efectivo real SÍ puede ser negativa
  (margen).
- **"Calculando historial..." infinito y todos los meses en "-".** El efecto que
  computa el historial del spreadsheet tenía `historicalItems` en sus deps Y
  llamaba `setHistoricalItems`; cada escritura lo re-ejecutaba y su cleanup
  marcaba `cancelled` en el fetch en vuelo, que retorna ANTES de
  `setLoadingHistory(false)` y antes de estampar `lastFetchedYearRef`. Fetch que
  se reinicia para siempre. La barra del 70% de FASE DS tapaba esto por accidente
  (vaciaba `missingMonths` casi de inmediato); el chequeo por ítem lo destapó.
  Arreglado con `historicalItemsRef` (leer sin depender) + un `cacheEpoch` que el
  efecto de carga sube UNA vez, para conservar el paso "primero el caché" sin
  volver a meter la identidad del objeto en las dependencias.
  **Regla:** un efecto que escribe un estado no puede depender de ese estado si
  su cleanup cancela trabajo asíncrono. Bump a `SNAPSHOT_VERSION` (22): lo
  guardado durante el loop quedó a medias.

### El ancla del YTD tiene FECHA, y el capital invertido no se siembra dos veces (FASE DV)

Caso: bono manual (IDC/VITALI) comprado el 2026-01-06 por USD 6,000 con corretaje
de 98 y un cupón de 240. Tres números mentían al mismo tiempo, por tres causas
distintas. Vale la pena separarlas porque comparten un mismo patrón: **un valor y
su fecha se separaron**.

- **`YTD -$6,098 (-51%)` con el portafolio quieto.** `jan1Value` se define como
  "el primer punto de la serie YTD con total > 0", que NO siempre es el 1 de
  enero: un activo comprado a mitad de año hace que todos los puntos anteriores
  valgan 0 legítimamente, así que el primer punto real es el día en que entró el
  dinero. Pero el Dietz medía igual desde `yearStartTs`, así que restaba el
  DEPOSIT de 6,098 que había CREADO ese valor de arranque: `gain = 6000 − 6000 −
  6098` y denominador `6000 + 6098×0.977 ≈ 11,958` → exactamente el −51% de la
  captura. Arreglado con `jan1Ts`: el ancla viaja con su fecha, y cuando esa
  fecha se mueve hacia adelante los flujos anteriores o iguales a ella se
  descartan (`computeModifiedDietz` cuenta un flujo fechado justo en `startTs`,
  así que mover la ventana sola no bastaba). Mismo arreglo en el fallback de
  `returnSinceStart`.
  **No toca IBKR:** una posición con `_holdFlat` mantiene la cantidad plana hasta
  el 1 de enero, así que su primer punto con total > 0 YA es el 1 de enero y
  `startTs` no se mueve; y si hay snapshot real cerca de enero, esta rama ni
  corre.
- **"Invertido" marcando ~12.2K sobre 6,098 reales.** Dos siembras dobles en
  `contributionLine` (`PortfolioGrowthChart`): (a) el `entryFee` se sumaba como
  evento propio aunque el DEPOSIT de apertura de `AddAccountModal` YA lo trae
  adentro (`principal + entryFee`, tag `_source:'manual_new_account'`) — mismo
  motivo por el que ya se saltaba el modo `'deducted'`, otro lugar donde la
  comisión ya está contada; (b) la semilla era `chartData[0].value`, que es la
  respuesta correcta para una posición que ANTECEDE la ventana (una cuenta IBKR
  cuyo ledger de depósitos solo llega 365 días atrás: su valor el día uno ES el
  capital cuyos flujos no vemos), pero es falsa cuando nada la antecede: ahí el
  valor del borde izquierdo existe solo porque la reconstrucción mantiene plana
  hacia atrás la posición de hoy, y los depósitos que la fundaron se suman
  ADEMÁS como eventos. Ahora la semilla es 0 salvo que algún ítem del scope
  pueda haber existido antes (`shouldHoldFlat`, sin fecha, o fecha anterior);
  `shouldHoldFlat` es justo el helper que marca las fechas no confiables de
  IBKR, así que esas cuentas conservan la semilla vieja.
- **Un aviso de broker en un activo sin broker.** El banner de "historial corto"
  usaba `primaryBrokerId === 'ibkr' || primaryBrokerId == null`, así que un scope
  SIN broker sincronizado (`null`) caía en la rama de IBKR: un bono tecleado a
  mano terminaba leyendo "IDC: ... En IBKR: Flex Queries → Period ..." más una
  línea forense contando secciones XML que nunca tuvo. Todo remedio que ofrece
  ese aviso es una acción de broker (ensanchar un Flex Query, subir el export),
  así que sin broker sincronizado no tiene nada verdadero que decir: ahora el
  bloque entero exige `primaryBrokerId != null`. Un activo estático mantenido
  plano entre sus propios eventos rastreados no es un hueco de sincronización
  (ver FASE DS), y mandar al usuario a IBKR a arreglarlo es simplemente falso.
- **Un cupón backfilleado contra una cuenta destino en CERO.** FASE DI decidió
  que un cupón de un mes ya cerrado no acredita el saldo del destino, porque el
  saldo que el usuario escribió es una foto de HOY y ya lo contiene
  (`_destinationCredited:false`). Esa suposición es seguramente falsa en un solo
  caso: saldo 0. Una cuenta vacía no puede "ya contener" 240. El Fondo Líquido
  creado junto al activo que lo alimenta (abierto en 0) cayó justo ahí: la
  transacción existía y se veía al abrir la cuenta, pero el saldo seguía en 0, y
  el spreadsheet (que reconstruye rebobinando desde el saldo) mostraba 0 en TODOS
  los meses. `creditableBackfills` (puro, con tests) lo acredita después del
  hecho y voltea el flag para que una limpieza posterior sí revierta un crédito
  que ahora sí ocurrió. **A propósito solo `balance <= 0`**, nunca "el saldo se
  ve chico": un saldo tecleado de 100 contra un cupón de 240 es genuinamente
  ambiguo (¿salieron 140, o el 100 está viejo?) y adivinar ahí reabre el
  doble-crédito que este flag existe para evitar. Cero no es ambiguo.
  Bump a `SNAPSHOT_VERSION` (21): los meses cacheados se calcularon desde un
  saldo de 0.

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
