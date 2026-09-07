'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useFirestoreItems } from '@/hooks/useFirestoreItems'
import { useExchangeRates } from '@/hooks/useExchangeRates'
import { useIngestRules } from '@/hooks/useIngestRules'

// Finanzas is GTQ-denominated; normalize every transaction to GTQ before summing
// so a USD entry isn't added 1:1 to GTQ totals (and mislabeled "Q").
const FINANCE_CURRENCY = 'GTQ'

import PageShell, { PageTitle } from '@/components/PageShell'
import PullToRefresh from '@/components/ui/PullToRefresh'
import ModalMount from '@/components/ui/ModalMount'
import useModalExit from '@/hooks/useModalExit'
import { computeLoadStages } from '@/lib/loadStages'
import { hasDemoData } from '@/lib/demoData'
import MonthSelector from '@/components/finance/MonthSelector'
import FinanceSummaryCards from '@/components/finance/FinanceSummaryCards'
import BreakdownCard from '@/components/finance/BreakdownCard'
import MonthStatusBar from '@/components/finance/MonthStatusBar'
import FinanceTransactionList from '@/components/finance/FinanceTransactionList'
import FinanceInsights from '@/components/finance/FinanceInsights'
import InstallmentPlansCard from '@/components/finance/InstallmentPlansCard'
import RecurringChargesCard from '@/components/finance/RecurringChargesCard'
import DebtAgingCard from '@/components/finance/DebtAgingCard'
import YearInViewCard from '@/components/finance/YearInViewCard'
import UnclassifiedTriage from '@/components/finance/UnclassifiedTriage'
import FinancialProfileCard from '@/components/finance/FinancialProfileCard'
import IncomePlanCalendar from '@/components/finance/IncomePlanCalendar'
import AddFinanceTransactionModal from '@/components/finance/AddFinanceTransactionModal'
import AutoCaptureModal from '@/components/finance/AutoCaptureModal'
import FileImportModal from '@/components/FileImportModal'
import { SkeletonCard, SkeletonTable } from '@/components/dashboard/Skeleton'
import InlineNotice from '@/components/ui/InlineNotice'
import PageBanner from '@/components/ui/PageBanner'
// ErrorBoundary y NO CardBoundary a propósito, y la razón medida es más
// angosta de lo que parece: aquel envuelve en un <div> SIEMPRE, así que una
// card que se auto-oculta (cinco de las de Flujo lo hacen) deja un nodo vacío
// en el DOM. Medido en el navegador con las dos, mismo contenido: ErrorBoundary
// deja 1 nodo y CardBoundary 2.
//
// ⛔ Lo que ese nodo de más NO hace es abrir un hueco, y conviene dejarlo
// escrito porque es la conclusión natural y es falsa: un div vacío sin borde ni
// padding se auto-colapsa, su margen se colapsa a través y la card siguiente
// arranca en el mismo sitio (top=0 en los dos lados, en los cuatro escenarios).
// La razón para preferir este es la otra: no agrega nodo, y su fallback es
// bilingüe y sobre tokens de tema, mientras el de CardBoundary imprime el id
// crudo de la card con clases de tema oscuro.
import ErrorBoundary from '@/components/ErrorBoundary'
import { computeMonthlyAnalysis, buildFinanceInsights } from '@/lib/financeMonth'
import { detectRecurringCharges, annualPaymentsOfMonth } from '@/lib/recurringCharges'
import { isTransferCategory } from '@/lib/financeCategories'
import { financeReportCsv, downloadCsv } from '@/lib/financeCsv'
import { planRecategorize, isMachineDescribed } from '@/lib/recategorize'
import { commitmentsHaveContent, yearInViewHasContent } from '@/lib/financeSections'
import PageTour from '@/components/dashboard/PageTour'
import SectionCollapse from '@/components/dashboard/SectionCollapse'
import { Wallet, Zap } from 'lucide-react'
import { authFetch } from '@/lib/authFetch'

// Los botones secundarios de la barra de acciones. Antes eran
// `text-slate-300 border-slate-600/50`, o sea un borde de tema oscuro sobre un
// fondo que en tema claro es casi blanco: se veían como texto flotando sin
// caja. Van por tokens, como el resto de la app.
const SECONDARY_BTN = 'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors hover:bg-theme-elevated'
const SECONDARY_STYLE = { color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }

