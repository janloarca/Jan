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
import MonthSelector from '@/components/finance/MonthSelector'
import FinanceSummaryCards from '@/components/finance/FinanceSummaryCards'
import BreakdownCard from '@/components/finance/BreakdownCard'
import MonthStatusBar from '@/components/finance/MonthStatusBar'
import FinanceTransactionList from '@/components/finance/FinanceTransactionList'
import FinanceInsights from '@/components/finance/FinanceInsights'
import InstallmentPlansCard from '@/components/finance/InstallmentPlansCard'
import UnclassifiedTriage from '@/components/finance/UnclassifiedTriage'
import FinancialProfileCard from '@/components/finance/FinancialProfileCard'
import IncomePlanCalendar from '@/components/finance/IncomePlanCalendar'
import AddFinanceTransactionModal from '@/components/finance/AddFinanceTransactionModal'
import AutoCaptureModal from '@/components/finance/AutoCaptureModal'
import FileImportModal from '@/components/FileImportModal'
import { SkeletonCard, SkeletonTable } from '@/components/dashboard/Skeleton'
import InlineNotice from '@/components/ui/InlineNotice'
import { computeMonthlyAnalysis, buildFinanceInsights } from '@/lib/financeMonth'
import { isTransferCategory } from '@/lib/financeCategories'
import { financeReportCsv, downloadCsv } from '@/lib/financeCsv'
import { planRecategorize, isMachineDescribed } from '@/lib/recategorize'
import PageTour from '@/components/dashboard/PageTour'
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
    incomePlan,
    saveIncomePlan,
  } = useFirestoreItems()

  const { convert, loading: ratesLoading, refresh: refreshRates } = useExchangeRates()
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

  const recatPlan = useMemo(
    () => planRecategorize(financeTransactions, { rules: ingestRules }),
    [financeTransactions, ingestRules]
  )

  const handleRecategorizeAll = useCallback(async () => {
    if (recatPlan.length === 0) return
    setRecatBusy(true)
    let done = 0
    for (const change of recatPlan) {
      try {
        await updateFinanceTransaction(change.id, { category: change.to })
        done++
      } catch { /* keep going: one failed write must not strand the rest */ }
    }
    setRecatBusy(false)
    setRecatDone(done)
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
    // Structural skeleton instead of a bare spinner — same treatment the
    // dashboard and spreadsheet already get.
    return (
      <div className="min-h-screen bg-theme-base">
        {/* Mismo ancho y mismo ritmo que PageShell, para que el borde del
            contenido no salte cuando llegan los datos. */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SkeletonCard /><SkeletonCard /><SkeletonCard />
          </div>
          <SkeletonTable />
        </div>
      </div>
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

        {/* A brand-new user sees the empty state directly, not a stack of Q0.00
            cards and blank breakdowns with the guidance buried below the fold. */}
        {financeTransactions.length > 0 && <>
        <MonthStatusBar
          status={analysis.status}
          partialMonth={analysis.partialMonth}
          daysElapsed={analysis.daysElapsed}
          daysInMonth={analysis.daysInMonth}
          daysLeft={analysis.daysLeft}
          reminderEnabled={reminderEnabled}
          onToggleReminder={handleToggleReminder}
          reminderEmail={settings?.financeReminderEmail || user?.email || ''}
          lang={lang}
        />
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
        {recatPlan.length === 0 && recatDone != null && (
          <InlineNotice tone="success">
            {t(`Listo: ${recatDone} reclasificados.`, `Done: ${recatDone} reclassified.`)}
          </InlineNotice>
        )}
        {/* Lo que de verdad pasa cuando un ahorro sale en -245%: no es que se
            gastara tres veces el sueldo, es que el sueldo todavía no está
            registrado. Decirlo es más útil que pintar el número de rojo. */}
        {analysis.incomeLooksUnlogged && (
          <InlineNotice tone="warn">
            {t('Este mes no tiene ningún ingreso recurrente registrado (salario, renta, freelance), así que el resultado de abajo mide gastos contra casi nada. Agrega tu ingreso del mes y las cifras cuadran.',
               'This month has no recurring income logged (salary, rent, freelance), so the result below measures spending against almost nothing. Add your income for the month and the figures line up.')}
          </InlineNotice>
        )}

        <FinanceSummaryCards income={income} expenses={expenses}
          momIncomePct={analysis.momIncomePct} momExpensesPct={analysis.momExpensesPct}
          momComparable={analysis.momComparable}
          momTitle={momTitle}
          lang={lang} />

        {/* Una card por lado, cada grupo desplegable a sus categorías. Antes
            eran cuatro cards dibujando el mismo dinero dos veces por lado. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
          <BreakdownCard
            title={t('Gastos', 'Expenses')}
            groups={analysis.groups}
            total={analysis.expenses}
            silentReason={deltaSilentReason}
            momTitle={momTitle}
            lang={lang}
          />
          <BreakdownCard
            title={t('Ingresos', 'Income')}
            groups={analysis.incomeGroups}
            total={analysis.income}
            silentReason={deltaSilentReason}
            momTitle={momTitle}
            emptyText={t('Sin ingresos registrados este mes', 'No income logged this month')}
            lang={lang}
          />
        </div>

        <FinanceInsights insights={monthInsights} lang={lang} />

        {/* Cuotas activas: sale del campo `installment` que los estados ya
            traían. Recibe el HISTORIAL completo (los planes cruzan meses) y el
            mes seleccionado para la línea de "cuánto de este mes son cuotas".
            Se oculta sola sin planes. */}
        <InstallmentPlansCard
          transactions={financeTransactions}
          convert={convert}
          monthKey={analysis.key}
          monthExpenses={analysis.expenses}
          lang={lang}
        />

        {/* Triage de "Otros Gastos" por COMERCIO, ordenado por dinero: recibe
            el historial completo (una regla por comercio arregla todos sus
            meses). Se oculta sola cuando no queda nada que clasificar. */}
        <UnclassifiedTriage
          transactions={financeTransactions}
          convert={convert}
          onApply={handleTriageApply}
          lang={lang}
        />

        <FinanceTransactionList
          transactions={monthTransactions}
          onDelete={deleteFinanceTransaction}
          onRecategorize={handleRecategorize}
          lang={lang}
        />
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

        {/* El plan del año. Va fuera del bloque que exige transacciones: se
            puede planear el año sin haber registrado un solo movimiento, y de
            hecho es lo primero que alguien nuevo puede hacer acá. */}
        <IncomePlanCalendar
          plan={incomePlan}
          onSave={saveIncomePlan}
          financeTransactions={financeTransactions}
          convert={convert}
          lang={lang}
        />

        {/* Moved here from Settings: nobody found it there, and this data is
            time-sensitive — it belongs next to the money it describes. */}
        <FinancialProfileCard profile={profile} onSaveProfile={saveProfile} analysis={analysis} lang={lang} />

      <ModalMount closing={modalClosing}>
      {modalShown === 'add' && (
        <AddFinanceTransactionModal
          onClose={() => setModal(null)}
          onAdd={addFinanceTransaction}
          lang={lang}
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
