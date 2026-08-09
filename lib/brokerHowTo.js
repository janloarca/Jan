// Researched, step-by-step "how do I actually get this" instructions per broker,
// for both the CSV/Excel import path and the API-key connection path. Single
// source of truth consumed by FileImportModal (CSV upload step) and
// ConnectionsModal (API connect step) — one broker, one set of facts, instead of
// the one-line summaries that used to live separately in each component.
//
// Each `steps` entry is a short, imperative, bilingual instruction meant to be
// rendered as ONE numbered line — not a paragraph. The optional `detail` pair
// holds the "why" / gotchas: BrokerSteps renders it behind a per-step expander
// so the default view stays a clean checklist. `note` is an optional caveat
// below the list (a limitation, a format gotcha, a "why" worth flagging).
//
// Sourced from each broker's own current help docs / product UI where reachable
// (see FASE BN commit message for search queries); a few smaller/regional
// platforms (Bitso's exact CSV path) rely on the vendor's general "activity/
// history" pattern rather than a fetched help article, since their help center
// blocks automated fetches — flagged as best-effort in the note where relevant.

export const BROKER_HOWTO = {
  ibkr: {
    name: 'Interactive Brokers', icon: '🏦',
    csv: {
      steps: [
        { es: 'En IBKR entra a "Performance & Reports" → "Flex Queries"', en: 'In IBKR go to "Performance & Reports" → "Flex Queries"',
          detail: { es: 'No uses "Statements" → "Activity": ese formato no trae el valor diario de la cuenta, solo posiciones y trades.', en: 'Do not use "Statements" → "Activity": that format has no daily account value, only positions and trades.' } },
        { es: 'Crea un "Activity Flex Query" con las secciones: Open Positions, Trades, Cash Transactions, Cash Report y Net Asset Value (NAV) in Base', en: 'Create an "Activity Flex Query" with the sections: Open Positions, Trades, Cash Transactions, Cash Report and Net Asset Value (NAV) in Base',
          detail: { es: 'La sección NAV trae el valor diario de tu cuenta: sin ella el historial y el % de retorno arrancan en blanco. En portales antiguos aparece como "Equity Summary by Report Date in Base": es la misma sección. Dentro de "Cash Transactions", marca el tipo "Deposits & Withdrawals" (o "Select All"): agregar la sección no basta si ese tipo queda sin marcar, y sin esos movimientos tus depósitos se cuentan como ganancia en los retornos.', en: 'The NAV section brings your daily account value: without it the history and the % return chart start blank. On older portals it shows as "Equity Summary by Report Date in Base": it is the same section. Inside "Cash Transactions", tick the "Deposits & Withdrawals" type (or "Select All"): adding the section is not enough if that type stays unticked, and without those movements your deposits count as gains in your returns.' } },
        { es: 'En "Open Positions" pon "Level of Detail" en "Lots" y marca "Open Date Time"', en: 'Under "Open Positions" set "Level of Detail" to "Lots" and tick "Open Date Time"',
          detail: { es: 'Así cada posición llega con su fecha real de compra.', en: 'That way every position arrives with its real purchase date.' } },
        { es: 'Período: "Custom Date Range" desde hace un año hasta hoy, en formato XML', en: 'Period: "Custom Date Range" from a year ago to today, in XML format',
          detail: { es: 'El tope de 365 días es de IBKR, no nuestro, y es por CUENTA, no por archivo: no existe un rango que llegue más atrás, ni pidiendo un año calendario distinto ni con varios archivos.', en: 'The 365-day cap is IBKR\'s, not ours, and it is per ACCOUNT, not per file: no range reaches further back, not by asking for a different calendar year and not with several files.' } },
        { es: 'Descarga el archivo y súbelo aquí', en: 'Download the file and upload it here' },
        { es: 'Para lo que quede fuera de esos ~365 días, transcríbelo: "Portfolio Analyst" → "Holdings" → "Since Inception" + "Quarterly", quita los benchmarks y copia el valor de cada trimestre', en: 'For whatever falls outside those ~365 days, transcribe it: "Portfolio Analyst" → "Holdings" → "Since Inception" + "Quarterly", remove the benchmarks and copy each quarter\'s value',
          detail: { es: 'Portfolio Analyst SÍ muestra toda tu historia, pero solo como gráfica: no hay exportación detrás. Son unos 4 números por año y solo el total de la cuenta, sin desglosar por acción. Chispu tiene una pantalla para escribirlos.', en: 'Portfolio Analyst DOES show your whole history, but only as a picture: there is no export behind it. It is about 4 numbers per year, and only the account total, no per-position breakdown. Chispu has a screen to type them in.' } },
        { es: 'Al final, escribe los retornos que IBKR te muestra hoy (1W, 1M, 3M, YTD, 1Y y desde el inicio)', en: 'Finally, type the returns IBKR shows you today (1W, 1M, 3M, YTD, 1Y and since inception)',
          detail: { es: 'Cada porcentaje ancla la curva en su fecha, así que lo que quede estimado entre medio se apoya en números reales de tu broker en vez de en una reconstrucción nuestra.', en: 'Each percentage anchors the curve at its own date, so whatever stays estimated in between leans on real numbers from your broker instead of on a reconstruction of ours.' } },
      ],
      note: { es: 'Un Flex Query solo alcanza los últimos ~365 días, sin importar el rango que pidas: es un límite de IBKR por cuenta, no por archivo. Todo lo anterior de esa ventana se transcribe una vez desde Portfolio Analyst. Al terminar, el resumen final te dice cuántos días de historial de valor se importaron. Si dice 0, al archivo le falta la sección "Net Asset Value (NAV) in Base": vuelve a generarlo incluyéndola.', en: 'A Flex Query only reaches the last ~365 days, no matter what range you request: it is IBKR\'s limit per account, not per file. Anything older than that window gets transcribed once from Portfolio Analyst. When done, the final summary tells you how many days of value history were imported. If it says 0, the file is missing the "Net Asset Value (NAV) in Base" section: generate it again including it.' },
    },
    api: {
      steps: [
        { es: 'En IBKR: "Performance & Reports" → "Flex Queries"', en: 'In IBKR: "Performance & Reports" → "Flex Queries"' },
        { es: 'Crea un "Activity Flex Query" con: Open Positions, Trades, Cash Transactions, Cash Report y Net Asset Value (NAV) in Base', en: 'Create an "Activity Flex Query" with: Open Positions, Trades, Cash Transactions, Cash Report and Net Asset Value (NAV) in Base',
          detail: { es: 'La sección NAV trae el valor diario de tu cuenta. En portales antiguos aparece como "Equity Summary by Report Date in Base": es la misma sección. Dentro de "Cash Transactions", marca el tipo "Deposits & Withdrawals" (o "Select All"): agregar la sección no basta si ese tipo queda sin marcar, y sin esos movimientos tus depósitos se cuentan como ganancia en los retornos.', en: 'The NAV section brings your daily account value. On older portals it shows as "Equity Summary by Report Date in Base": it is the same section. Inside "Cash Transactions", tick the "Deposits & Withdrawals" type (or "Select All"): adding the section is not enough if that type stays unticked, and without those movements your deposits count as gains in your returns.' } },
        { es: 'En "Open Positions" pon "Level of Detail" en "Lots" y marca "Open Date Time"', en: 'Under "Open Positions" set "Level of Detail" to "Lots" and tick "Open Date Time"',
          detail: { es: 'Así cada posición llega con su fecha real de compra, aunque el período sea corto.', en: 'That way every position arrives with its real purchase date, even if the period is short.' } },
        { es: 'Período: "Last 365 Calendar Days"', en: 'Period: "Last 365 Calendar Days"',
          detail: { es: 'Es el máximo real que IBKR entrega, así que no hace falta tocar el rango a mano: cada sync trae los ~365 días vigentes en ese momento, ventana que se renueva sola.', en: 'It is the real maximum IBKR hands over, so there is no need to touch the range by hand: each sync brings whatever the trailing ~365 days are at that moment, a window that renews itself.' } },
        { es: 'Genera el Token con el engranaje ⚙ junto a "Flex Web Service" (misma página)', en: 'Generate the Token with the gear ⚙ next to "Flex Web Service" (same page)' },
        { es: 'El Query ID es el número junto a tu query en la lista', en: 'The Query ID is the number next to your query in the list' },
      ],
      note: { es: 'Solo lectura: el token no puede operar ni mover dinero. Un Flex Query alcanza como máximo ~365 días atrás desde hoy: es un límite de IBKR por cuenta, no por archivo, así que no hay forma de pedir un rango más viejo ni con la API ni con archivos. Para historial más viejo, transcribe los trimestres desde Portfolio Analyst.', en: 'Read-only: the token cannot trade or move money. A Flex Query reaches at most ~365 days back from today: it is IBKR\'s limit per account, not per file, so there is no way to request an older range either via the API or via files. For older history, transcribe the quarters from Portfolio Analyst.' },
    },
  },

  hapi: {
    name: 'Hapi', icon: '📲',
    csv: {
      steps: [
        { es: 'Abre la app de Hapi', en: 'Open the Hapi app' },
        { es: 'Ve al menú → "Reportes" (o "Banca" → "Reportes")', en: 'Go to Menu → "Reports" (or "Banking" → "Reports")' },
        { es: 'Descarga el estado de cuenta mensual más reciente (PDF, generado por Apex Clearing)', en: 'Download the most recent monthly account statement (PDF, generated by Apex Clearing)' },
        { es: 'Sube ese PDF aquí mismo: Chispu lo lee con IA', en: 'Upload that PDF right here: Chispu reads it with AI',
          detail: { es: 'Chispu lo convierte a nuestra plantilla y tú revisas y confirmas cada dato antes de que se importe nada.', en: 'Chispu converts it to our template and you review and confirm every value before anything is imported.' } },
      ],
      note: { es: 'Hapi no tiene exportación a CSV/Excel, solo PDF. Por eso Chispu lee el PDF directamente. Si el PDF pesa más de 3MB o prefieres no usar IA, abajo tienes el prompt manual para convertirlo con tu propia IA.', en: 'Hapi has no CSV/Excel export, only PDF. That is why Chispu reads the PDF directly. If the PDF is over 3MB or you prefer not to use AI, the manual prompt below converts it with your own AI.' },
    },
    api: null,
  },

  etoro: {
    name: 'eToro', icon: '📈',
    csv: {
      steps: [
        { es: 'Entra a eToro → "Portfolio" → "Portfolio History"', en: 'Go to eToro → "Portfolio" → "Portfolio History"' },
        { es: 'Click el ícono de configuración (⚙) arriba a la derecha → "Account Statement"', en: 'Click the settings icon (⚙) top right → "Account Statement"' },
        { es: 'Elige el rango de fechas con "Custom"', en: 'Choose the date range with "Custom"',
          detail: { es: 'Pon una fecha bien atrás para traer TODO tu historial, no solo el período reciente.', en: 'Set a date far back to bring your FULL history, not just the recent period.' } },
        { es: 'Click "Create" para generar el reporte', en: 'Click "Create" to generate the report' },
        { es: 'Descarga en formato XLS y súbelo aquí', en: 'Download in XLS format and upload it here' },
      ],
      note: { es: 'Si el rango no cubre todos tus años en eToro, el reporte llega incompleto.', en: 'If the range doesn\'t cover all your years on eToro, the report comes out incomplete.' },
    },
    api: {
      steps: [
        { es: 'Tu cuenta de eToro debe estar verificada (si no, la opción de API no aparece)', en: 'Your eToro account must be verified (otherwise the API option won\'t show up)' },
        { es: 'Ve a Configuración/Settings → API', en: 'Go to Settings → API' },
        { es: 'Genera tu API Key y User Key', en: 'Generate your API Key and User Key' },
      ],
      note: { es: 'eToro abrió su API pública en 2026; si no ves la opción, completa primero la verificación de identidad de tu cuenta.', en: 'eToro opened its public API in 2026; if you don\'t see the option, finish your account\'s identity verification first.' },
    },
  },

  alpaca: {
    name: 'Alpaca Markets', icon: '🦙',
    csv: {
      steps: [
        { es: 'Entra a tu Dashboard de Alpaca', en: 'Go to your Alpaca Dashboard' },
        { es: 'Ve a "Portfolio" (o "History" para movimientos)', en: 'Go to "Portfolio" (or "History" for transactions)' },
        { es: 'Busca el botón de exportar/descargar y elige CSV', en: 'Look for the export/download button and choose CSV' },
      ],
      note: null,
    },
    api: {
      steps: [
        { es: 'Entra a tu Dashboard de Alpaca', en: 'Go to your Alpaca Dashboard' },
        { es: 'Confirma que estás en el entorno correcto: "Paper" (prueba) o "Live" (real), cada uno tiene sus propias keys', en: 'Confirm you\'re in the right environment: "Paper" (test) or "Live" (real), each has its own keys' },
        { es: 'En el menú lateral, entra a "API Keys"', en: 'In the sidebar, go to "API Keys"' },
        { es: 'Click "Generate New Key" y guarda el Key ID y el Secret Key: el secret solo se muestra una vez', en: 'Click "Generate New Key" and save the Key ID and Secret Key: the secret is only shown once' },
      ],
      note: null,
    },
  },

  schwab: {
    name: 'Charles Schwab', icon: '🇺🇸',
    csv: {
      steps: [
        { es: 'Entra a Schwab.com → pestaña "Accounts" → "Positions"', en: 'Go to Schwab.com → "Accounts" tab → "Positions"' },
        { es: 'Elige la cuenta específica en el dropdown (una cuenta a la vez)', en: 'Pick the specific account from the dropdown (one account at a time)' },
        { es: 'Click "Export" (o "Actions" → "Export" → .csv) y súbelo aquí', en: 'Click "Export" (or "Actions" → "Export" → .csv) and upload it here' },
      ],
      note: { es: 'Si usas thinkorswim en vez de la web de Schwab, el flujo es distinto.', en: 'If you use thinkorswim instead of the Schwab website, the flow is different.' },
    },
    api: { steps: [{ es: 'Conecta tu cuenta Schwab por OAuth: se abre una ventana de autorización de Schwab, no necesitas copiar ninguna clave', en: 'Connect your Schwab account via OAuth: a Schwab authorization window opens, no key to copy' }], note: null },
  },

  fidelity: {
    name: 'Fidelity', icon: '🇺🇸',
    csv: {
      steps: [
        { es: 'Entra a Fidelity.com → "Accounts & Trade" → "Account Positions"', en: 'Go to Fidelity.com → "Accounts & Trade" → "Account Positions"' },
        { es: 'Selecciona UNA cuenta específica (no se puede exportar varias cuentas juntas)', en: 'Select ONE specific account (you can\'t export several accounts together)' },
        { es: 'En la pestaña "Positions", confirma que el filtro "Show" está en "Open Positions"', en: 'On the "Positions" tab, confirm the "Show" filter is set to "Open Positions"' },
        { es: 'Click los tres puntos (···) arriba a la derecha → "Download"', en: 'Click the three dots (···) top right → "Download"' },
      ],
      note: { es: 'Si tienes varias cuentas en Fidelity, repite esto por cada una.', en: 'If you have several Fidelity accounts, repeat this for each one.' },
    },
    api: null,
  },

  vanguard: {
    name: 'Vanguard', icon: '🇺🇸',
    csv: {
      steps: [
        { es: 'Entra a Vanguard → "My Accounts"', en: 'Go to Vanguard → "My Accounts"' },
        { es: 'Para posiciones: "Gains & Losses" → "Cost Basis" → botón de descarga arriba a la derecha', en: 'For positions: "Gains & Losses" → "Cost Basis" → download button top right' },
        { es: 'Para movimientos: "My Accounts" → "Transaction History" → "Download" → elige formato CSV, rango de fechas y cuentas', en: 'For transactions: "My Accounts" → "Transaction History" → "Download" → choose CSV format, date range and accounts' },
      ],
      note: { es: 'Vanguard limita el historial de transacciones a los últimos 18 meses, y "Cost Basis" solo aplica a cuentas gravables.', en: 'Vanguard limits transaction history to the last 18 months, and "Cost Basis" only applies to taxable accounts.' },
    },
    api: null,
  },

  degiro: {
    name: 'DEGIRO', icon: '🇪🇺',
    csv: {
      steps: [
        { es: 'Entra a DEGIRO → "Cartera" (Portfolio)', en: 'Go to DEGIRO → "Portfolio"' },
        { es: 'Click "Exportar" a la derecha', en: 'Click "Export" on the right' },
        { es: 'Elige fecha y formato: XLS, CSV o PDF', en: 'Choose date and format: XLS, CSV or PDF' },
        { es: 'Para movimientos: menú → "Actividad" → "Transacciones" → "Exportar"', en: 'For transactions: menu → "Activity" → "Transactions" → "Export"',
          detail: { es: 'Elige el rango completo desde la apertura de la cuenta para traer todo tu historial.', en: 'Pick the full range since account opening to bring your full history.' } },
      ],
      note: { es: 'No abras el CSV en Excel antes de subirlo: Excel puede cambiar el formato de números/fechas y romper la importación. Súbelo tal cual lo descargaste.', en: 'Don\'t open the CSV in Excel before uploading it: Excel can change the number/date format and break the import. Upload it exactly as downloaded.' },
    },
    api: null,
  },

  trading212: {
    name: 'Trading 212', icon: '📊',
    csv: {
      steps: [
        { es: 'En la app o web de Trading 212, ve a Menú → "History"', en: 'In the Trading 212 app or web, go to Menu → "History"' },
        { es: 'Toca el ícono de exportar', en: 'Tap the export icon' },
        { es: 'Elige qué incluir (órdenes, dividendos, transacciones) y el rango de fechas', en: 'Choose what to include (orders, dividends, transactions) and the date range' },
        { es: 'Descarga el CSV', en: 'Download the CSV' },
      ],
      note: { es: 'No funciona para cuentas CFD. Si necesitas más de 2 años, exporta un archivo por año calendario.', en: 'Doesn\'t work for CFD accounts. If you need more than 2 years, export one file per calendar year.' },
    },
    api: null,
  },

  traderepublic: {
    name: 'Trade Republic', icon: '🇩🇪',
    csv: {
      steps: [
        { es: 'Abre la app de Trade Republic → ícono de perfil arriba a la derecha', en: 'Open the Trade Republic app → profile icon top right' },
        { es: 'Entra a "Actividad" (Activity) → "Extractos" (Statements)', en: 'Go to "Activity" → "Statements"' },
        { es: 'Busca "Extracto de cuenta" (Account Statement)', en: 'Look for "Account Statement"' },
        { es: 'Pon una fecha de inicio bien atrás (ej. 01/01/2015) y hoy como fecha final, para traer todo tu historial', en: 'Set a start date far back (e.g. 01/01/2015) and today as the end date, to bring your full history' },
      ],
      note: { es: 'Trade Republic entrega PDF; súbelo aquí directamente y Chispu lo lee con IA. También puedes usar un conversor de PDF a Excel y subir el CSV.', en: 'Trade Republic delivers a PDF; upload it right here and Chispu reads it with AI. You can also use a PDF-to-Excel converter and upload the CSV.' },
    },
    api: null,
  },

  webull: {
    name: 'Webull', icon: '📱',
    csv: {
      steps: [
        { es: 'En Webull, ve a tu historial de órdenes/transacciones', en: 'In Webull, go to your orders/transaction history' },
        { es: 'Toca el ícono de descarga (flecha hacia abajo) arriba a la derecha', en: 'Tap the download icon (arrow pointing down) top right' },
        { es: 'Confirma: Webull te envía el CSV por correo al email registrado de tu cuenta', en: 'Confirm: Webull emails you the CSV at your account\'s registered email' },
      ],
      note: { es: 'Clientes de Webull UK: es distinto. Cuenta → Documentos → Estado de cuenta → elige rango → descarga CSV.', en: 'Webull UK clients: it\'s different. Account → Documents → Statement → choose range → download CSV.' },
    },
    api: null,
  },

  coinbase: {
    name: 'Coinbase', icon: '🟠',
    csv: {
      steps: [
        { es: 'Entra a Coinbase → ícono de perfil → "Settings" → "Reports"', en: 'Go to Coinbase → profile icon → "Settings" → "Reports"' },
        { es: 'Genera un nuevo reporte de transacciones (elige el rango de fechas)', en: 'Generate a new transaction report (choose the date range)' },
        { es: 'Descarga el CSV cuando esté listo', en: 'Download the CSV when it\'s ready' },
      ],
      note: null,
    },
    api: {
      steps: [
        { es: 'Coinbase → ícono de perfil → "Settings" → "API" (barra lateral)', en: 'Coinbase → profile icon → "Settings" → "API" (sidebar)' },
        { es: 'Click "Create API key"', en: 'Click "Create API key"' },
        { es: 'Portfolio: "Default". Permiso: "View" (solo lectura, NO trading)', en: 'Portfolio: "Default". Permission: "View" (read-only, NOT trading)' },
        { es: 'Agrega tu IP a la whitelist si te la pide', en: 'Add your IP to the whitelist if asked' },
        { es: 'Confirma con tu verificación en 2 pasos y guarda el API Secret: solo se muestra una vez', en: 'Confirm with your 2-step verification and save the API Secret: it\'s only shown once' },
      ],
      note: null,
    },
  },

  kraken: {
    name: 'Kraken', icon: '🦑',
    csv: {
      steps: [
        { es: 'Entra a Kraken → "History" (historial)', en: 'Go to Kraken → "History"' },
        { es: 'Elige el tipo de historial (Trades, Ledger) y el rango de fechas', en: 'Choose the history type (Trades, Ledger) and date range' },
        { es: 'Click "Export" y descarga el CSV', en: 'Click "Export" and download the CSV' },
      ],
      note: null,
    },
    api: {
      steps: [
        { es: 'Kraken → ícono de perfil arriba a la derecha → "Security" → pestaña "API"', en: 'Kraken → profile icon top right → "Security" → "API" tab' },
        { es: 'Click "Create API key"', en: 'Click "Create API key"' },
        { es: 'Dale un nombre descriptivo y deja SOLO permisos de consulta (sin retiros, sin trading)', en: 'Give it a descriptive name and leave ONLY query permissions (no withdrawals, no trading)' },
        { es: 'Click "Generate key" y guarda el API Key y la Private Key', en: 'Click "Generate key" and save the API Key and Private Key' },
      ],
      note: { es: 'Opcional pero recomendado: restringe la key a tu IP y ponle fecha de expiración.', en: 'Optional but recommended: restrict the key to your IP and set an expiration date.' },
    },
  },

  binance: {
    name: 'Binance', icon: '🟡',
    csv: {
      steps: [
        { es: 'Entra a Binance → "Wallet" → "Spot"', en: 'Go to Binance → "Wallet" → "Spot"' },
        { es: 'Busca "Export" o "Transaction History" y elige el rango de fechas', en: 'Look for "Export" or "Transaction History" and choose the date range' },
        { es: 'Descarga el CSV', en: 'Download the CSV' },
      ],
      note: null,
    },
    api: {
      steps: [
        { es: 'Binance → ícono de perfil → "API Management"', en: 'Binance → profile icon → "API Management"' },
        { es: 'Click "Create API"', en: 'Click "Create API"' },
        { es: 'Verifica por email y/o teléfono para generar la key', en: 'Verify via email and/or phone to generate the key' },
        { es: 'Por defecto queda en "Enable Reading" (solo lectura): no actives permisos de trading ni retiros', en: 'It defaults to "Enable Reading" (read-only): don\'t enable trading or withdrawal permissions' },
        { es: 'Recomendado: click "Restrict access to trusted IPs only" y agrega tu IP', en: 'Recommended: click "Restrict access to trusted IPs only" and add your IP' },
      ],
      note: null,
    },
  },

  bitso: {
    name: 'Bitso', icon: '🟢',
    csv: {
      steps: [
        { es: 'Entra a Bitso (web o app) → "Actividad" / "Historial"', en: 'Go to Bitso (web or app) → "Activity" / "History"' },
        { es: 'Filtra por fecha y tipo de movimiento', en: 'Filter by date and transaction type' },
        { es: 'Busca la opción de descarga/exportar de esa pantalla', en: 'Look for the download/export option on that screen' },
      ],
      note: { es: 'Bitso no publica pasos exactos de exportación en su centro de ayuda público; si no encuentras el botón de descarga, sube tu estado en PDF aquí (Chispu lo lee con IA), o usa el prompt manual de abajo con capturas de tus movimientos.', en: 'Bitso doesn\'t publish exact export steps in its public help center; if you can\'t find the download button, upload your statement PDF here (Chispu reads it with AI), or use the manual prompt below with screenshots of your transactions.' },
    },
    api: {
      steps: [
        { es: 'Bitso → "API" (en configuración de tu cuenta)', en: 'Bitso → "API" (in your account settings)' },
        { es: 'Crea una nueva key', en: 'Create a new key' },
        { es: 'Requiere verificación en 2 pasos (2FA)', en: 'Requires 2-step verification (2FA)' },
        { es: 'Deja solo permisos de lectura', en: 'Leave only read permissions' },
      ],
      note: null,
    },
  },
}

export function getBrokerHowTo(brokerId) {
  return BROKER_HOWTO[brokerId] || null
}
