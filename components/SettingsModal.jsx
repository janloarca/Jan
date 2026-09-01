'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import {
  Settings, Building2, Users, X, SlidersHorizontal, Share2, Database, Palette,
  ToggleLeft, Bell, GraduationCap, Link2, Download, AlertTriangle, ChevronDown,
  Trash2, CheckCircle2, User,
} from 'lucide-react'
import EntityManager from '@/components/dashboard/EntityManager'
import { authFetch, safeJson } from '@/lib/authFetch'
import { isNotificationSupported, getNotificationPermission, requestNotificationPermission } from '@/lib/notifications'
import { BENCHMARKS } from '@/hooks/useBenchmark'
import { disconnectAllSyncs, IBKR_DISCONNECTED_FIELDS } from '@/lib/brokerRegistry'
import { useEdgeFade } from '@/hooks/useEdgeFade'
import { isFirestoreQuotaError } from '@/lib/firestoreErrors'
import BusyLabel from '@/components/ui/BusyLabel'
import FinanceWipePanel from '@/components/settings/FinanceWipePanel'
import ShareTab from '@/components/settings/ShareTab'

const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'MXN', name: 'Peso Mexicano', symbol: '$' },
  { code: 'GTQ', name: 'Quetzal', symbol: 'Q' },
  { code: 'COP', name: 'Peso Colombiano', symbol: '$' },
  { code: 'CLP', name: 'Peso Chileno', symbol: '$' },
  { code: 'ARS', name: 'Peso Argentino', symbol: '$' },
  { code: 'BRL', name: 'Real Brasileño', symbol: 'R$' },
  { code: 'PEN', name: 'Sol Peruano', symbol: 'S/' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: '$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
]

// Framed group used throughout the General tab — a hairline-bordered card with
// a small icon+label header, so related controls (theme+language, the two
// toggles+currency, notification prefs) read as one visual unit instead of a
// continuous scroll of same-weight rows. Purely presentational: no state.
function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="rounded-xl border p-4 space-y-3.5" style={{ borderColor: 'var(--card-border)' }}>
      <div className="flex items-center gap-1.5">
        <Icon size={13} strokeWidth={2.5} style={{ color: 'var(--text-muted)' }} />
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

// The two on/off preference rows (Beginner mode, Friends) shared identical
// markup with only the icon/copy/state differing — pulled into one component
// so the visual treatment can never drift between the two.
function ToggleCard({ active, onClick, icon: Icon, title, description }) {
  return (
    <button
      type="button" role="switch" aria-checked={active} onClick={onClick}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg border transition-all text-left"
      style={active
        ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' }
        : { borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-input)' }}>
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon && <Icon size={16} strokeWidth={2} className="shrink-0 mt-0.5" style={{ color: active ? 'var(--accent-blue)' : 'var(--text-muted)' }} />}
        <div className="min-w-0">
          <div className="text-sm font-medium" style={active ? undefined : { color: 'var(--text-primary)' }}>{title}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{description}</div>
        </div>
      </div>
      <span className="shrink-0 w-10 h-6 rounded-full flex items-center transition-all px-0.5"
        style={{ backgroundColor: active ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }}>
        <span className="w-5 h-5 rounded-full bg-white transition-transform"
          style={{ transform: active ? 'translateX(16px)' : 'translateX(0)' }} />
      </span>
    </button>
  )
}

