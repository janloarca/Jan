// La lista de "qué podés hacer en el tablero" vivía escrita TRES veces, y ya
// habían divergido: el menú "+Nuevo" del header (5 opciones), la tarjeta
// ACCIONES (8 opciones en 2 grupos) y el panel "Más" del nav móvil (su propia
// mezcla de navegación y acciones, con su propia razón de ser documentada
// ahí). Solo DOS de los cinco items del header tenían un equivalente exacto
// en la tarjeta (agregar, importar); el resto de la tarjeta no existía en el
// header en absoluto. Es la misma enfermedad que este repo ya documenta para
// InfoTip y lib/transferTx.js: una copia por pantalla es como una se queda
// atrás sin que nadie lo note hasta que dos superficies dicen cosas distintas
// sobre la misma acción.
//
// Esta función es la ÚNICA definición. El header y la tarjeta ACCIONES la
// llaman con sus propios handlers (lo que no se pasa, no aparece: cada ítem
// requiere su callback) y arman SU propio markup — este módulo no sabe de
// JSX ni de `Tile`/estilos, solo devuelve los tres grupos de datos.
//
// El nav móvil (MobileNav.jsx) NO consume esto a propósito: mezcla enlaces de
// navegación con acciones por una razón ya documentada ahí (el FAB grande ya
// va directo a agregar/guiado, y el panel "Más" es el único lugar alcanzable
// para completar información en un teléfono) — forzarlo a esta forma sería
// una tercera cosa distinta disfrazada de la misma.
//
// `record`: lo que ya pasó y se quiere dejar registrado.
// `data`: traer datos de un broker, o revisar/completar lo que falta.
// `extra`: entradas que solo el header ofrece hoy (el recorrido guiado de
//   primeros pasos, y el acceso a completar información vía EnrichModal) —
//   viven aparte porque no tienen hueco natural en los dos grupos de arriba.
import {
  DollarSign, Plus, TrendingDown, ArrowLeftRight,
  Upload, RefreshCw, ClipboardCheck, Bell,
  Sparkles, Compass,
} from 'lucide-react'
import { journeyProgressLabel } from './ibkrJourney'