export default function FinancesPage() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [lang, setLang] = useState('es')
  const [modal, setModal] = useState(null)
  // Los modales sobreviven su animación de salida. Ver hooks/useModalExit.js.
  const [modalShown, modalClosing] = useModalExit(modal)

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chispudo-lang')
      if (saved === 'en' || saved === 'es') setLang(saved)
    }
  }, [])

  const handleSetLang = useCallback(() => {
    const next = lang === 'en' ? 'es' : 'en'
    setLang(next)
    if (typeof window !== 'undefined') localStorage.setItem('chispudo-lang', next)
  }, [lang])

  useEffect(() => {
    let unsubscribe = () => {}
    async function initAuth() {
      const { auth } = await import('@/lib/firebase')
      const { onIdTokenChanged } = await import('firebase/auth')
      if (!auth) { setAuthLoading(false); router.push('/login'); return }
      unsubscribe = onIdTokenChanged(auth, (currentUser) => {
        if (!currentUser) {
          router.push('/login')
        } else {
          setUser(currentUser)
        }
        setAuthLoading(false)
      })
    }
    initAuth()
    return () => unsubscribe()
  }, [router])

  const {
    items,
    loading: dataLoading,
    addItem,
    updateItem,
    financeTransactions,
    addFinanceTransaction,
    updateFinanceTransaction,
    deleteFinanceTransaction,
    settings,
    saveSettings,
    profile,
    saveProfile,
    goals,
    saveGoals,
    incomePlan,
    saveIncomePlan,
  } = useFirestoreItems()

  // `error` y `stale` se estaban TIRANDO, y no son lo mismo. Sin tasa,
  // `convert` devuelve el monto CRUDO: una fila en dólares se suma 1:1 a los
  // quetzales, casi ocho veces de más, sin que nada lo diga. `stale` es otra
  // cosa y el propio hook lo documenta: una tasa vieja es una respuesta
  // EXITOSA degradada.
  const {
    convert, loading: ratesLoading, refresh: refreshRates,
    error: ratesError, stale: ratesStale,
  } = useExchangeRates()
  // Las reglas por comercio que el usuario enseñó. El hook las comparte con el
  // importador del tablero, que antes clasificaba con cero reglas aprendidas.
  const { rules: ingestRules, learn: learnCategory, learnMany: handleLearnCategories } = useIngestRules(user)

  const monthTransactions = useMemo(() => {
    return financeTransactions
      .filter(tx => {
        if (!tx.date) return false
        // Parse YYYY-MM-DD parts directly. `new Date('2026-06-01')` is UTC midnight,
        // which shifts to the prior day/month for users west of UTC (e.g. GT, UTC-6).
        const [y, m] = String(tx.date).split('-').map(Number)
        if (!y || !m) return false
        return (m - 1) === month && y === year
      })
      .map(tx => {
        const cur = tx.currency || FINANCE_CURRENCY
        const conv = convert ? convert(tx.amount || 0, cur, FINANCE_CURRENCY) : NaN
        const amount = isFinite(conv) ? conv : (tx.amount || 0)
        // Keep the original for reference; display/sum use the GTQ-normalized amount
        return cur === FINANCE_CURRENCY ? tx : { ...tx, amount, _originalAmount: tx.amount, _originalCurrency: cur }
      })
  }, [financeTransactions, month, year, convert])

  // Las transferencias entre cuentas propias quedan fuera de las dos cifras,
  // igual que en `computeMonthlyAnalysis`: dos motores sumando el mismo mes con
  // reglas distintas es como la pantalla termina contradiciendose a si misma.
  const flowTxs = useMemo(
    () => monthTransactions.filter(tx => !isTransferCategory(tx.category)),
    [monthTransactions]
  )

  const income = useMemo(() =>
    flowTxs.filter(tx => tx.type === 'INCOME').reduce((s, tx) => s + (tx.amount || 0), 0),
    [flowTxs]
  )

  const expenses = useMemo(() =>
    flowTxs.filter(tx => tx.type === 'EXPENSE').reduce((s, tx) => s + (tx.amount || 0), 0),
    [flowTxs]
  )

  // ── Motor mensual: análisis e insights ──
  //
  // ⛔ Solo transacciones de Flujo. El ingreso por dividendos del portafolio ya
  // NO se inyecta acá: son dos segmentos separados (ver la cabecera de
  // computeMonthlyAnalysis). Lo que Patrimonio genera se mide en Patrimonio.
  const analysis = useMemo(
    () => computeMonthlyAnalysis(financeTransactions, { month, year }, convert),
    [financeTransactions, month, year, convert]
  )
  const monthInsights = useMemo(() => buildFinanceInsights(analysis, lang), [analysis, lang])

  // FASE LJ. Los pagos anuales/semestrales del mes seleccionado: la union de
  // la marca manual (_annualCadence) y la cadencia larga detectada sobre el
  // historial COMPLETO (no el mes: la cadencia se ve entre anios). Alimenta la
  // linea derivada del resumen; el total del mes no se toca.
  const annualInMonth = useMemo(() => {
    const { longCadence } = detectRecurringCharges(financeTransactions, { convert })
    return annualPaymentsOfMonth(financeTransactions, analysis.key, { convert, longCadence })
  }, [financeTransactions, analysis.key, convert])

  // El desglose por grupo (y por categoría dentro de cada grupo) sale del MISMO
  // motor que produce los totales, así que una fila desplegada siempre suma su
  // grupo y los grupos siempre suman el total. Antes la página lo armaba a mano
  // por su cuenta y otra card lo re-derivaba una tercera vez.
  const reminderEnabled = !!settings?.financeReminder
  const handleToggleReminder = useCallback(async () => {
    const next = !reminderEnabled
    // Email captured at opt-in time from Firebase Auth — the month-end cron reads it
    // server-side without ever listing auth users.
    await saveSettings({
      financeReminder: next,
      // Sin `financeReminderLang`: todo correo saliente va en inglés (FASE
      // HX2), así que guardar un idioma que nadie lee solo haría creer que la
      // preferencia hace algo.
      ...(next ? { financeReminderEmail: user?.email || '' } : {}),
    })
  }, [reminderEnabled, saveSettings, user, lang])

  // Fixing the category of a transaction also TEACHES the classifier: the rule
  // is stored per merchant, so the next charge from that place lands already
  // classified.
  //
  // What teaches is a description a MACHINE produced — the Shortcut, the
  // forwarded alert, or a statement import — because those are merchant names a
  // bank or Wallet wrote and they repeat verbatim. A hand-typed entry does not,
  // so it never writes a rule from wording the user invented.
  //
  // The statement case used to be missing, and it was the one that mattered
  // most: those rows carry `source: 'card_import'`, a different field AND a
  // different value from the Shortcut's `_source: 'auto_*'`, so correcting any
  // of the ~167 imported rows taught nothing at all.
  // FASE LJ. La marca de pago anual/semestral, escrita desde el editor de
  // categoria. Es una decision del usuario sobre SU fila (mismo estatus que
  // _categorySetByUser); lo derivado (la linea "Qx son pagos anuales") se
  // calcula al leer y nunca se escribe.
  const handleToggleAnnual = useCallback(async (tx, annual) => {
    if (!tx?.id) return
    await updateFinanceTransaction(tx.id, { _annualCadence: annual === true })
  }, [updateFinanceTransaction])

  const handleRecategorize = useCallback(async (tx, category, label) => {
    if (!tx?.id || !category || (category === tx.category && !label)) return
    // `_categorySetByUser` is what keeps the bulk re-read (planRecategorize)
    // off this row forever, including if the user deliberately picks the
    // fallback category.
    const patch = { category, _needsReview: false, _categorySetByUser: true }
    if (label) patch.userLabel = label
    await updateFinanceTransaction(tx.id, patch)

    const merchant = tx.merchant || tx.description
    if (!merchant || !isMachineDescribed(tx)) return
    // El hook mantiene la copia local al día, así la próxima corrección y el
    // re-leído masivo ya ven lo que se acaba de enseñar.
    await learnCategory(merchant, category, label).catch(() => {})
  }, [updateFinanceTransaction, learnCategory])

  // El triage por comercio: un clic clasifica TODAS las filas de ese comercio
  // y enseña la regla (pasadas y futuras). Misma pareja escritura+aprendizaje
  // que handleRecategorize, solo que sobre el grupo entero; las filas llevan
  // `_categorySetByUser` porque ES una decisión del usuario aplicada al
  // comercio, igual que en applyCategoryToMatchingRows.
  const handleTriageApply = useCallback(async (group, category, label) => {
    if (!group?.txIds?.length || !category) return
    for (const id of group.txIds) {
      const patch = { category, _needsReview: false, _categorySetByUser: true }
      if (label) patch.userLabel = label
      try {
        await updateFinanceTransaction(id, patch)
      } catch { /* una escritura fallida no debe dejar tiradas a las demás */ }
    }
    await learnCategory(group.merchant, category, label || null).catch(() => {})
  }, [updateFinanceTransaction, learnCategory])

  // A transaction's category is frozen on the document at capture time, so
  // every improvement to the classifier is invisible on everything already
  // recorded. This offers the re-read explicitly, with the count up front, and
  // only over rows a machine put in the "could not tell" bucket — see
  // lib/recategorize.js for exactly what it refuses to touch.
  const [recatBusy, setRecatBusy] = useState(false)
  const [recatDone, setRecatDone] = useState(null)
  const [recatFailed, setRecatFailed] = useState(0)

  const recatPlan = useMemo(
    () => planRecategorize(financeTransactions, { rules: ingestRules }),
    [financeTransactions, ingestRules]
  )

  // ¿Qué secciones tienen algo debajo? Las cards se auto-ocultan cuando no
  // tienen contenido, así que sin esto una sección entera podía dibujar su
  // encabezado sobre nada. Se pregunta con los MISMOS selectores puros que usa
  // cada card (`lib/financeSections.js`): una sola fuente de verdad, cero
  // umbrales duplicados acá.
  const hasCommitments = useMemo(
    () => commitmentsHaveContent(financeTransactions, { convert }),
    [financeTransactions, convert]
  )
  const hasYearInView = useMemo(
    () => yearInViewHasContent(financeTransactions, year, convert),
    [financeTransactions, year, convert]
  )

  // ¿Hay algún movimiento en otra moneda? Flujo está denominado en GTQ, así que
  // si TODO se registró en quetzales una caída del tipo de cambio no mueve un
  // solo número de esta pantalla, y avisar sería ruido.
  const hasForeignRows = useMemo(
    () => financeTransactions.some((tx) => (tx.currency || FINANCE_CURRENCY) !== FINANCE_CURRENCY),
    [financeTransactions]
  )

  // El mes ELEGIDO tiene movimientos, que no es lo mismo que la cuenta tenga
  // historia: moverse a un mes anterior a cuando empezaste es normal.
  const monthHasMovements = monthTransactions.length > 0
  const monthLabel = useMemo(() => {
    try {
      const d = new Date(Date.UTC(year, month, 1))
      const name = d.toLocaleDateString(lang === 'es' ? 'es-GT' : 'en-US', { month: 'long', timeZone: 'UTC' })
      return `${name} ${year}`
    } catch { return `${month + 1}/${year}` }
  }, [month, year, lang])

  const handleRecategorizeAll = useCallback(async () => {
    if (recatPlan.length === 0) return
    setRecatBusy(true)
    let done = 0
    let failed = 0
    for (const change of recatPlan) {
      // ⛔ SE LEE EL VALOR DE RETORNO, no basta con no lanzar.
      // `updateFinanceTransaction` NUNCA lanza: atrapa su error, loguea y
      // devuelve `false` (hooks/useFirestoreItems.js). Así que el `catch` que
      // había acá era código MUERTO y `done++` contaba una escritura fallida
      // como éxito, o sea la app reportaba "Listo: N reclasificados" sobre
      // filas que Firestore nunca recibió. Es el mismo defecto que FASE LO/LC
      // ya cerró en el importador. El try/catch se queda igual por si un caller
      // futuro sí lanza.
      let ok = false
      try {
        ok = await updateFinanceTransaction(change.id, { category: change.to }) !== false
      } catch { ok = false }
      if (ok) done++
      else failed++
    }
    setRecatBusy(false)
    setRecatDone(done)
    setRecatFailed(failed)
  }, [recatPlan, updateFinanceTransaction])

  const t = (es, en) => lang === 'es' ? es : en

  // Shared by the desktop header button and MobileNav — the export used to live
  // only in MobileNav, so desktop had no way to download the CSV.
  const handleExportCsv = () => {
    if (monthTransactions.length === 0) return
    // Amounts here are already GTQ-normalized (monthTransactions), so the
    // Currency column is always GTQ; converted rows keep their original next to
    // it. El RESPALDO previo a un borrado usa el otro constructor del mismo
    // módulo, que sale del monto crudo: ver lib/financeCsv.js.
    downloadCsv(
      financeReportCsv(monthTransactions, { currency: FINANCE_CURRENCY }),
      `chispudo-finances-${year}-${String(month + 1).padStart(2, '0')}.csv`,
    )
  }

  if (authLoading || (user && dataLoading)) {
    const skeleton = (
      <>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
        <SkeletonTable />
      </>
    )
    // Sin usuario todavía no hay Header que dibujar (y AuthGate está encima con
    // su propio splash de pantalla completa), así que ahí el marco pelado es lo
    // correcto. El `!user` de abajo redirige en el render siguiente.
    if (!user) return <div className="min-h-screen bg-theme-base" />
    // ⛔ EL ESQUELETO VA DENTRO DE `PageShell`, NO EN UN `app/finances/loading.jsx`.
    // El defecto era que este bloque copiaba a mano el ancho y el ritmo de
    // PageShell pero NO montaba Header ni MobileNav, así que la barra superior
    // aparecía de golpe cuando llegaban los datos. Un `loading.jsx` NO lo
    // arregla: ese cubre la carga del SEGMENTO de servidor y acá la espera es
    // del listener de Firestore, en el cliente, cuando el loading.jsx ya se
    // descartó. Agregarlo dejaría un TERCER estado de carga en fila (splash de
    // AuthGate -> loading.jsx -> este esqueleto), y `app/dashboard/loading.jsx`
    // documenta en su cabecera que es la ÚNICA ruta con ese patrón y que
    // finanzas gatea inline a propósito.
    return (
      <PageShell user={user} lang={lang} setLang={handleSetLang} settings={settings} width="wide">
        {skeleton}
      </PageShell>
    )
  }

  if (!user) return null

  // Un solo cálculo para el anillo del header y para el gesto de jalar, con el
  // helper compartido en vez de una expresión propia: acá no hay precios de
  // mercado que cargar, así que la única etapa re-ejecutable son las tasas, y
  // `computeLoadStages` es el que sabe no contar `dataLoading` una vez resuelto
  // (si no, cada refresco arrancaba en un 50% que no significaba nada).
  const loadStages = computeLoadStages({ dataLoading, ratesLoading })

  // Con el mes en curso las flechas ya no se callan: comparan los primeros N
  // días de este mes contra los primeros N del anterior (windowDays, ver
  // financeMonth.js), y la nota de cabecera dice ESA ventana. La línea de "al
  // cerrar el mes" queda solo para el caso en que la ventana no cabe en el mes
  // anterior (los últimos 1-3 días de un mes largo contra febrero).
  const momTitle = analysis.windowDays != null
    ? t(`vs los primeros ${analysis.windowDays} días del mes pasado`, `vs the first ${analysis.windowDays} days of last month`)
    : t('vs mes pasado', 'vs last month')
  const deltaSilentReason = analysis.windowDays != null
    ? t(`Variaciones vs los primeros ${analysis.windowDays} días del mes pasado`,
        `Changes vs the first ${analysis.windowDays} days of last month`)
    : analysis.partialMonth
      ? t('Variaciones al cerrar el mes', 'Changes once the month closes')
      : null

  return (
    // El armazón compartido. Antes esta página montaba a mano su propio Header,
    // su MobileNav, el skip link y un `handleSignOut` copiado palabra por
    // palabra de PageShell, y escribía su título con las mismas clases que
    // PageTitle. De paso corrige el ritmo vertical: usaba `space-y-4 sm:space-y-5`
    // contra el `sm:space-y-6` del resto de la app, o sea quedaba 4px más
    // apretada que cualquier otra ruta y justo en el borde de la proporción que
    // hace que las cards no se fundan entre sí.
    //
    // FASE EM. onRefresh was a no-op and no load-stage signal was passed, so the
    // ring could never show real progress. Finanzas has no market prices to
    // refresh (its numbers are Firestore-live + GTQ conversion), so its two real
    // stages are the data listener and the exchange rate fetch.
    <PageShell
      user={user} lang={lang} setLang={handleSetLang} settings={settings} width="wide"
      demoActive={hasDemoData(items)}
      onAdd={() => setModal('add')}
      onImport={() => setModal('import')}
      onExport={handleExportCsv}
      onAuto={() => setModal('auto')}
      onSettings={() => router.push('/dashboard')}
      headerProps={{
        onRefresh: refreshRates,
        pricesLoading: ratesLoading,
        loadStagesDone: loadStages.done,
        loadStagesTotal: loadStages.total,
      }}
    >
      {/* Jalar hacia abajo para actualizar (FASE JF). Recibe EXACTAMENTE los
          mismos valores que el Header de arriba, para que los dos indicadores
          de esta pantalla no puedan contar historias distintas. Acá tambien
          reemplaza a la recarga nativa de Safari, igual que en el tablero. */}
      <PullToRefresh
        onRefresh={refreshRates}
        loading={ratesLoading}
        stagesDone={loadStages.done}
        stagesTotal={loadStages.total}
        lang={lang}
      />
      <PageTour pageKey="finances" nextRoute="/spreadsheet" nextFlag="spreadsheet" lang={lang} steps={[
        {
          tab: t('Flujo', 'Flow'),
          title: t('Tu mes en orden', 'Your month in order'),
          body: t('Esta pestaña es para tu vida financiera personal: los ingresos y gastos de cada mes, separados de tus inversiones. Las tarjetas de arriba resumen cuánto entró, cuánto salió y cuánto ahorraste, con la comparación contra el mes anterior.',
                  'This tab is for your personal financial life: each month\'s income and spending, separate from your investments. The cards up top summarize what came in, what went out and what you saved, compared against last month.'),
        },
        {
          tab: t('Flujo', 'Flow'),
          title: t('Registra o importa movimientos', 'Log or import movements'),
          body: t('Puedes anotar cada gasto a mano con el botón de agregar, o importar el estado de cuenta de tu banco (PDF o Excel). Chispudo detecta duplicados para que re-importar el mismo mes no duplique nada, y te deja categorizar cada movimiento.',
                  'You can log each expense by hand with the add button, or import your bank statement (PDF or Excel). Chispudo detects duplicates so re-importing the same month never double-counts, and lets you categorize every movement.'),
          tip: t('Los movimientos se agrupan en 6 categorías principales para que los reportes sean claros.', 'Movements group into 6 main categories so reports stay clear.'),
        },
        {
          tab: t('Flujo', 'Flow'),
          title: t('Insights de tu gasto', 'Spending insights'),
          body: t('Chispudo analiza tu mes: detecta gastos hormiga (esos pequeños que suman), calcula tu tasa de ahorro y te muestra cómo cambió cada categoría contra el mes pasado y contra el mismo mes del año anterior.',
                  'Chispudo analyzes your month: it flags small recurring spends that add up, computes your savings rate, and shows how each category moved versus last month and the same month last year.'),
        },
        {
          tab: t('Flujo', 'Flow'),
          // ⛔ FASE JZ: Flujo y Patrimonio son segmentos SEPARADOS por decisión
          // del usuario. Este paso PROMETÍA que los dividendos del portafolio
          // aparecen acá solos, que es exactamente el comportamiento removido:
          // el tour afirmaba lo contrario de lo que la app hace.
          title: t('Separado de tu portafolio', 'Separate from your portfolio'),
          body: t('Flujo mide el dinero que entra y sale de tu vida diaria; lo que tu portafolio genera (dividendos, intereses) se mide en Patrimonio. Un dividendo que llega a tu banco cuenta aquí solo si lo registras o lo trae tu estado de cuenta. También puedes activar un recordatorio mensual por correo para no olvidar registrar tu mes.',
                  'Cash flow tracks the money moving through your daily life; what your portfolio generates (dividends, interest) is measured in Wealth. A dividend that lands in your bank counts here only if you record it or your statement brings it in. You can also enable a monthly email reminder so you never forget to log your month.'),
        },
      ]} />

      <PageTitle
        icon={Wallet}
        title={t('Flujo', 'Flow')}
        subtitle={t('Ingresos y gastos', 'Income & expenses')}
        actions={
          <div className="flex items-center flex-wrap gap-2 sm:gap-3">
            <MonthSelector month={month} year={year} onChange={(m, y) => { setMonth(m); setYear(y) }} lang={lang} />
            <button onClick={() => setModal('add')}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-opacity hover:opacity-90"
              style={{ color: '#ffffff', backgroundColor: 'var(--accent-blue)' }}>
              + {t('Agregar', 'Add')}
            </button>
            <button onClick={() => setModal('import')}
              className={SECONDARY_BTN} style={SECONDARY_STYLE}>
              {t('Importar', 'Import')}
            </button>
            <button onClick={() => setModal('auto')}
              className={`hidden sm:inline-flex items-center gap-1 ${SECONDARY_BTN}`} style={SECONDARY_STYLE}>
              <Zap size={12} style={{ color: 'var(--accent-blue)' }} /> {t('Automático', 'Automatic')}
            </button>
            {monthTransactions.length > 0 && (
              <button onClick={handleExportCsv}
                className={`hidden sm:inline-flex ${SECONDARY_BTN}`} style={SECONDARY_STYLE}>
                {t('Exportar', 'Export')}
              </button>
            )}
          </div>
        }
      />

        {/* El tipo de cambio, cuando de verdad afecta a esta pantalla. Son DOS
            avisos porque son dos cosas distintas: un ERROR significa que las
            filas en otra moneda se están sumando SIN convertir (el respaldo de
            `convert` es el monto crudo), y `stale` significa que la conversión
            SÍ ocurrió, con la última tasa conocida. Degradar en silencio es
            peor que fallar, y esta pantalla no lo tenía cubierto. */}
        {hasForeignRows && ratesError && (
          <PageBanner tone="error" actionLabel={t('Reintentar', 'Retry')} onAction={refreshRates}>
            {t('No se pudo traer el tipo de cambio, así que los movimientos en otra moneda se están sumando SIN convertir. Las cifras de abajo quedan mal hasta que se recupere.',
               'Exchange rates could not be fetched, so movements in another currency are being added up WITHOUT conversion. The figures below are wrong until it recovers.')}
          </PageBanner>
        )}
        {hasForeignRows && !ratesError && ratesStale && (
          <PageBanner tone="info" icon="refresh" actionLabel={t('Actualizar', 'Refresh')} onAction={refreshRates}>
            {t('Estás viendo la última tasa de cambio conocida, no la de ahora.',
               'You are seeing the last known exchange rate, not the current one.')}
          </PageBanner>
        )}

        {/* A brand-new user sees the empty state directly, not a stack of Q0.00
            cards and blank breakdowns with the guidance buried below the fold. */}
        {financeTransactions.length > 0 && <>
        {monthHasMovements && <ErrorBoundary cardId="FL-01" lang={lang}><MonthStatusBar
          status={analysis.status}
          partialMonth={analysis.partialMonth}
          daysElapsed={analysis.daysElapsed}
          daysInMonth={analysis.daysInMonth}
          daysLeft={analysis.daysLeft}
          reminderEnabled={reminderEnabled}
          onToggleReminder={handleToggleReminder}
          reminderEmail={settings?.financeReminderEmail || user?.email || ''}
          lang={lang}
        /></ErrorBoundary>}
        {recatPlan.length > 0 && (
          <InlineNotice
            tone="info"
            actionLabel={t('Reclasificar', 'Reclassify')}
            onAction={handleRecategorizeAll}
            busy={recatBusy}
          >
            {t(
              `${recatPlan.length} ${recatPlan.length === 1 ? 'movimiento quedó' : 'movimientos quedaron'} en "Otros" y ahora sí ${recatPlan.length === 1 ? 'se puede clasificar' : 'se pueden clasificar'}. No toca lo que corregiste a mano.`,
              `${recatPlan.length} ${recatPlan.length === 1 ? 'transaction is' : 'transactions are'} sitting in "Other" and can now be classified. Nothing you fixed by hand is touched.`
            )}
          </InlineNotice>
        )}
        {recatPlan.length === 0 && recatDone != null && recatFailed === 0 && (
          <InlineNotice tone="success">
            {t(`Listo: ${recatDone} reclasificados.`, `Done: ${recatDone} reclassified.`)}
          </InlineNotice>
        )}
        {/* Un fallo de escritura hoy se infiere de que el contador de arriba no
            bajó del todo, que es pedirle al usuario que lo deduzca. Se dice. */}
        {recatFailed > 0 && (
          <InlineNotice tone="warn" actionLabel={t('Reintentar', 'Retry')} onAction={handleRecategorizeAll} busy={recatBusy}>
            {t(`${recatDone} reclasificados, pero ${recatFailed} no se pudieron guardar. Vuelve a intentar.`,
               `${recatDone} reclassified, but ${recatFailed} could not be saved. Try again.`)}
          </InlineNotice>
        )}
        {/* Lo que de verdad pasa cuando un ahorro sale en -245%: no es que se
            gastara tres veces el sueldo, es que el sueldo todavía no está
            registrado. Decirlo es más útil que pintar el número de rojo. */}
        {monthHasMovements && analysis.incomeLooksUnlogged && (
          <InlineNotice tone="warn">
            {t('Este mes no tiene ningún ingreso recurrente registrado (salario, renta, freelance), así que el resultado de abajo mide gastos contra casi nada. Agrega tu ingreso del mes y las cifras cuadran.',
               'This month has no recurring income logged (salary, rent, freelance), so the result below measures spending against almost nothing. Add your income for the month and the figures line up.')}
          </InlineNotice>
        )}

        {/* Lo que es del MES. El bloque grande está gateado en que la CUENTA
            tenga historia, no el mes elegido, así que moverse a un mes sin
            movimientos dibujaba igual tres cards en Q0.00 y dos desgloses
            vacíos. Un mes vacío ahora lo DICE en una línea; las secciones que
            no son del mes (compromisos, el año, el perfil) se quedan enteras,
            porque sus datos siguen siendo ciertos. */}
        {monthHasMovements ? <>
        <ErrorBoundary cardId="FL-02" lang={lang}>
          <FinanceSummaryCards income={income} expenses={expenses}
            momIncomePct={analysis.momIncomePct} momExpensesPct={analysis.momExpensesPct}
            momComparable={analysis.momComparable}
            momTitle={momTitle}
            annualInMonth={annualInMonth}
            lang={lang} />
        </ErrorBoundary>

        {/* Una card por lado, cada grupo desplegable a sus categorías. Antes
            eran cuatro cards dibujando el mismo dinero dos veces por lado. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
          <ErrorBoundary cardId="FL-03a" lang={lang}>
          <BreakdownCard
            title={t('GASTOS', 'EXPENSES')}
            dotColor="var(--accent-red)"
            groups={analysis.groups}
            total={analysis.expenses}
            silentReason={deltaSilentReason}
            momTitle={momTitle}
            lang={lang}
          />
          </ErrorBoundary>
          <ErrorBoundary cardId="FL-03b" lang={lang}>
          <BreakdownCard
            title={t('INGRESOS', 'INCOME')}
            dotColor="var(--accent-green)"
            groups={analysis.incomeGroups}
            total={analysis.income}
            silentReason={deltaSilentReason}
            momTitle={momTitle}
            emptyText={t('Sin ingresos registrados este mes', 'No income logged this month')}
            lang={lang}
          />
          </ErrorBoundary>
        </div>

        <ErrorBoundary cardId="FL-04" lang={lang}><FinanceInsights insights={monthInsights} lang={lang} /></ErrorBoundary>
        </> : (
          <div className="card p-4 sm:p-5 text-center">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t(`Sin movimientos en ${monthLabel}.`, `No movements in ${monthLabel}.`)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t('Cambia de mes arriba, o agrega un movimiento.', 'Switch months above, or add a movement.')}
            </p>
          </div>
        )}

        {/* "¿A qué estoy amarrado hacia adelante?" Plata ya comprometida, que es
            otra pregunta que "cuánto gasté este mes". Cerrada por default: se
            consulta, no se lee de corrido. El encabezado solo existe si alguna
            de las tres cards tiene contenido (las tres se auto-ocultan). */}
        {hasCommitments && (
        <SectionCollapse title={t('Compromisos', 'Commitments')} id="commitments">
        {/* Cuotas activas: sale del campo `installment` que los estados ya
            traían. Recibe el HISTORIAL completo (los planes cruzan meses) y el
            mes seleccionado para la línea de "cuánto de este mes son cuotas".
            Se oculta sola sin planes. */}
        <ErrorBoundary cardId="FL-05" lang={lang}>
          <InstallmentPlansCard
            transactions={financeTransactions}
            convert={convert}
            monthKey={analysis.key}
            monthExpenses={analysis.expenses}
            lang={lang}
          />
        </ErrorBoundary>

        {/* La nomina de cargos recurrentes detectada del propio historial
            (feature 3 del plan): total mensual, alzas de precio y el cargo que
            este mes no cayo. Describe, no presupuesta. */}
        <ErrorBoundary cardId="FL-06" lang={lang}>
          <RecurringChargesCard
            transactions={financeTransactions}
            convert={convert}
            lang={lang}
          />
        </ErrorBoundary>

        {/* Cuanto tardas en pagar lo que gastas con la tarjeta: cada pago ataca
            el gasto mas viejo que sigue sin pagar (FIFO). Recibe el historial
            COMPLETO, no el mes: un cargo puede tardar varios meses en pagarse y
            recortarlo al mes seleccionado cortaria la cola a la mitad. */}
        <ErrorBoundary cardId="FL-07" lang={lang}>
          <DebtAgingCard
            transactions={financeTransactions}
            lang={lang}
          />
        </ErrorBoundary>
        </SectionCollapse>
        )}

        {/* "¿Qué pasó, fila por fila?" El triage va acá porque habla de esas
            mismas filas. Abierta por default: es el segundo motivo por el que
            se entra a esta pantalla. */}
        <SectionCollapse title={t('Movimientos', 'Transactions')} id="ledger" defaultOpen>
        {/* Triage de "Otros Gastos" por COMERCIO, ordenado por dinero: recibe
            el historial completo (una regla por comercio arregla todos sus
            meses). Se oculta sola cuando no queda nada que clasificar. */}
        <ErrorBoundary cardId="FL-08" lang={lang}>
          <UnclassifiedTriage
            transactions={financeTransactions}
            convert={convert}
            onApply={handleTriageApply}
            lang={lang}
          />
        </ErrorBoundary>

        <ErrorBoundary cardId="FL-09" lang={lang}>
          <FinanceTransactionList
            transactions={monthTransactions}
            onDelete={deleteFinanceTransaction}
            onRecategorize={handleRecategorize}
            onToggleAnnual={handleToggleAnnual}
            lang={lang}
          />
        </ErrorBoundary>
        </SectionCollapse>
        </>}

        {financeTransactions.length === 0 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📊</div>
            <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{t('Sin transacciones aún', 'No transactions yet')}</p>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              {t('Importa tu estado de cuenta bancario o agrega transacciones manualmente.',
                 'Import your bank statement or add transactions manually.')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button onClick={() => setModal('import')}
                className="px-4 py-2 rounded-lg hover:opacity-90 transition-colors text-sm font-medium" style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                {t('Importar Estado de Cuenta', 'Import Bank Statement')}
              </button>
              <button onClick={() => setModal('add')}
                className="px-4 py-2 rounded-lg border hover:bg-theme-elevated transition-colors text-sm"
                style={SECONDARY_STYLE}>
                {t('Agregar Manual', 'Add Manually')}
              </button>
              <button onClick={() => setModal('auto')}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg border hover:bg-theme-elevated transition-colors text-sm"
                style={SECONDARY_STYLE}>
                <Zap size={14} style={{ color: 'var(--accent-blue)' }} /> {t('Configurar Automático', 'Set Up Automatic')}
              </button>
            </div>
          </div>
        )}

        {/* "¿Cómo va el año?" Las dos son de horizonte anual y estaban separadas
            por media pantalla.

            ⛔ Esta sección y la del perfil van FUERA del gate de cuenta vacía, y
            no es un descuido. Meterlas adentro le quitaría a un usuario sin una
            sola transacción la única forma de configurar su perfil o de planear
            su año ANTES de importar nada, que es justo cuando quiere hacerlo. El
            gate se reparte por ORIGEN del dato: lo que se DERIVA de
            transacciones va adentro, lo que el usuario TECLEA va afuera. */}
        <SectionCollapse title={t('El año', 'The year')} id="year">
          {/* El año en una vista: doce columnas REALES con el punto de los
              pagos anuales; tocar un mes salta a él. Solo transacciones, jamás
              el plan (regla dura de incomePlan.js). Se auto-oculta sin datos. */}
          {hasYearInView && (
            <ErrorBoundary cardId="FL-10" lang={lang}>
              <YearInViewCard
                transactions={financeTransactions}
                convert={convert}
                year={year}
                month={month + 1}
                onSelectMonth={(m, y) => { setMonth(m); setYear(y) }}
                lang={lang}
              />
            </ErrorBoundary>
          )}
          <ErrorBoundary cardId="FL-11" lang={lang}>
            <IncomePlanCalendar
              plan={incomePlan}
              onSave={saveIncomePlan}
              financeTransactions={financeTransactions}
              convert={convert}
              lang={lang}
            />
          </ErrorBoundary>
        </SectionCollapse>

        {/* Configuración, no lectura del mes. Moved here from Settings: nobody
            found it there, and this data is time-sensitive. */}
        <SectionCollapse title={t('Mi perfil', 'My profile')} id="profile">
          <ErrorBoundary cardId="FL-12" lang={lang}>
            <FinancialProfileCard profile={profile} onSaveProfile={saveProfile} analysis={analysis} lang={lang}
              goals={goals} onSaveGoals={saveGoals} convert={convert} baseCurrency={settings?.baseCurrency || 'USD'} />
          </ErrorBoundary>
        </SectionCollapse>

      <ModalMount closing={modalClosing}>
      {modalShown === 'add' && (
        <AddFinanceTransactionModal
          onClose={() => setModal(null)}
          onAdd={addFinanceTransaction}
          lang={lang}
          month={month}
          year={year}
        />
      )}
      </ModalMount>

      <ModalMount closing={modalClosing}>
      {modalShown === 'import' && (
        <FileImportModal
          onClose={() => setModal(null)}
          onImportItems={addItem}
          onAddFinanceTransaction={addFinanceTransaction}
          onUpdateFinanceTransaction={updateFinanceTransaction}
          existingFinanceTransactions={financeTransactions}
          convert={convert}
          ingestRules={ingestRules}
          onLearnCategories={handleLearnCategories}
          onUpdateItem={updateItem}
          existingItems={items}
          lang={lang}
          context="finance"
        />
      )}
      </ModalMount>

      <ModalMount closing={modalClosing}>
      {modalShown === 'auto' && (
        <AutoCaptureModal onClose={() => setModal(null)} lang={lang} />
      )}
      </ModalMount>
    </PageShell>
  )
}