export default function SettingsModal({ onClose, settings, onSaveSettings, onDeleteAllItems, onDeleteAllSnapshots, onDeleteAllTransactions, onDeleteAllFinanceTransactions, onDeleteFinanceTransactionsByIds, financeTransactions = [], onDeleteItemGroup, onExportBackup, onOpenConnections, entities, onAddEntity, onUpdateEntity, onDeleteEntity, theme, onToggleTheme, beginnerMode = false, onToggleBeginner, lang = 'es', onSetLang, portfolioItems = [], userEmail = '', profile = null, onSaveProfile, userDisplayName = '', portfolios = [], activePortfolio = '__all__' }) {
  const trapRef = useFocusTrap()
  const [baseCurrency, setBaseCurrency] = useState(settings?.baseCurrency || 'USD')
  const [benchmarkSymbol, setBenchmarkSymbol] = useState(settings?.benchmarkSymbol || '%5EGSPC')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [tab, setTab] = useState('general')
  const [saveStatus, setSaveStatus] = useState(null)
  const [friendsEnabled, setFriendsEnabled] = useState(settings?.friendsEnabled !== false)
  // Per-category notification prefs. Absent = on, mirrors friendsEnabled's default.
  const NOTIF_CATEGORIES = [
    { key: 'notifMaturity', es: 'Vencimientos', en: 'Maturities' },
    { key: 'notifDividend', es: 'Dividendos recibidos', en: 'Dividends received' },
    { key: 'notifValuation', es: 'Valuaciones desactualizadas', en: 'Outdated valuations' },
    { key: 'notifPriceAlerts', es: 'Alertas de precio', en: 'Price alerts' },
  ]
  const [notifPrefs, setNotifPrefs] = useState(() =>
    Object.fromEntries(NOTIF_CATEGORIES.map((c) => [c.key, settings?.[c.key] !== false]))
  )
  const toggleNotifCategory = async (key) => {
    const next = { ...notifPrefs, [key]: !notifPrefs[key] }
    setNotifPrefs(next)
    try {
      await onSaveSettings({ [key]: next[key] })
    } catch (e) {
      setNotifPrefs(notifPrefs) // revert on failure
      flash('err', e.message || t('Error al guardar', 'Error saving'))
    }
  }

  // FASE HZ. Correos periódicos. Las tres cadencias son INDEPENDIENTES: cada
  // una lleva contenido distinto, así que activar una no condiciona a las
  // otras. Mensual y anual se muestran deshabilitadas hasta que existan: un
  // interruptor que se puede encender y no hace nada es peor que uno ausente.
  const EMAIL_CADENCES = [
    { key: 'notifyWeekly', es: 'Resumen semanal', en: 'Weekly brief',
      descEs: 'Tu semana y el año, más el estado del mercado. Domingos.',
      descEn: 'Your week and your year, plus market levels. Sundays.',
      ready: true },
    { key: 'notifyMonthly', es: 'Resumen mensual', en: 'Monthly brief',
      descEs: 'Tu mes y el año, con el reporte YTD y el spreadsheet de enero al mes cubierto. Día 1.',
      descEn: 'Your month and your year, with the YTD report and the January-to-date spreadsheet. On the 1st.',
      ready: true },
    { key: 'notifyAnnual', es: 'Resumen anual', en: 'Annual brief',
      descEs: 'El cierre del año, con su reporte y el spreadsheet completo. 1 de enero.',
      descEn: 'The year close, with its report and the full-year spreadsheet. January 1st.',
      ready: true },
    // El único que habla de OTRAS personas y no de vos, por eso es una
    // suscripción aparte y no una sección del semanal: querer ver cómo va el
    // grupo no implica querer el reporte del propio portafolio.
    { key: 'notifyFriendsWeekly', es: 'Posiciones de tus grupos', en: 'Group standings',
      descEs: 'Cómo va cada grupo de Amigos y en qué puesto quedaste. Domingos.',
      descEn: 'How each of your friend groups is doing and where you placed. Sundays.',
      ready: true },
  ]
  const [emailPrefs, setEmailPrefs] = useState(() =>
    Object.fromEntries(EMAIL_CADENCES.map((c) => [c.key, settings?.[c.key] === true]))
  )
  // FASE IE9. El estado inicial se calcula UNA vez, así que si `settings`
  // todavía no había llegado cuando el modal se montó (o si la lectura de
  // Firestore falló, p.ej. con la cuota diaria agotada), los interruptores se
  // quedaban en apagado para siempre mostrando lo contrario de lo que hay
  // guardado: el usuario cree que no está suscrito cuando sí lo está
  // (reporte real con captura). La firma de las banderas es la única
  // dependencia: cuando el valor guardado cambia, el interruptor lo refleja.
  const emailSig = EMAIL_CADENCES.map((c) => (settings?.[c.key] === true ? '1' : '0')).join('')
  useEffect(() => {
    setEmailPrefs(Object.fromEntries(EMAIL_CADENCES.map((c) => [c.key, settings?.[c.key] === true])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailSig])

  // ⛔ Y los OTROS CUATRO controles sembrados de `settings`, que aquel arreglo
  // dejó atrás. Es el mismo defecto exacto: `useState` corre una sola vez, así
  // que si `settings` no llegó al montar el modal —o si su lectura FALLÓ, que
  // es justo lo que produjo el reporte de FASE IE9: la cuota diaria de la base
  // agotada— el control se queda mostrando su default contra lo que de verdad
  // hay guardado, para toda esa apertura.
  //
  // Los tres primeros MIENTEN sobre el estado: los cuatro interruptores de aviso
  // y el de Amigos tienen default ENCENDIDO (`!== false`), así que a quien los
  // apagó le dicen que están prendidos.
  //
  // El cuarto además ESCRIBE: `handleSave` persiste `{baseCurrency,
  // benchmarkSymbol}` desde este estado, o sea con `settings` sin llegar,
  // apretar Guardar le reemplaza la moneda base real por USD. Y la moneda base
  // no es cosmética: es contra la que se convierte cada cifra de la app.
  //
  // Se resiembra solo cuando cambia el valor GUARDADO, nunca en cada render,
  // que es el mismo criterio con el que los cuatro campos de identidad de abajo
  // no pisan lo que el usuario está tecleando.
  const notifSig = NOTIF_CATEGORIES.map((c) => (settings?.[c.key] !== false ? '1' : '0')).join('')
  useEffect(() => {
    setNotifPrefs(Object.fromEntries(NOTIF_CATEGORIES.map((c) => [c.key, settings?.[c.key] !== false])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifSig])

  const savedFriendsEnabled = settings?.friendsEnabled !== false
  useEffect(() => { setFriendsEnabled(savedFriendsEnabled) }, [savedFriendsEnabled])

  const savedBaseCurrency = settings?.baseCurrency || 'USD'
  useEffect(() => { setBaseCurrency(savedBaseCurrency) }, [savedBaseCurrency])

  const savedBenchmark = settings?.benchmarkSymbol || '%5EGSPC'
  useEffect(() => { setBenchmarkSymbol(savedBenchmark) }, [savedBenchmark])

  // FASE KB. Tu nombre, para la portada del reporte PDF y para Amigos. Vive en
  // `settings/profile` (doc aparte de las preferencias) y hasta ahora SOLO se
  // podía escribir desde el lápiz de la tarjeta de Amigos, que además se
  // esconde entera cuando esa pestaña está apagada: quien nunca pasó por ahí
  // no tenía ninguna forma de guardarlo, y su reporte salía sin nombre.
  //
  // Guarda con el MISMO `onSaveProfile` que usa Amigos, nunca con una función
  // nueva: los dos escriben el mismo doc y el mismo campo, así que no pueden
  // divergir. Y con el campo vacío se ofrece el `displayName` de la cuenta
  // como valor inicial: eso MATERIALIZA ese nombre en `settings/profile`, que
  // es el único lugar que el servidor lee (el cron no tiene el registro de
  // Auth a mano), en vez de dejarlo como una segunda fuente que consultar.
  const savedName = typeof profile?.name === 'string' ? profile.name : ''
  // FASE KP. La identidad de ASESOR (firma, teléfono, correo) vive en el MISMO
  // doc `settings/profile` y se guarda con el MISMO `onSaveProfile` (merge):
  // cero writers nuevos. Alimenta el "Preparado por" y el bloque de contacto
  // de los links compartidos con clientes; vacío = no se muestra nada.
  const savedFirm = typeof profile?.advisorFirm === 'string' ? profile.advisorFirm : ''
  const savedPhone = typeof profile?.advisorPhone === 'string' ? profile.advisorPhone : ''
  const savedEmail = typeof profile?.advisorEmail === 'string' ? profile.advisorEmail : ''
  const [nameDraft, setNameDraft] = useState(savedName || userDisplayName || '')
  const [firmDraft, setFirmDraft] = useState(savedFirm)
  const [phoneDraft, setPhoneDraft] = useState(savedPhone)
  const [emailDraft, setEmailDraft] = useState(savedEmail)
  const [savingName, setSavingName] = useState(false)
  // Misma lección que los interruptores de correo de arriba: el estado inicial
  // se calcula UNA vez, así que si el perfil todavía no había llegado al montar
  // (o su lectura falló) el campo se quedaría vacío mostrando lo contrario de
  // lo que hay guardado. Solo se resiembra cuando cambia el valor GUARDADO,
  // para no pisar lo que el usuario está tecleando.
  useEffect(() => {
    setNameDraft(savedName || userDisplayName || '')
  }, [savedName, userDisplayName])
  useEffect(() => { setFirmDraft(savedFirm) }, [savedFirm])
  useEffect(() => { setPhoneDraft(savedPhone) }, [savedPhone])
  useEffect(() => { setEmailDraft(savedEmail) }, [savedEmail])
  const [testingEmail, setTestingEmail] = useState(null) // la cadencia en vuelo, o null
  const [testResult, setTestResult] = useState(null)
  // El error crudo del servidor se muestra tal cual (es lo que ahorra rondas
  // de diagnóstico), salvo cuando es un límite de la base de datos: ahí el
  // texto es un código gRPC que no le dice nada a nadie y encima se resuelve
  // solo, así que se traduce a qué pasó y qué hacer.
  const humanizeSendError = (raw) => {
    const s = String(raw || '')
    if (isFirestoreQuotaError(s)) {
      return t(
        'Se alcanzó el límite diario de la base de datos (cada prueba lee todo tu portafolio). Se reinicia solo en unas horas; el envío automático no depende de este botón.',
        'The database hit its daily limit (each test reads your whole portfolio). It resets on its own within hours; the scheduled email does not depend on this button.',
      )
    }
    return s || t('No se pudo enviar', 'Could not send')
  }
  const handleTestEmail = async (cadence = 'weekly') => {
    setTestingEmail(cadence)
    setTestResult(null)
    try {
      const res = await authFetch('/api/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadence }),
      })
      const data = await safeJson(res)
      if (res.ok) {
        // El diagnóstico del envío AUTOMÁTICO: la prueba y el cron comparten
        // todo menos cómo se encuentra a los suscriptores, y esa pieza es
        // justamente la que puede fallar sola (FASE IF).
        const cl = data?.cronLookup
        // El fallback (userScan) funciona, pero significa que la consulta
        // rápida está fallando: el motivo suele traer el enlace exacto para
        // crear el índice que falta, y esconderlo sería dejar el problema de
        // raíz sin arreglar detrás de un mensaje en verde (FASE IF3).
        const slow = cl?.via === 'userScan'
          ? t(` Está usando el camino lento porque la consulta rápida falla: ${cl.error || 'sin detalle'}`, ` It is using the slow path because the fast query fails: ${cl.error || 'no detail'}`)
          : ''
        const auto = cl
          ? (cl.includesYou
            ? t(` El envío automático te encuentra correctamente (vía ${cl.via}).`, ` The scheduled send finds you correctly (via ${cl.via}).`) + slow
            : t(` OJO: el envío automático NO te encuentra (${cl.error || 'revisa que el interruptor esté encendido'}).`, ` HEADS UP: the scheduled send does NOT find you (${cl.error || 'check the toggle is on'}).`))
          : ''
        // Cuándo corrió el cron por última vez: sin este dato, "no me llegó"
        // no distingue entre un cron que nunca se ejecutó y uno que sí corrió
        // pero no envió (FASE IF2).
        const lr = data?.lastCronRun
        // QUÉ cadencia tocaba esa corrida. El cron ya lo escribía y el
        // diagnóstico lo descartaba, así que "corrió y no me llegó el mensual"
        // no se distinguía de "corrió y el mensual no tocaba ese día": son dos
        // conclusiones opuestas. Una lista vacía SÍ es una respuesta, y por eso
        // se dice en vez de omitirse.
        const cad = Array.isArray(lr?.cadences)
          ? (lr.cadences.length
            ? t(` Tocaba: ${lr.cadences.join(', ')}.`, ` Due: ${lr.cadences.join(', ')}.`)
            : t(' Ese día no tocaba ninguna cadencia.', ' No cadence was due that day.'))
          : ''
        const runMsg = lr?.at
          ? t(` Última corrida automática: ${new Date(lr.at).toLocaleString()} (${lr.result || 'sin detalle'}).`,
              ` Last scheduled run: ${new Date(lr.at).toLocaleString()} (${lr.result || 'no detail'}).`) + cad
          : t(' El envío automático NUNCA ha corrido todavía.', ' The scheduled send has NEVER run yet.')
        setTestResult({
          ok: !cl || cl.includesYou,
          msg: t(`Enviado a ${data?.sentTo || userEmail}. Revisa tu bandeja (y spam).`, `Sent to ${data?.sentTo || userEmail}. Check your inbox (and spam).`) + auto + runMsg,
        })
      } else {
        // El mensaje del servidor SMTP se muestra tal cual: si Zoho rechaza la
        // autenticación, verlo aquí ahorra una ronda de logs. La excepción es
        // la cuota de la base de datos, que llega como "8 RESOURCE_EXHAUSTED:
        // Quota exceeded" (código gRPC): nadie puede accionar sobre eso sin
        // saber que es un límite DIARIO que se reinicia solo.
        setTestResult({ ok: false, msg: humanizeSendError(data?.error) })
      }
    } catch (e) {
      setTestResult({ ok: false, msg: humanizeSendError(e.message) })
    } finally {
      setTestingEmail(null)
    }
  }

  const toggleEmailCadence = async (key) => {
    const next = { ...emailPrefs, [key]: !emailPrefs[key] }
    setEmailPrefs(next)
    try {
      // El correo se captura al suscribirse (igual que el recordatorio de fin
      // de mes): el cron lo lee del lado del servidor sin listar usuarios de Auth.
      await onSaveSettings({
        [key]: next[key],
        ...(next[key] && userEmail ? { notifyEmail: userEmail } : {}),
      })
    } catch (e) {
      setEmailPrefs(emailPrefs)
      flash('err', e.message || t('Error al guardar', 'Error saving'))
    }
  }

  const t = (es, en) => lang === 'es' ? es : en

  // Group holdings by origin (source + institution) so the user can wipe one account
  // — e.g. "Interactive Brokers · IBKR API" — without touching another (their manual
  // "IDC"). Same batch-delete engine (deleteItemGroup) that respects shared symbols.
  // `_origin` separates an API sync from an uploaded statement for the SAME broker
  // (both carry _source:'ibkr'); items saved before it existed have none and simply
  // group by source+institution, so nothing needs migrating.
  const sourceLabel = (s, origin) => {
    const m = { ibkr: 'IBKR', blockchain: t('Wallet', 'Wallet'), ledger: 'Ledger', hapi: 'Hapi', demo: 'Demo' }
    const base = m[s] || ((!s || String(s).startsWith('manual')) ? t('Manual', 'Manual') : String(s))
    if (origin === 'api') return `${base} API`
    if (origin === 'file') return `${base} ${t('archivo', 'file')}`
    return base
  }
  const accountGroups = useMemo(() => {
    const map = new Map()
    for (const it of portfolioItems || []) {
      const source = it._source || 'manual'
      const institution = (it.institution || '').trim()
      const origin = it._origin || ''
      const key = `${source}|${institution}|${origin}`
      if (!map.has(key)) map.set(key, { key, source, institution, origin, ids: [], count: 0 })
      const g = map.get(key); g.ids.push(it.id); g.count++
    }
    return [...map.values()].sort((a, b) => b.count - a.count)
  }, [portfolioItems])

  const flash = (type, msg) => { setSaveStatus({ type, msg }); setTimeout(() => setSaveStatus(null), 3000) }

  const trimmedName = nameDraft.trim()
  const trimmedFirm = firmDraft.trim()
  const trimmedPhone = phoneDraft.trim()
  const trimmedEmail = emailDraft.trim()
  const nameDirty = !!onSaveProfile && (
    trimmedName !== savedName || trimmedFirm !== savedFirm ||
    trimmedPhone !== savedPhone || trimmedEmail !== savedEmail
  )
  const handleSaveName = async () => {
    if (!nameDirty || savingName) return
    setSavingName(true)
    try {
      // Los cuatro campos van juntos en cada guardado: el merge de saveProfile
      // los escribe sobre el mismo doc sin tocar lo demás (financialUpdatedAt
      // incluido, la lección de FASE KB).
      await onSaveProfile({ name: trimmedName, advisorFirm: trimmedFirm, advisorPhone: trimmedPhone, advisorEmail: trimmedEmail })
      flash('ok', t('Perfil guardado', 'Profile saved'))
    } catch (e) {
      flash('err', isFirestoreQuotaError(e)
        ? t('La base alcanzó su límite diario. Intenta más tarde.', 'The database hit its daily limit. Try again later.')
        : (e.message || t('Error al guardar', 'Error saving')))
    } finally {
      setSavingName(false)
    }
  }

  useEscClose(onClose)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveSettings({ baseCurrency, benchmarkSymbol })
      flash('ok', t('Guardado', 'Saved'))
      setTimeout(() => onClose(), 500)
    } catch (e) { flash('err', e.message || t('Error al guardar', 'Error saving')) }
    setSaving(false)
  }

  const handleDelete = async (type) => {
    if (confirmDelete !== type) {
      setConfirmDelete(type)
      return
    }
    setDeleting(type)
    let socialPurgeFailed = false
    try {
      if (type.startsWith('group:') && onDeleteItemGroup) {
        const g = accountGroups.find((x) => `group:${x.key}` === type)
        if (g) await onDeleteItemGroup(g.ids)
      }
      if (type === 'items') await onDeleteAllItems({ cascade: true })
      if (type === 'snapshots') await onDeleteAllSnapshots()
      if (type === 'transactions') await onDeleteAllTransactions()
      // 'financeTransactions' ya no llega acá: Flujo tiene su propio panel
      // (FinanceWipePanel), que borra por mes y por método. "Eliminar todo"
      // sigue llamando a onDeleteAllFinanceTransactions más abajo.
      if (type === 'all') {
        await onDeleteAllItems({ cascade: true })
        await onDeleteAllSnapshots()
        await onDeleteAllTransactions()
        if (onDeleteAllFinanceTransactions) await onDeleteAllFinanceTransactions()
        // An emptied account must not keep live broker connections silently
        // re-importing positions — wipe every stored sync credential too.
        await disconnectAllSyncs(authFetch)
        // The IBKR auto-sync gate reads these preference flags (useDashboardData);
        // clearing only the server vault leaves the 30-min auto-sync alive and the
        // "deleted" IBKR positions come back. This was a real user-reported bug.
        await onSaveSettings(IBKR_DISCONNECTED_FIELDS)
        // "Delete everything" left the Amigos profile and group membership
        // behind — the wipe only ever touched portfolio collections, never
        // the social ones. Same purge disableFriends() does.
        //
        // Y su fallo se DICE. Estaba envuelto en `.catch(() => {})`, así que un
        // error acá dejaba el perfil público y las membresías vivas bajo un
        // aviso que decía "Datos y conexiones eliminados": en un borrado total,
        // decir que algo se borró cuando no se borró es el peor fallo posible.
        // El resto ya se borró, así que se avisa qué quedó pendiente en vez de
        // presentar el borrado como completo.
        const purge = await authFetch('/api/friends', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable' }),
        }).catch(() => null)
        if (!purge?.ok) socialPurgeFailed = true
      }
      setConfirmDelete(null)
      if (socialPurgeFailed) {
        flash('err', t('Datos eliminados, pero tu perfil de Amigos sigue publicado. Apaga Amigos en General para borrarlo.',
                       'Data deleted, but your Friends profile is still published. Turn Friends off under General to delete it.'))
      } else {
        flash('ok', type === 'all' ? t('Datos y conexiones eliminados', 'Data and connections deleted') : t('Datos eliminados', 'Data deleted'))
      }
    } catch (e) {
      flash('err', e.message || t('Error al borrar', 'Error deleting'))
    } finally {
      setDeleting(null)
    }
  }

  // Apagar Amigos es DESTRUCTIVO y no se puede deshacer: sale de todos los
  // grupos, y un grupo donde eras el único miembro se ELIMINA para siempre
  // (junto con su código de invitación). El interruptor lo hacía de un toque,
  // sin decir nada de los grupos, y encima:
  //
  //   await authFetch(...).catch(() => {})
  //
  // se tragaba el fallo entero, así que si la purga no ocurría el interruptor
  // igual quedaba apagado y el aviso decía "Amigos desactivado" mientras el
  // perfil público y las membresías seguían VIVAS en el servidor. Es la peor
  // forma de fallar en algo de privacidad: una promesa falsa de borrado.
  //
  // Ahora: dos toques, la consecuencia dicha antes de confirmar, y la PURGA VA
  // PRIMERO. El orden importa. Si la purga falla, nada cambió y se dice; si
  // fallara el guardado de la preferencia después de purgar, los datos ya no
  // están y solo queda la pestaña visible, que es el lado seguro del error y
  // se arregla reintentando.
  const [confirmFriendsOff, setConfirmFriendsOff] = useState(false)
  const [friendsBusy, setFriendsBusy] = useState(false)

  const disableFriends = async () => {
    setFriendsBusy(true)
    try {
      const res = await authFetch('/api/friends', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'disable' }),
      })
      // authFetch no lanza ante un 4xx/5xx: hay que leer la respuesta o un
      // fallo del servidor pasa por éxito (la lección de lib/ibkrVault.js).
      if (!res?.ok) {
        let msg = `HTTP ${res?.status || '?'}`
        try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* respuesta no-JSON */ }
        throw new Error(msg)
      }
      await onSaveSettings({ friendsEnabled: false })
      setFriendsEnabled(false)
      setConfirmFriendsOff(false)
      flash('ok', t('Amigos desactivado y perfil público borrado', 'Friends disabled and public profile deleted'))
    } catch (e) {
      flash('err', t('No se pudo desactivar: tu perfil sigue publicado. ', 'Could not disable: your profile is still published. ') + (e.message || ''))
    } finally {
      setFriendsBusy(false)
    }
  }

  const toggleFriends = async () => {
    if (friendsEnabled) { setConfirmFriendsOff(true); return } // apagar pide confirmación
    setConfirmFriendsOff(false)
    setFriendsEnabled(true)
    try {
      await onSaveSettings({ friendsEnabled: true })
      flash('ok', t('Amigos activado', 'Friends enabled'))
    } catch (e) {
      setFriendsEnabled(false) // revert on failure
      flash('err', e.message || t('Error al guardar', 'Error saving'))
    }
  }

  const tabs = [
    { key: 'general', label: t('General', 'General'), icon: SlidersHorizontal },
    { key: 'entities', label: t('Entidades', 'Entities'), icon: Building2 },
    { key: 'share', label: t('Compartir', 'Share'), icon: Share2 },
    { key: 'data', label: t('Datos', 'Data'), icon: Database },
  ]
  // FASE GP: fade the scroll edge only where the tab row actually hides
  // content — this row has no scrollbar to hint it scrolls at all.
  const tabsFade = useEdgeFade([tabs.length])

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-glass-border">
          <h2 id="settings-modal-title" className="text-base font-bold text-white flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 14%, transparent)' }}>
              <Settings size={16} style={{ color: 'var(--accent-blue)' }} />
            </span>
            {t('Configuración', 'Settings')}
          </h2>
          <button onClick={onClose} className="rounded-full transition-colors hover:bg-theme-base" style={{ color: 'var(--text-secondary)' }} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {saveStatus && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg text-xs font-medium border flex items-center gap-1.5" style={{
            color: saveStatus.type === 'ok' ? 'var(--alert-success-icon)' : 'var(--alert-error-icon)',
            backgroundColor: saveStatus.type === 'ok' ? 'var(--alert-success-bg)' : 'var(--alert-error-bg)',
            borderColor: saveStatus.type === 'ok' ? 'var(--alert-success-border)' : 'var(--alert-error-border)',
          }}>
            {saveStatus.type === 'ok' ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertTriangle size={14} className="shrink-0" />}
            {saveStatus.msg}
          </div>
        )}

        <div className="px-5 pt-3.5 pb-3.5 border-b border-glass-border">
          <div ref={tabsFade.ref} className="flex gap-1 p-1 rounded-xl overflow-x-auto bg-theme-base border border-glass-border" style={tabsFade.maskStyle}>
            {tabs.map((tb) => {
              const active = tab === tb.key
              const Icon = tb.icon
              return (
                <button key={tb.key} onClick={() => { setTab(tb.key); setConfirmDelete(null) }}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-[11px] sm:text-xs font-medium whitespace-nowrap transition-all"
                  style={active
                    ? { backgroundColor: 'var(--bg-card-hover)', color: 'var(--accent-blue)', boxShadow: 'var(--shadow-card)' }
                    : { color: 'var(--text-secondary)' }}>
                  <Icon size={13} strokeWidth={2.25} className="shrink-0" />
                  {tb.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'general' && (
            <div className="space-y-4">
              {/* Tu nombre va PRIMERO: es quién sos, y precede a cualquier
                  preferencia. El caption dice para qué sirve, porque un campo
                  de nombre sin motivo aparente en una app de finanzas se lee
                  como un dato que se pide porque sí. */}
              {onSaveProfile && (
                <SectionCard icon={User} title={t('Identidad y contacto', 'Identity & contact')}>
                  <div className="space-y-3">
                    <div>
                      <label htmlFor="settings-name" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                        {t('Nombre para mostrar', 'Display name')}
                      </label>
                      <input
                        id="settings-name" type="text" value={nameDraft} maxLength={60}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                        placeholder={t('Tu nombre', 'Your name')}
                        className="w-full px-3 py-2.5 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
                      />
                      {/* `--text-muted` y no la clase `text-slate-600` que usan
                          los captions vecinos: medido, esa resuelve a 4.00:1 en
                          tema oscuro, o sea bajo el piso de texto. Igualar a un
                          vecino que no llega seria propagar el defecto a codigo
                          nuevo. El token esta en 6.7 oscuro / 7.2 claro. */}
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {t('Aparece en la portada de tu reporte PDF, en Amigos y como "Preparado por" en los links que compartes.', 'Appears on your PDF report cover, in Friends, and as "Prepared by" on links you share.')}
                      </p>
                    </div>
                    {/* FASE KP: contacto de asesor para los links de cliente.
                        Los tres son opcionales; vacio = no se muestra nada. */}
                    <div>
                      <label htmlFor="settings-advisor-firm" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                        {t('Firma o empresa (opcional)', 'Firm or company (optional)')}
                      </label>
                      <input
                        id="settings-advisor-firm" type="text" value={firmDraft} maxLength={80}
                        onChange={(e) => setFirmDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                        placeholder={t('Ej. IDC Valores', 'E.g. IDC Valores')}
                        className="w-full px-3 py-2.5 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label htmlFor="settings-advisor-phone" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                          {t('Teléfono (opcional)', 'Phone (optional)')}
                        </label>
                        <input
                          id="settings-advisor-phone" type="tel" value={phoneDraft} maxLength={40}
                          onChange={(e) => setPhoneDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                          placeholder="+502 5555 5555"
                          className="w-full px-3 py-2.5 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
                        />
                      </div>
                      <div>
                        <label htmlFor="settings-advisor-email" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                          {t('Correo de contacto (opcional)', 'Contact email (optional)')}
                        </label>
                        <input
                          id="settings-advisor-email" type="email" value={emailDraft} maxLength={120}
                          onChange={(e) => setEmailDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                          placeholder={t('tu@firma.com', 'you@firm.com')}
                          className="w-full px-3 py-2.5 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs flex-1" style={{ color: 'var(--text-muted)' }}>
                        {t('Firma, teléfono y correo aparecen como contacto en los links que compartes con clientes.', 'Firm, phone and email appear as contact info on links you share with clients.')}
                      </p>
                      <button type="button" onClick={handleSaveName} disabled={!nameDirty || savingName}
                        className="px-4 py-2.5 text-sm font-medium rounded-lg transition-colors shrink-0 border disabled:opacity-40 disabled:cursor-default"
                        style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                        <BusyLabel busy={savingName} lang={lang}>{t('Guardar', 'Save')}</BusyLabel>
                      </button>
                    </div>
                  </div>
                </SectionCard>
              )}

              {/* Broker syncs moved to their own hub — keep a pointer for discoverability */}
              {onOpenConnections && (
                <div className="flex items-center justify-between gap-3 p-3.5 bg-theme-base border border-glass-border rounded-xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 12%, transparent)' }}>
                      <Link2 size={16} style={{ color: 'var(--accent-blue)' }} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-white font-medium">{t('Conexiones y Sync', 'Connections & Sync')}</div>
                      <div className="text-xs text-slate-500">{t('Brokers, exchanges y wallets vinculados.', 'Linked brokers, exchanges and wallets.')}</div>
                    </div>
                  </div>
                  <button onClick={() => { onClose(); setTimeout(() => onOpenConnections(), 50) }}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 border hover:bg-blue-500/10" style={{ borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}>
                    {t('Abrir', 'Open')}
                  </button>
                </div>
              )}

              <SectionCard icon={Palette} title={t('Apariencia', 'Appearance')}>
                {/* Theme toggle */}
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{t('Tema', 'Theme')}</label>
                  <div className="flex gap-2">
                    {[
                      { key: 'light', label: t('Claro', 'Light'), icon: '☀️' },
                      { key: 'dark', label: t('Oscuro', 'Dark'), icon: '🌙' },
                      { key: 'system', label: t('Sistema', 'System'), icon: '💻' },
                    ].map((opt) => (
                      <button key={opt.key} onClick={() => onToggleTheme(opt.key)}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg transition-all ${
                          theme === opt.key
                            ? 'border'
                            : 'bg-theme-card border border-glass-border text-slate-300 hover:border-slate-500'
                        }`}
                        style={theme === opt.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                        <span className="text-base">{opt.icon}</span>
                        <span className="text-xs font-medium">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Language. Moved here from the header: it's a preference you set once,
                    not a control worth permanent space in the top bar. */}
                {onSetLang && (
                  <div>
                    <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{t('Idioma', 'Language')}</label>
                    <div className="flex gap-2">
                      {[
                        { key: 'es', label: 'Español' },
                        { key: 'en', label: 'English' },
                      ].map((opt) => (
                        <button key={opt.key} onClick={() => { if (lang !== opt.key) onSetLang() }}
                          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg transition-all ${
                            lang === opt.key ? 'border' : 'bg-theme-card border border-glass-border text-slate-300 hover:border-slate-500'
                          }`}
                          style={lang === opt.key ? { color: 'var(--accent-blue)', borderColor: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' } : undefined}>
                          <span className="text-xs font-medium">{opt.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={ToggleLeft} title={t('Preferencias', 'Preferences')}>
                {/* Beginner mode toggle */}
                <ToggleCard
                  active={beginnerMode}
                  onClick={() => onToggleBeginner?.(!beginnerMode)}
                  icon={GraduationCap}
                  title={t('Simplificar el panel', 'Simplify the dashboard')}
                  description={t('Oculta métricas avanzadas (Riesgo, Atribución) y colapsa el análisis. Todo sigue accesible.', 'Hides advanced metrics (Risk, Attribution) and collapses analysis. Everything stays accessible.')}
                />

                {/* Friends tab toggle — social leaderboard, off = hidden + profile purged */}
                <ToggleCard
                  active={friendsEnabled}
                  onClick={toggleFriends}
                  icon={Users}
                  title={t('Mostrar la pestaña Amigos', 'Show the Friends tab')}
                  description={t('Ranking de retorno con tus amigos. Solo se comparte tu % y símbolos, nunca montos. Al apagar se oculta la pestaña y se borra tu perfil público.', 'A return leaderboard with friends. Only your % and symbols are shared, never amounts. Turning it off hides the tab and deletes your public profile.')}
                />
                {/* La consecuencia completa, dicha ANTES de ejecutarla: apagar
                    no solo esconde la pestaña, sale de todos los grupos y borra
                    los que sean solo tuyos. Nada de esto se puede deshacer. */}
                {confirmFriendsOff && (
                  <div className="rounded-lg border px-4 py-3 space-y-2.5"
                    style={{ borderColor: 'var(--alert-warn-border)', backgroundColor: 'var(--alert-warn-bg)' }}>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {t('Al apagar: se borra tu perfil público y sales de TODOS tus grupos. Un grupo donde seas el único miembro se elimina para siempre, con su código de invitación. No se puede deshacer.',
                         'Turning this off deletes your public profile and removes you from ALL your groups. A group where you are the only member is deleted for good, invite code included. This cannot be undone.')}
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={disableFriends} disabled={friendsBusy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-60"
                        style={{ backgroundColor: 'var(--text-negative)', color: '#ffffff' }}>
                        <BusyLabel busy={friendsBusy} lang={lang}>{t('Confirmar: desactivar', 'Confirm: turn off')}</BusyLabel>
                      </button>
                      <button type="button" onClick={() => setConfirmFriendsOff(false)} disabled={friendsBusy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-60"
                        style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                        {t('Cancelar', 'Cancel')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Currency + benchmark as compact selects — the old 14-card grid
                    made the tab feel endless for a choice made once. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="settings-currency" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{t('Moneda principal', 'Base currency')}</label>
                    <select id="settings-currency" value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)}
                      className="w-full px-3 py-2.5 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.symbol} {c.code} · {c.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-600 mt-1">{t('Todos los valores se muestran en esta moneda.', 'All values are displayed in this currency.')}</p>
                  </div>
                  <div>
                    <label htmlFor="settings-benchmark" className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{t('Benchmark', 'Benchmark')}</label>
                    <select id="settings-benchmark" value={benchmarkSymbol} onChange={(e) => setBenchmarkSymbol(e.target.value)}
                      className="w-full px-3 py-2.5 bg-theme-card border border-glass-border rounded-lg text-sm text-white focus:outline-none focus:border-blue-500/50">
                      {Object.entries(BENCHMARKS).map(([key, bm]) => (
                        <option key={key} value={key}>{bm.short} · {bm.name}</option>
                      ))}
                    </select>
                    <p className="text-xs text-slate-600 mt-1">{t('Índice contra el que se compara tu portafolio.', 'Index your portfolio is compared against.')}</p>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={Bell} title={t('Notificaciones', 'Notifications')}>
                {isNotificationSupported() && (
                  <div className="p-3 bg-theme-card border border-glass-border rounded-lg flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-white font-medium">{t('Alertas del navegador', 'Browser alerts')}</p>
                      <p className="text-xs text-slate-500">{t('Pagos próximos y vencimientos', 'Upcoming payments and maturities')}</p>
                    </div>
                    {getNotificationPermission() === 'granted' ? (
                      <span className="shrink-0 text-xs font-medium px-2 py-1 bg-emerald-500/10 rounded" style={{ color: 'var(--accent-green)' }}>{t('Activado', 'Enabled')}</span>
                    ) : getNotificationPermission() === 'denied' ? (
                      <span className="shrink-0 text-xs font-medium px-2 py-1 bg-red-500/10 rounded" style={{ color: 'var(--text-negative)' }}>{t('Bloqueado', 'Blocked')}</span>
                    ) : (
                      <button onClick={async () => { await requestNotificationPermission(); }}
                        className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-blue-500 transition-colors" style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
                        {t('Activar', 'Enable')}
                      </button>
                    )}
                  </div>
                )}

                {/* Which categories matter to this user — a payment/maturity notice for
                    someone with no bonds/CDs is just noise, and this was pure all-or-nothing
                    browser permission before. */}
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{t('Qué avisar', 'What to notify about')}</label>
                  <div className="p-3 bg-theme-card border border-glass-border rounded-lg space-y-2.5">
                    {NOTIF_CATEGORIES.map((c) => (
                      <label key={c.key} className="flex items-center justify-between gap-3 cursor-pointer">
                        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{t(c.es, c.en)}</span>
                        <button type="button" role="switch" aria-checked={notifPrefs[c.key]} onClick={() => toggleNotifCategory(c.key)}
                          className="shrink-0 w-9 h-5 rounded-full flex items-center transition-all px-0.5"
                          style={{ backgroundColor: notifPrefs[c.key] ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }}>
                          <span className="w-4 h-4 rounded-full bg-white transition-transform"
                            style={{ transform: notifPrefs[c.key] ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Correos periódicos: tres cadencias independientes. */}
                <div>
                  <label className="text-xs mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>{t('Resúmenes por correo', 'Email briefs')}</label>
                  <div className="p-3 bg-theme-card border border-glass-border rounded-lg space-y-3">
                    {EMAIL_CADENCES.map((c) => (
                      <div key={c.key} className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm" style={{ color: c.ready ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                            {t(c.es, c.en)}
                            {!c.ready && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}>
                                {t('Pronto', 'Soon')}
                              </span>
                            )}
                          </p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{t(c.descEs, c.descEn)}</p>
                        </div>
                        <button type="button" role="switch" aria-checked={!!emailPrefs[c.key]} disabled={!c.ready}
                          aria-label={t(c.es, c.en)}
                          onClick={() => c.ready && toggleEmailCadence(c.key)}
                          className="shrink-0 w-9 h-5 rounded-full flex items-center transition-all px-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ backgroundColor: emailPrefs[c.key] && c.ready ? 'var(--accent-blue)' : 'var(--bg-tertiary)' }}>
                          <span className="w-4 h-4 rounded-full bg-white transition-transform"
                            style={{ transform: emailPrefs[c.key] && c.ready ? 'translateX(16px)' : 'translateX(0)' }} />
                        </button>
                      </div>
                    ))}
                    <p className="text-[11px] pt-1" style={{ color: 'var(--text-muted)' }}>
                      {userEmail
                        ? t(`Se envían a ${userEmail}. Todos los correos van en inglés.`, `Sent to ${userEmail}. All emails are in English.`)
                        : t('Todos los correos van en inglés.', 'All emails are in English.')}
                    </p>
                    {/* Enviar una prueba ahora: el semanal solo sale los
                        domingos, y esperar días para descubrir que el correo no
                        sale es el ciclo lento que este repo ya pagó caro. Arma
                        el MISMO correo de la corrida real. */}
                    <div className="pt-1 flex flex-wrap gap-2">
                      <button type="button" onClick={() => handleTestEmail('weekly')} disabled={!!testingEmail}
                        className="px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}>
                        {testingEmail === 'weekly' ? t('Enviando...', 'Sending...') : t('Probar semanal', 'Test weekly')}
                      </button>
                      <button type="button" onClick={() => handleTestEmail('monthly')} disabled={!!testingEmail}
                        className="px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}>
                        {testingEmail === 'monthly' ? t('Enviando...', 'Sending...') : t('Probar mensual', 'Test monthly')}
                      </button>
                      <button type="button" onClick={() => handleTestEmail('annual')} disabled={!!testingEmail}
                        className="px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}>
                        {testingEmail === 'annual' ? t('Enviando...', 'Sending...') : t('Probar anual', 'Test annual')}
                      </button>
                      <button type="button" onClick={() => handleTestEmail('friendsWeekly')} disabled={!!testingEmail}
                        className="px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-input)' }}>
                        {testingEmail === 'friendsWeekly' ? t('Enviando...', 'Sending...') : t('Probar grupos', 'Test groups')}
                      </button>
                    </div>
                    <div>
                      {testResult && (
                        <p className="text-[11px] mt-1.5 leading-relaxed"
                          style={{ color: testResult.ok ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                          {testResult.msg}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <button onClick={handleSave} disabled={saving} className="btn-primary w-full">
                {<BusyLabel busy={saving} lang={lang}>{t('Guardar configuracion', 'Save settings')}</BusyLabel>}
              </button>
            </div>
          )}


          {tab === 'entities' && (
            <div className="space-y-4">
              {onAddEntity ? (
                <EntityManager
                  entities={entities || []}
                  onAdd={onAddEntity}
                  onUpdate={onUpdateEntity}
                  onDelete={onDeleteEntity}
                  items={portfolioItems}
                  lang={lang}
                />
              ) : (
                <p className="text-xs text-slate-500">{t('No disponible', 'Not available')}</p>
              )}
            </div>
          )}


          {tab === 'share' && (
            <ShareTab
              lang={lang} entities={entities} portfolios={portfolios}
              portfolioItems={portfolioItems} activePortfolio={activePortfolio}
              flash={flash}
            />
          )}

          {tab === 'data' && (
            <div className="space-y-4">
              {onExportBackup && (
                <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border" style={{ backgroundColor: 'var(--alert-success-bg)', borderColor: 'var(--alert-success-border)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 18%, transparent)' }}>
                      <Download size={16} style={{ color: 'var(--accent-green)' }} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t('Exportar Backup', 'Export Backup')}</div>
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t('Descarga todos tus datos en formato JSON.', 'Download all your data as JSON.')}</div>
                    </div>
                  </div>
                  <button onClick={onExportBackup}
                    className="shrink-0 px-3.5 py-2 text-xs font-semibold rounded-lg transition-opacity hover:opacity-90" style={{ backgroundColor: 'var(--accent-green)', color: '#ffffff' }}>
                    {t('Descargar', 'Download')}
                  </button>
                </div>
              )}

              {/* One prominent nuclear action; the granular deletes live collapsed
                  below — they're rarely needed and were drowning the tab. */}
              {(() => {
                const renderAction = (action) => {
                  const armed = confirmDelete === action.key
                  const busy = deleting === action.key
                  return (
                  <div key={action.key} className="p-3 bg-theme-base border border-glass-border rounded-lg">
                    {/* Label+desc and the button live in one centered row; the warning
                        reveals BELOW it (animated max-height) so arming confirm never
                        shifts the button's position ("la casilla se mueve"). */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex items-start gap-2">
                        <Trash2 size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                        <div className="min-w-0">
                          <div className="text-sm text-white font-medium">{action.label}</div>
                          <div className="text-xs text-slate-500">{action.desc}</div>
                        </div>
                      </div>
                      <button onClick={() => handleDelete(action.key)} disabled={busy}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors shrink-0 border inline-flex items-center gap-1.5 disabled:opacity-70"
                        style={armed
                          ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' }
                          : { color: 'var(--text-negative)', borderColor: 'rgba(239,68,68,0.3)' }}>
                        <BusyLabel busy={busy} lang={lang} busyLabel={t('Borrando…', 'Deleting…')}>
                          {armed ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
                        </BusyLabel>
                      </button>
                    </div>
                    <div className="overflow-hidden transition-all duration-200 ease-out"
                      style={{ maxHeight: armed ? 48 : 0, opacity: armed ? 1 : 0 }}>
                      <div className="text-xs mt-2 font-medium" style={{ color: 'var(--accent-orange)' }}>{action.warn}</div>
                    </div>
                  </div>
                )}
                return (
                  <>
                    <div className="rounded-xl border p-3.5 space-y-2.5" style={{ borderColor: 'var(--alert-error-border)', backgroundColor: 'var(--alert-error-bg)' }}>
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle size={13} style={{ color: 'var(--text-negative)' }} />
                        <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-negative)' }}>{t('Empezar de cero', 'Start over')}</p>
                      </div>
                      {renderAction({ key: 'all', label: t('Eliminar todo', 'Delete everything'), desc: t('Borra cuentas, historial, transacciones y finanzas, y desconecta todos los brokers vinculados.', 'Deletes accounts, history, transactions and finances, and disconnects every linked broker.'), warn: t('No se puede deshacer. Descarga un backup antes si tienes duda.', 'This cannot be undone. Download a backup first if in doubt.') })}
                    </div>

                    <details className="group">
                      <summary className="flex items-center justify-between cursor-pointer py-1.5 list-none">
                        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{t('Borrado selectivo', 'Selective delete')}</p>
                        <ChevronDown size={14} className="transition-transform group-open:rotate-180" style={{ color: 'var(--text-muted)' }} />
                      </summary>
                      <div className="mt-2 space-y-2">
                        <p className="text-xs text-slate-600">{t('Para casos puntuales: normalmente no necesitas esto.', 'For edge cases: you normally don\'t need these.')}</p>
                        {[
                          { key: 'items', label: t('Eliminar todas las cuentas', 'Delete all accounts'), desc: t('Instrumentos y posiciones (con sus lots y transacciones).', 'Instruments and positions (with their lots and transactions).'), warn: t('Se borrarán cuentas, lots y transacciones asociadas.', 'This will delete accounts, lots, and associated transactions.') },
                          { key: 'transactions', label: t('Eliminar transacciones', 'Delete transactions'), desc: t('Solo el historial de movimientos del portafolio.', 'Only the portfolio movement history.'), warn: t('Los retornos YTD y Modified Dietz serán menos precisos.', 'YTD returns and Modified Dietz will be less accurate.') },
                          { key: 'snapshots', label: t('Eliminar snapshots', 'Delete snapshots'), desc: t('Solo el historial del gráfico de crecimiento.', 'Only the growth chart history.'), warn: t('El gráfico de crecimiento perderá datos históricos.', 'The growth chart will lose historical data.') },
                        ].map(renderAction)}

                        {/* Finanzas tiene su propio panel: es la única de estas
                            colecciones donde acotar por mes y por método de
                            captura tiene sentido, y donde un borrado puede ser
                            irrecuperable (lo del atajo y el correo no vuelve
                            solo), así que ofrece el respaldo antes. */}
                        {onDeleteFinanceTransactionsByIds && (
                          <FinanceWipePanel
                            transactions={financeTransactions}
                            onDeleteByIds={onDeleteFinanceTransactionsByIds}
                            onDeleteAll={onDeleteAllFinanceTransactions}
                            lang={lang}
                            onDone={(n) => flash('ok', n === 1 ? t('1 movimiento eliminado', '1 movement deleted') : t(`${n} movimientos eliminados`, `${n} movements deleted`))}
                          />
                        )}

                        {/* Per-account delete: wipe one origin (e.g. IBKR API) without
                            touching another (manual IDC). Only when >1 account exists. */}
                        {/* Shown from ONE account up: the guard used to require >1, which
                            hid the section from exactly the users who most need it (a
                            single connected broker they want to wipe without touching
                            their manual holdings). It also makes the accounts visible. */}
                        {onDeleteItemGroup && accountGroups.length > 0 && (
                          <div className="pt-1">
                            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">{t('Por cuenta', 'By account')}</p>
                            <div className="space-y-2">
                              {accountGroups.map((g) => renderAction({
                                key: `group:${g.key}`,
                                label: g.institution || t('Sin institución', 'No institution'),
                                desc: `${g.count} ${g.count === 1 ? t('posición', 'position') : t('posiciones', 'positions')} · ${sourceLabel(g.source, g.origin)}`,
                                warn: t('Se borra solo esta cuenta: posiciones, lots, transacciones y su historial de valor. Las demás no se tocan.', 'Deletes only this account: positions, lots, transactions and its value history. The others are untouched.'),
                              }))}
                            </div>
                          </div>
                        )}
                      </div>
                    </details>
                    {/* Build id: lets anyone confirm at a glance whether this phone is
                        running the latest deploy (Vercel free tier has silently stopped
                        deploying before when the daily limit was hit). */}
                    <BuildVersionFooter lang={lang} />
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Tiny build stamp so a screenshot of Settings proves which deploy the device runs.
function BuildVersionFooter({ lang }) {
  const [buildId, setBuildId] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/version').then((r) => r.json()).then((d) => {
      if (!cancelled) setBuildId(d?.buildId || '?')
    }).catch(() => { if (!cancelled) setBuildId('?') })
    return () => { cancelled = true }
  }, [])
  return (
    <div className="text-center pt-2 space-y-1">
      <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
        {lang === 'es' ? 'Versión' : 'Build'}: {buildId || '…'}
      </p>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline">{lang === 'es' ? 'Términos' : 'Terms'}</a>
        {' · '}
        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline">{lang === 'es' ? 'Privacidad' : 'Privacy'}</a>
      </p>
    </div>
  )
}
