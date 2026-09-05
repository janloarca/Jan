'use client'

import { Upload, Plus, ArrowLeftRight, Share2, Download, RefreshCw, ClipboardCheck, DollarSign, TrendingDown, Bell } from 'lucide-react'
import { journeyProgressLabel } from '@/lib/ibkrJourney'
import { InfoTip } from '../ui/Tooltip'

// Todas las acciones del dashboard en UN marco, cada una con una línea que
// dice PARA QUÉ sirve. Antes eran una barra de botones sueltos con etiquetas
// de una palabra ("Movimiento", "Agregar") debajo de las tarjetas, y un
// usuario reportó que no sabía dónde registrar una transacción o una venta:
// "Movimiento" no dice que ahí van los depósitos y retiros, y VENDER no
// existía en absoluto fuera de la fila de cada posición en la tabla de
// activos. Mismo lenguaje visual que el menú "New" del header (icono +
// etiqueta + descripción), que ya resolvía este problema para agregar.
//
// Los dos grupos separan las dos preguntas distintas que trae el usuario:
// "pasó algo y lo quiero registrar" contra "quiero traer o revisar datos".
// Compartir/Exportar quedan como texto al pie: son salidas, no registros, y
// compiten por atención con lo que la gente de verdad viene a hacer.
// ⛔ Tile y GroupLabel viven FUERA del componente, y no es estilo.
//
// Definidos dentro del render, su identidad es NUEVA en cada render, así que
// React los ve como otro tipo de componente y DESMONTA Y REMONTA su nodo del
// DOM cada vez. Si eso cae entre el mousedown y el mouseup (o entre el
// touchstart y el touchend), el nodo que recibió el toque ya no existe cuando
// se suelta y el CLICK NUNCA LLEGA: el usuario tiene que tocar varias veces.
//
// Y en este tablero pasa seguido, porque re-renderiza solo con cada tick de
// precios. Medido en el navegador con el mecanismo aislado: 40 de 40 clics
// perdidos con el componente adentro, 0 de 40 con el componente afuera.
const Tile = ({ a }) => (
  <button type="button" onClick={a.onClick}
    className="relative w-full flex items-start gap-2.5 p-2.5 rounded-xl border text-left transition-colors hover:bg-theme-elevated min-w-0"
    style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--card-border)' }}>
    <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' }}>
      <a.icon size={15} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-body font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.label}</span>
      <span className="block text-micro leading-snug" style={{ color: 'var(--text-muted)' }}>{a.desc}</span>
    </span>
    {a.dot && (
      <span className="absolute top-2 right-2 w-2 h-2 rounded-full pulse-dot" style={{ backgroundColor: a.dot }} />
    )}
    {a.badge != null && !a.dot && (
      <span className="text-micro font-semibold px-1.5 py-0.5 rounded shrink-0"
        style={{ color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}>
        {a.badge}
      </span>
    )}
  </button>
)

const GroupLabel = ({ children }) => (
  <span className="block text-micro uppercase tracking-wider font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
    {children}
  </span>
)

export default function QuickActionsCard({
  onImport, onAddAccount, onTransfer, onCashFlow, onSell, onPriceAlerts,
  onExport, onShare, onIntegrations, onReview,
  itemCount = 0, alertCount = 0, lang = 'es',
  ibkrSyncStatus, ibkrLastSync, ibkrNeedsAttention = false,
  // El avance de los requisitos del broker (lib/ibkrJourney.js). Sin esto,
  // quien abandonaba el viaje a mitad no tenía NADA que se lo recordara: el
  // estado del viaje vive en memoria (se pierde al cerrar la pestaña) y el
  // banner de arriba solo habla de sincronizaciones que FALLAN, así que un
  // setup a medias era indistinguible de uno terminado. Esta baldosa ya es la
  // puerta a ese panel: lo único que faltaba era que nombrara lo que hay
  // detrás, sin agregar una alarma nueva por algo que no es urgente.
  ibkrProgress = null,
}) {
  const t = (es, en) => (lang === 'es' ? es : en)

  // Mismo semáforo que usaban la barra vieja, el pill del header y el banner:
  // una sola regla (ibkrNeedsAttention) decide si algo merece alarma.
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
      key: 'add', icon: Plus, onClick: onAddAccount,
      label: t('Agregar o comprar', 'Add or buy'),
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
      // dos líneas de la misma baldosa es cómo se dejan de leer los dos.
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


  // Mismo marco (p-4) y mismo encabezado (punto + título en mayúsculas +
  // InfoTip) que AssetAllocation / InstitutionPerformance: las cuatro cards de
  // esta zona comparten inset y tipografía, así que sus contenidos alinean
  // sobre el mismo borde izquierdo. h-full + mt-auto en el pie para que las
  // dos columnas terminen en la misma línea.
  return (
    <div data-tour="actions" className="card p-4 sm:p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="card-title">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent-blue-soft)' }} />
          {t('ACCIONES', 'ACTIONS')}
        </h3>
        <InfoTip text={t(
          'Todo lo que podés hacer con tu portafolio. Arriba lo que ya pasó y querés dejar registrado (un depósito, una compra, una venta, dinero movido entre tus cuentas); abajo, traer datos de tu broker o revisar lo que falte.',
          'Everything you can do with your portfolio. Above, what already happened and you want on record (a deposit, a purchase, a sale, money moved between your accounts); below, bringing in broker data or reviewing what is missing.'
        )} />
      </div>

      {record.length > 0 && (
        <div className="mb-4">
          <GroupLabel>{t('Registrar lo que pasó', 'Record what happened')}</GroupLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {record.map((a) => <Tile key={a.key} a={a} />)}
          </div>
        </div>
      )}

      {data.length > 0 && (
        <div>
          <GroupLabel>{t('Traer y revisar datos', 'Bring in and review data')}</GroupLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.map((a) => <Tile key={a.key} a={a} />)}
          </div>
        </div>
      )}

      {/* Salidas: no son registros, así que no compiten con los de arriba. */}
      <div className="flex items-center gap-3 flex-wrap mt-auto pt-3" style={{ borderTop: '1px solid var(--glass-border)' }}>
        {onShare && (
          <button type="button" onClick={onShare} className="flex items-center gap-1.5 text-caption transition-colors hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
            <Share2 size={13} /> {t('Compartir', 'Share')}
          </button>
        )}
        {onExport && (
          <button type="button" onClick={onExport} className="flex items-center gap-1.5 text-caption transition-colors hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
            <Download size={13} /> {t('Exportar', 'Export')}
          </button>
        )}
        <span className="ml-auto text-caption" style={{ color: 'var(--text-muted)' }}>
          {t('Activos', 'Assets')}: {itemCount}
        </span>
      </div>
    </div>
  )
}