export function dashboardActionGroups({
  lang = 'es',
  onCashFlow, onAddAccount, onSell, onTransfer,
  onImport, onIntegrations, onReview, onPriceAlerts,
  onGuided, onEnrich,
  alertCount = 0, enrichGapCount = 0,
  ibkrSyncStatus, ibkrLastSync, ibkrNeedsAttention = false, ibkrProgress = null,
} = {}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  // Mismo semáforo que ya usaban la barra vieja, el pill del header y el
  // banner superior: UNA sola regla (ibkrNeedsAttention) decide si algo
  // merece alarma, para que el punto de esta fila nunca pueda discrepar.
  const hasSyncIndicator = ibkrNeedsAttention || (ibkrSyncStatus === 'ok' && ibkrLastSync)
  const syncDotColor = ibkrNeedsAttention ? 'var(--text-negative)'
    : ibkrSyncStatus === 'ok' && ibkrLastSync && !isNaN(new Date(ibkrLastSync).getTime()) && Date.now() - new Date(ibkrLastSync).getTime() < 2 * 60 * 60 * 1000 ? 'var(--accent-green)'
    : ibkrSyncStatus === 'ok' ? 'var(--accent-orange)' : null

  // Solo cuando el viaje ARRANCÓ y todavía le falta algo: un panel de 0% sobre
  // alguien que nunca conectó nada no describe un pendiente suyo, y uno al
  // 100% no tiene nada que decir que la frase genérica no diga mejor.
  const ibkrSetupLabel = ibkrProgress && ibkrProgress.started && !ibkrProgress.complete
    ? `Interactive Brokers: ${journeyProgressLabel(ibkrProgress, lang)}`
    : null

  const record = [
    onCashFlow && {
      key: 'cashflow', icon: DollarSign, onClick: onCashFlow,
      label: t('Registrar movimiento', 'Record a movement'),
      desc: t('Depósito, retiro o interés cobrado', 'Deposit, withdrawal or interest received'),
    },
    onAddAccount && {
      // "Agregar posición" y no "Agregar o comprar": es el mismo nombre que
      // CommandPalette ya usa para este mismo handler (N → add). Antes el
      // header y la paleta de comandos coincidían y la tarjeta decía otra
      // cosa; ahora las tres dicen lo mismo.
      key: 'add', icon: Plus, onClick: onAddAccount,
      label: t('Agregar posición', 'Add position'),
      desc: t('Cuenta, acción, bono o cripto', 'Account, stock, bond or crypto'),
    },
    onSell && {
      key: 'sell', icon: TrendingDown, onClick: onSell,
      label: t('Vender', 'Sell'),
      desc: t('Registrar la venta de una posición', 'Record the sale of a position'),
    },
    onTransfer && {
      key: 'transfer', icon: ArrowLeftRight, onClick: onTransfer,
      label: t('Transferir', 'Transfer'),
      desc: t('Mover dinero entre tus cuentas', 'Move money between your accounts'),
    },
  ].filter(Boolean)

  const data = [
    onImport && {
      key: 'import', icon: Upload, onClick: onImport,
      label: t('Importar', 'Import'),
      desc: t('Archivo o captura de tu broker', 'File or screenshot from your broker'),
    },
    onIntegrations && {
      key: 'sync', icon: RefreshCw, onClick: onIntegrations,
      label: t('Conectar y sincronizar', 'Connect and sync'),
      // Un problema de sincronización gana sobre "te falta un paso": el punto
      // rojo ya está diciendo algo más urgente y dos mensajes compitiendo en
      // dos líneas de la misma fila es cómo se dejan de leer los dos.
      desc: ibkrSetupLabel && !ibkrNeedsAttention
        ? ibkrSetupLabel
        : t('Tu broker, al día solo', 'Your broker, updated on its own'),
      dot: hasSyncIndicator ? syncDotColor : null,
    },
    onReview && {
      key: 'review', icon: ClipboardCheck, onClick: onReview,
      label: t('Revisar datos', 'Review data'),
      desc: t('Completar lo que falta', 'Fill in what is missing'),
    },
    onPriceAlerts && {
      key: 'alerts', icon: Bell, onClick: onPriceAlerts,
      label: t('Alertas de precio', 'Price alerts'),
      desc: alertCount > 0
        ? t(`${alertCount} ${alertCount === 1 ? 'activa' : 'activas'}`, `${alertCount} active`)
        : t('Avisarme si un activo cruza un precio', 'Notify me when an asset crosses a price'),
      badge: alertCount > 0 ? alertCount : null,
    },
  ].filter(Boolean)

  const extra = [
    onGuided && {
      key: 'guided', icon: Compass, onClick: onGuided,
      label: t('Guíame paso a paso', 'Walk me through it'),
      desc: t('Te preguntamos qué tienes', 'We ask what you have'),
    },
    // Completar lo que ya está acá vive junto a las formas de agregar algo
    // nuevo: las dos contestan "mis datos no están completos". Antes era una
    // línea chica debajo del número de YTD, donde se leía como una queja
    // sobre la cifra.
    onEnrich && {
      key: 'enrich', icon: Sparkles, onClick: onEnrich,
      label: t('Completar información', 'Complete your data'),
      desc: enrichGapCount > 0
        ? t(`${enrichGapCount} ${enrichGapCount === 1 ? 'hueco' : 'huecos'} por llenar`, `${enrichGapCount} ${enrichGapCount === 1 ? 'gap' : 'gaps'} to fill`)
        : t('Fechas, costos y movimientos', 'Dates, costs and movements'),
      badge: enrichGapCount > 0 ? enrichGapCount : null,
    },
  ].filter(Boolean)

  return { record, data, extra }
}
