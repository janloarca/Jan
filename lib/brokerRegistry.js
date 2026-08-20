// Shared registry of broker/platform integrations. Consumed by the Connections
// hub (UI) and by the delete-all-data flow (disconnect every configured sync).
// `t(es, en)` resolves the bilingual labels at call time.

export const getBrokerRegistry = (t = (es) => es) => [
  { id: 'alpaca', name: 'Alpaca Markets', icon: '🦙', category: 'traditional', hasApi: true, fields: [
    { key: 'apiKey', label: 'API Key', placeholder: 'PK...' },
    { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', type: 'password' },
  ], instructions: { es: 'Ve a tu cuenta Alpaca → Paper/Live → API Keys → Generar', en: 'Go to Alpaca account → Paper/Live → API Keys → Generate' } },
  { id: 'schwab', name: 'Charles Schwab', icon: '🇺🇸', category: 'traditional', hasApi: true, authType: 'oauth', fields: [], instructions: { es: 'Conecta tu cuenta Schwab via OAuth. Se abrirá una ventana de autorización.', en: 'Connect your Schwab account via OAuth. An authorization window will open.' } },
  { id: 'etoro', name: 'eToro', icon: '📈', category: 'traditional', hasApi: true, fields: [
    { key: 'apiKey', label: 'API Key (x-api-key)', placeholder: 'Tu API key' },
    { key: 'userKey', label: 'User Key (x-user-key)', placeholder: 'Tu user key' },
  ], instructions: { es: 'Ve a eToro → Configuración → API → Generar keys', en: 'Go to eToro → Settings → API → Generate keys' } },
  { id: 'tradestation', name: 'TradeStation', icon: '🖥️', category: 'traditional', hasApi: true, authType: 'oauth', fields: [], instructions: { es: 'Conecta tu cuenta TradeStation via OAuth. Requiere cuenta con $10k mínimo.', en: 'Connect your TradeStation account via OAuth. Requires $10k minimum funded account.' } },
  { id: 'tastytrade', name: 'Tastytrade', icon: '🇺🇸', category: 'traditional', hasApi: true, apiNote: 'Session', fields: [
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
  ], instructions: { es: 'Ingresa tu usuario y contraseña de Tastytrade.', en: 'Enter your Tastytrade username and password.' } },
  { id: 'saxo', name: 'Saxo Bank', icon: '🏦', category: 'traditional', hasApi: true, authType: 'oauth', fields: [], instructions: { es: 'Conecta tu cuenta Saxo Bank via OAuth. Ambiente sim disponible.', en: 'Connect your Saxo Bank account via OAuth. Sim environment available.' } },
  { id: 'ig', name: 'IG Markets', icon: '🇬🇧', category: 'traditional', hasApi: true, apiNote: 'API Key + Session',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'text' },
      { key: 'username', label: 'Username', type: 'text' },
      { key: 'password', label: 'Password', type: 'password' },
    ],
    instructions: { es: 'Genera tu API key en My IG → Settings → API. Ingresa tu usuario y contraseña.', en: 'Generate your API key at My IG → Settings → API. Enter your username and password.' }
  },
  { id: 'hapi', name: 'Hapi', icon: '📲', category: 'traditional', hasApi: false, apiNote: t('Estado de cuenta', 'Statement'),
    instructions: { es: 'Hapi no tiene API. Descarga tu estado de cuenta en la app (Banca → Reportes). Si puedes exportarlo en CSV/Excel, impórtalo aquí; si solo es PDF, agrega tus posiciones manualmente marcando la institución "Hapi".', en: 'Hapi has no API. Download your statement in the app (Banking → Reports). If you can export it as CSV/Excel, import it here; if it\'s only PDF, add your positions manually tagging the institution "Hapi".' } },
  { id: 'degiro', name: 'DEGIRO', icon: '🇪🇺', category: 'traditional', hasApi: false, apiNote: t('No oficial', 'Unofficial'), fields: [] },
  { id: 'trading212', name: 'Trading 212', icon: '📊', category: 'traditional', hasApi: false, apiNote: t('Limitado', 'Limited'), fields: [] },
  { id: 'traderepublic', name: 'Trade Republic', icon: '🇩🇪', category: 'traditional', hasApi: false, apiNote: t('No oficial', 'Unofficial'), fields: [] },
  { id: 'lightyear', name: 'Lightyear', icon: '💡', category: 'traditional', hasApi: false },
  { id: 'fidelity', name: 'Fidelity', icon: '🇺🇸', category: 'traditional', hasApi: false },
  { id: 'vanguard', name: 'Vanguard', icon: '🇺🇸', category: 'traditional', hasApi: false },
  { id: 'webull', name: 'Webull', icon: '📱', category: 'traditional', hasApi: false, apiNote: t('Partner', 'Partner') },
  { id: 'm1finance', name: 'M1 Finance', icon: '🇺🇸', category: 'traditional', hasApi: false },
  { id: 'revolut', name: 'Revolut Investments', icon: '💳', category: 'traditional', hasApi: false },
  { id: 'myinvestor', name: 'MyInvestor', icon: '🇪🇸', category: 'traditional', hasApi: false },
  { id: 'dukascopy', name: 'Dukascopy', icon: '🇨🇭', category: 'traditional', hasApi: false },
  { id: 'ppiglobal', name: 'PPI Global', icon: '🇦🇷', category: 'traditional', hasApi: false, apiNote: t('API oficial', 'Official API') },
  { id: 'tdameritrade', name: 'TD Ameritrade', icon: '🇺🇸', category: 'traditional', hasApi: false, apiNote: '→ Schwab' },
  { id: 'binance', name: 'Binance', icon: '🟡', category: 'crypto', hasApi: true, fields: [
    { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
    { key: 'apiSecret', label: 'Secret Key', placeholder: '••••••••', type: 'password' },
  ], instructions: { es: 'Ve a Binance → API Management → Crear API → Solo lectura', en: 'Go to Binance → API Management → Create API → Read-only' } },
  { id: 'coinbase', name: 'Coinbase', icon: '🟠', category: 'crypto', hasApi: true, fields: [
    { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
    { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', type: 'password' },
  ], instructions: { es: 'Ve a Coinbase → Settings → API → New API Key → Portfolio read', en: 'Go to Coinbase → Settings → API → New API Key → Portfolio read' } },
  { id: 'kraken', name: 'Kraken', icon: '🦑', category: 'crypto', hasApi: true, fields: [
    { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
    { key: 'apiSecret', label: 'Private Key', placeholder: '••••••••', type: 'password' },
  ], instructions: { es: 'Ve a Kraken → Security → API → Create Key → Solo consulta', en: 'Go to Kraken → Security → API → Create Key → Query only' } },
  { id: 'bitso', name: 'Bitso', icon: '🟢', category: 'crypto', hasApi: true, fields: [
    { key: 'apiKey', label: 'API Key', placeholder: 'Tu API key' },
    { key: 'apiSecret', label: 'API Secret', placeholder: '••••••••', type: 'password' },
  ], instructions: { es: 'Ve a Bitso → API → Crear key → 2FA requerido', en: 'Go to Bitso → API → Create key → 2FA required' } },
]

// One-line "what happens and why it's safe" shown ABOVE a broker's setup
// instructions, derived from how it authenticates. Read-only + encrypted is the
// invariant across all of them; the mechanism differs (OAuth vs API key vs file).
export function connectorExplainer(broker, t = (es) => es) {
  if (!broker) return ''
  if (broker.authType === 'oauth') {
    return t('Te llevamos a la página de tu broker para autorizar el acceso de SOLO LECTURA. Nunca vemos tu contraseña.',
             'We send you to your broker to authorize READ-ONLY access. We never see your password.')
  }
  if (broker.hasApi) {
    return t('Generas una clave de SOLO LECTURA en tu broker y la pegas aquí. La guardamos cifrada; nunca podemos operar ni mover tu dinero.',
             'You generate a READ-ONLY key at your broker and paste it here. We store it encrypted; we can never trade or move your money.')
  }
  return t('Este broker no tiene API. Exporta tu estado de cuenta e impórtalo, o agrégalo manualmente.',
           'This broker has no API. Export your statement and import it, or add it manually.')
}

// Every sync the user may have configured, disconnected in one sweep. Used when
// the user deletes ALL their data — an emptied account must not keep a live
// broker connection silently re-importing positions. Clears each API broker's
// stored credentials plus the IBKR Flex vault. Failures are swallowed per
// broker (best effort): a broker API being down must not block the wipe.
export async function disconnectAllSyncs(authFetch) {
  const brokers = getBrokerRegistry().filter((b) => b.hasApi)
  const calls = [
    ...brokers.map((b) =>
      authFetch(`/api/brokers/${b.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-credentials' }),
      })
    ),
    authFetch('/api/brokers/ibkr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-credentials', token: null, queryId: null }),
    }),
    // Blockchain.com is a hardcoded card in ConnectionsModal, not a registry entry, so
    // it was missed here AND had no disconnect button: its encrypted API key survived
    // "delete all my data" and could never be removed from the UI.
    authFetch('/api/brokers/blockchain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save-credentials', apiKey: null }),
    }),
  ]
  await Promise.allSettled(calls)
}

// The full set of client-settings fields tied to an IBKR connection: the
// legacy token mirror plus every auto-sync status/error field. Any code path
// that disconnects IBKR (delete-all, the Connections modal's own "Desvincular"
// button) must clear ALL of these together — clearing only the token/queryId
// leaves _ibkrAutoSyncErrorCode set, so the top-of-dashboard error banner
// (driven by that field) keeps showing "IBKR bloqueó tu token" forever even
// after the user disconnected and has no intention of reconnecting.
export const IBKR_DISCONNECTED_FIELDS = {
  ibkrToken: null, ibkrQueryId: null, _ibkrVaultMigrated: null,
  _ibkrLastSync: null, _ibkrLastAutoSync: null, _ibkrLastAutoSyncAttempt: null,
  _ibkrAutoSyncStatus: null, _ibkrAutoSyncError: null, _ibkrAutoSyncErrorCode: null,
  // FASE GQ: when a first connection was saved but never confirmed by a
  // successful sync. A full disconnect must clear it too, or a reconnect
  // inherits a stale clock and could cross the 5-business-day grace period
  // (FASE HX; see ibkrNeedsAttention, app/dashboard/page.jsx) before it even
  // retries once. (Belt and suspenders since FASE HX: onSaveCredentialsPending
  // now re-stamps the clock on every save anyway.)
  _ibkrConnectedAt: null,
  // El contador de fallos seguidos (lib/ibkrRetryPolicy.js). Sin limpiarlo, una
  // cuenta que se desconecta con 3 fallos encima vuelve a conectarse ya en la
  // cadencia larga de 12 horas: el usuario acaba de teclear credenciales
  // nuevas y su primer sync automático tardaría medio día en llegar.
  _ibkrAutoSyncFailCount: null,
}
