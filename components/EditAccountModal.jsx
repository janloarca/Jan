'use client'

import { useState, useEffect, useMemo } from 'react'
import { useEscClose } from '@/hooks/useEscClose'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { parseAmount, parseQuantity } from '@/lib/numberParse'
import { openingDepositDateFix } from '@/lib/originDeposits'
import { debtOptions, isProperty as isPropertyItem } from '@/lib/propertyEquity'
import DebtBreakdownPreview from './DebtBreakdownPreview'
import { validateItem } from '@/lib/validation'
import { toRawItem } from '@/lib/rawItem'
import { buildContributionFields, balanceQuantityPatch } from '@/lib/contributions'
import { getItemValue } from '@/components/dashboard/utils'
import { transferReversalPlan, reversalLines } from '@/lib/transferReversal'
import { cashflowReversalPlan, cashflowReversalLines } from '@/lib/cashflowReversal'
import { saleReversalPlan, saleReversalLines } from '@/lib/saleReversal'
import InlineCreateAccount from './InlineCreateAccount'
import FormSection from './FormSection'
import { InfoTip } from './ui/Tooltip'
import { currencyOptions } from '@/lib/currencies'
import { ACCRUAL_DAILY, dailyAccrualScheduleFields } from '@/lib/dailyAccrual'
import BusyLabel from '@/components/ui/BusyLabel'
import { todayLocalISO } from '@/lib/localDate'
import { useDirtyClose } from '@/hooks/useDirtyClose'
import DiscardHint from '@/components/ui/DiscardHint'

const ACCOUNT_TYPES = [
  { key: 'taxable', es: 'Tributaria', en: 'Taxable' },
  { key: 'retirement', es: 'Retiro', en: 'Retirement' },
  { key: 'tax-free', es: 'Libre', en: 'Tax-free' },
]

// Items opened from the dashboard are enriched: display-only fields plus
// currentPrice/purchasePrice already converted to baseCurrency. Strip the
// display fields and restore original-currency values before any Firestore write.
// UNA sola definicion, compartida con la celda de la Hoja: ver lib/rawItem.js.
const stripEnriched = toRawItem

// Some numeric fields arrive with float-math noise (a NAV/unit derived from
// reinvested dividends can read "1.018837890625"). Nobody edits a form by
// eyeballing 12 decimals: round only what's SHOWN when the field is first
// populated, trimming trailing zeros. If the user never touches the field,
// re-saving it is off by a fraction the size of a rounding error — immaterial
// for money, and worth it for a form a human can actually read.
function roundDisplay(v, maxDecimals = 6) {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!isFinite(n)) return ''
  return parseFloat(n.toFixed(maxDecimals)).toString()
}

// Transaction history dates render as DD/MM/YYYY (user request). Pure string
// reshuffle of the stored 'YYYY-MM-DD' — never new Date('YYYY-MM-DD'), which
// shifts the day in UTC-6. Anything not in that shape passes through as-is.
function formatTxDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : date
}

// FASE EK. "Existe valor actual y valor de compra y son los valores en
// equivalente en dólares lo que lo hace confuso" — a bare number with no
// currency in sight reads as baseCurrency by default, especially once it's a
// small number for a GTQ/MXN/etc. item. This never asks the user to do a
// mental conversion to sanity-check what they typed: it shows the live
// baseCurrency equivalent right under the field, computed from whatever is
// typed RIGHT NOW (not a stored value), so a wrong number or wrong currency
// pick is visible before Guardar, not after.
function FxHint({ amount, from, to, convert, t }) {
  if (!convert || !from || !to || from === to) return null
  const n = parseAmount(amount)
  if (!isFinite(n) || n === 0) return null
  const out = convert(n, from, to)
  if (!isFinite(out)) return null
  return (
    <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
      ≈ {out.toLocaleString(undefined, { style: 'currency', currency: to, maximumFractionDigits: 2 })} {t('(referencia, no se guarda)', '(reference only, not saved)')}
    </p>
  )
}

export default function EditAccountModal({ item, onClose, onSave, onDelete, existingItems = [], lang = 'es', allItems, onNavigate, onAddTransaction, onDeleteTransaction, onUpdateTransaction, transactions, lots = [], onExecuteContribution, onCreateDestination, baseCurrency, entities = [], findings = [], onOpenCashflow, convert }) {
  const trapRef = useFocusTrap()
  const [creatingDest, setCreatingDest] = useState(false)
  const [extraItems, setExtraItems] = useState([])
  const destItems = useMemo(() => [...existingItems, ...extraItems], [existingItems, extraItems])
  const [form, setForm] = useState({
    symbol: item.symbol || '',
    name: item.name || '',
    type: item.type || 'Stock',
    subtype: item.subtype || '',
    quantity: roundDisplay(item.quantity, 8),
    purchasePrice: roundDisplay(item._originalPurchasePrice ?? item.purchasePrice, 6),
    currentPrice: roundDisplay(item._originalPrice ?? item.currentPrice, 6),
    institution: item.institution || '',
    entityId: item.entityId || 'default',
    currency: item._originalCurrency || item.currency || 'USD',
    acquisitionDate: item.acquisitionDate || '',
    accountType: item.accountType || 'taxable',
    dividendAction: item.dividendAction || 'cash',
    incomeMode: item.incomeMode || 'fixed',
    incomeAmount: item.incomeAmount?.toString() || '',
    incomeRate: item.incomeRate?.toString() || '',
    incomePayDay: item.incomePayDay?.toString() || '',
    incomeMonths: item.incomeMonths || [],
    incomeDestination: item.incomeDestination || '',
    capitalReturn: item.capitalReturn?.toString() || '',
    capitalDestination: item.capitalDestination || '',
    // Inmueble (ver lib/propertyEquity.js). Los cuatro son de solo lectura para
    // el patrimonio: de aquí sale cuánto llevas pagado y tu capital propio.
    downPayment: item.downPayment?.toString() || '',
    linkedDebtId: item.linkedDebtId || '',
    adminFeeMonthly: item.adminFeeMonthly?.toString() || '',
    propertyTaxAnnual: item.propertyTaxAnnual?.toString() || '',
    rateType: item.rateType || 'fixed',
    accrual: item.accrual === ACCRUAL_DAILY ? ACCRUAL_DAILY : 'monthly',
    rateMin: item.rateMin?.toString() || '',
    rateMax: item.rateMax?.toString() || '',
    businessDayRule: item.businessDayRule || 'exact',
    maturityDate: item.maturityDate || '',
    maturityAction: item.maturityAction || 'return_capital',
    conversionDetails: item.conversionDetails || '',
    isIlliquid: item.isIlliquid || false,
    lastManualValuation: item.lastManualValuation?.toString() || '',
    custodyType: item.custodyType || '',
    custodyDetails: item.custodyDetails || '',
    notes: item.notes || '',
    tags: (item.tags || []).join(', '),
    taxJurisdiction: item.taxJurisdiction || '',
    assetCountry: item.assetCountry || '',
    safeCap: item.safeCap?.toString() || '',
    safeDiscount: item.safeDiscount?.toString() || '',
    safeType: item.safeType || 'post_money',
    investmentStage: item.investmentStage || '',
    roundValuation: item.roundValuation?.toString() || '',
    ownershipPct: item.ownershipPct?.toString() || '',
    committedCapital: item.committedCapital?.toString() || '',
    interestRate: item.interestRate?.toString() || '',
    ratePeriod: item.ratePeriod === 'monthly' ? 'monthly' : 'annual',
    debtScheme: item.debtScheme || '',
    originalPrincipal: item.originalPrincipal?.toString() || '',
    minimumPayment: item.minimumPayment?.toString() || '',
    debtTerm: item.debtTerm || '',
    installmentsTotal: item.installmentsTotal?.toString() || '',
    installmentsRemaining: item.installmentsRemaining?.toString() || '',
    monthlyPayment: item.monthlyPayment?.toString() || '',
    isReceivable: item.isReceivable || false,
    countInNetWorth: item.countInNetWorth || false,
    cardBrand: item.cardBrand || '',
    rewardType: item.rewardType || '',
    rewardRate: item.rewardRate?.toString() || '',
    rewardBalance: item.rewardBalance?.toString() || '',
    beneficiary: item.beneficiary || '',
    managementFee: item.managementFee?.toString() || '',
    managementFeeType: item.managementFeeType || 'percent',
    expenseRatio: item.expenseRatio?.toString() || '',
    entryFee: item.entryFee?.toString() || '',
    entryFeeMode: item.entryFeeMode || 'separate',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Same tap-to-confirm pattern as deleting the whole account, but scoped to
  // one row: a duplicate (e.g. a double-submitted backfill) needs a way to
  // remove just that one movement without leaving the modal.
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState(null)
  const [deletingTxId, setDeletingTxId] = useState(null)
  // Mismo formato que las filas del historial de arriba ("USD 1,234.56"), para
  // que el aviso de la confirmación no se lea como otra moneda o escala.
  const txMoney = (amount, currency) =>
    `${currency || form.currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  // FASE OD. Los planificadores de reversa razonan sobre precios RAW (en la
  // moneda del ítem): `existingItems` es la lista cruda de Firestore y
  // `allItems` (el tablero) viene ENRIQUECIDA con precios en la base. Con la
  // enriquecida, el aviso de "no tiene saldo para devolver" juzgaba una cuenta
  // en quetzales contra su valor en dólares.
  const planItems = (existingItems && existingItems.length) ? existingItems : (allItems || [])
  const handleDeleteTx = async (tx) => {
    if (confirmDeleteTxId !== tx.id) { setConfirmDeleteTxId(tx.id); return }
    if (!onDeleteTransaction) return
    setDeletingTxId(tx.id)
    try {
      await onDeleteTransaction(tx.id)
    } catch (e) {
      // FASE OB. El código crudo ('reversal-refused') no le dice nada a nadie.
      setError(e?.code === 'reversal-refused'
        ? t('No se borro: una cuenta no tiene saldo suficiente para devolver este movimiento. Ajusta su saldo primero.',
            'Not deleted: an account does not hold enough to give this movement back. Adjust its balance first.')
        // FASE OD. Una venta que no se puede deshacer trae su razon en el mensaje.
        : (e.message || t('No se pudo borrar el movimiento', 'Could not delete the movement')))
    }
    setConfirmDeleteTxId(null)
    setDeletingTxId(null)
  }

  // Inline edit of one movement: fix a wrong date/amount, or attach a stray
  // one (no _linkedItemId) to this account so both the history list and the
  // chart agree on who owns it.
  const [editingTxId, setEditingTxId] = useState(null)
  const [txDraft, setTxDraft] = useState({ date: '', amount: '', link: false })
  const [showAllTx, setShowAllTx] = useState(false)
  const [savingTxId, setSavingTxId] = useState(null)
  const startEditTx = (tx) => {
    setEditingTxId(tx.id)
    setConfirmDeleteTxId(null)
    setTxDraft({
      date: (tx.date || '').slice(0, 10),
      amount: String(tx.totalAmount ?? tx.amount ?? ''),
      link: !!tx._linkedItemId,
    })
  }
  const handleSaveTx = async (tx) => {
    if (!onUpdateTransaction) return
    const amt = parseAmount(txDraft.amount)
    if (!(amt > 0)) { setError(t('El monto debe ser mayor a 0', 'Amount must be greater than 0')); return }
    if (!txDraft.date) { setError(t('Elige la fecha del movimiento', 'Pick the movement date')); return }
    setSavingTxId(tx.id)
    setError('')
    try {
      const fields = { date: txDraft.date, totalAmount: amt }
      if (tx.amount != null) fields.amount = amt
      // Linking is one-way on purpose: attaching a stray movement is a fix,
      // detaching a correctly-linked one would only re-create the invisible-row
      // problem this whole flow exists to solve.
      if (txDraft.link && !tx._linkedItemId) fields._linkedItemId = item.id
      await onUpdateTransaction(tx.id, fields)
      setEditingTxId(null)
    } catch (e) {
      setError(e.message || t('No se pudo guardar el movimiento', 'Could not save the movement'))
    }
    setSavingTxId(null)
  }
  // Direct balance/quantity edits change NAV without a cash-flow transaction, which
  // the return math (Modified Dietz) would read as pure gain. When a save changes the
  // item's value we ask whether it's new money (→ DEPOSIT/WITHDRAWAL) or a value
  // adjustment, instead of silently inflating returns.
  const [pendingFlowConfirm, setPendingFlowConfirm] = useState(null)
  const [showIncome, setShowIncome] = useState(
    !!(item.incomeAmount || item.incomeRate || item.dividendYield || item.incomeMonths?.length)
  )
  const [showContribution, setShowContribution] = useState(false)
  const [contribType, setContribType] = useState('add')
  const [contribAmount, setContribAmount] = useState('')
  const [contribDate, setContribDate] = useState(new Date().toISOString().split('T')[0])
  const [contribDesc, setContribDesc] = useState('')
  const [contribSaving, setContribSaving] = useState(false)
  const [contribSuccess, setContribSuccess] = useState('')
  const [contribIsIncome, setContribIsIncome] = useState(
    item._contribIsIncome != null
      ? item._contribIsIncome
      : /bond|bono|inversion|inversión|alternative|alternativ|cdt|deposit|plazo|cash.?in/i.test(item.type || '')
  )

  const t = (es, en) => lang === 'es' ? es : en
  // FASE NC: mismo guard de telon que AddAccountModal (ver useDirtyClose).
  const { markDirty, onBackdropClick, backdropArmed } = useDirtyClose(onClose)
  const set = (k, v) => { markDirty(); setForm(prev => ({ ...prev, [k]: v })) }
  // FASE EK. The currency select used to just relabel the SAME number under a
  // new currency — switching USD → GTQ left the price field reading, say,
  // "1967.45", now claimed to be 1967.45 GTQ (≈ $258), a silent ~87% value
  // change with no visible warning. That silent relabeling is exactly what
  // corrupted XOCHI's real data in the first place (via a stripping bug
  // upstream that showed the item's USD-converted price as if it were its
  // own GTQ price — see app/spreadsheet/page.jsx). Never guess the intent
  // (mistyped currency vs. genuinely switching currency are OPPOSITE fixes);
  // ask instead, with the exact converted number shown, so a currency change
  // can never again silently rewrite what a price means.
  const [pendingCurrency, setPendingCurrency] = useState(null) // { from, to }
  const requestCurrencyChange = (to) => {
    const from = form.currency
    if (to === from) return
    const hasPrice = (parseAmount(form.purchasePrice)) > 0 || (parseAmount(form.currentPrice)) > 0
    if (!hasPrice || !convert) { set('currency', to); return }
    setPendingCurrency({ from, to })
  }
  const resolveCurrencyChange = (mode) => {
    if (!pendingCurrency) return
    const { from, to } = pendingCurrency
    if (mode === 'convert' && convert) {
      // El guard es el string CRUDO, no isFinite: parseAmount devuelve 0 ante
      // un campo vacio, asi que sin esto un cambio de moneda escribiria "0"
      // sobre un campo que el usuario habia dejado en blanco.
      if (form.purchasePrice !== '') set('purchasePrice', convert(parseAmount(form.purchasePrice), from, to).toString())
      if (form.currentPrice !== '') set('currentPrice', convert(parseAmount(form.currentPrice), from, to).toString())
    }
    set('currency', to)
    setPendingCurrency(null)
  }
  const handleDestCreated = (newId, newItem) => {
    setExtraItems(prev => [...prev, { id: newId, ...newItem }])
    set('incomeDestination', newId)
    setCreatingDest(false)
  }

  // Acción común/preferente de empresa PRIVADA: form.type sigue siendo
  // 'Stock' (matchea el regex de abajo) pero subtype la distingue de una
  // acción de mercado real. Sin este exclude, editar una ya creada perdía la
  // sección de ingreso/distribución (hasIncome = !isMarket) y mostraba
  // "Precio compra" (mercado) en vez de "Valor compra" (manual) — mismo bug
  // que isMarketAsset en AddAccountModal.jsx, ver isMarketPriced en utils.js.
  // 'private' es el subtype viejo (antes de separar común/preferente); se
  // sigue reconociendo aquí para no romper items ya guardados con ese valor.
  const isPrivateStock = form.type === 'Stock' && (form.subtype === 'private_common' || form.subtype === 'private_preferred' || form.subtype === 'private')
  const isMarket = /stock|crypto|fund|etf/i.test(form.type) && !/realestate/i.test(form.type) && !isPrivateStock
  const isBank = /bank|banco/i.test(form.type)
  const isBankLike = isBank || (!isMarket && (parseQuantity(form.quantity) || 1) === 1)

  // Movements that count against THIS asset. Matching has to mirror what the
  // chart does (PortfolioGrowthChart's scopedTransactions: id OR symbol) or the
  // two disagree in the worst possible way: a row with no _linkedItemId still
  // inflates "capital invertido" and the return %, but never appeared in this
  // list, so a duplicate was literally impossible to find and delete from the
  // UI. A row explicitly linked to a DIFFERENT item is still excluded.
  // Movements of THIS account: the ones filed against it, the ones that paid
  // INTO it from somewhere else, and the ones that left it FOR somewhere else.
  //
  // Incoming money used to be invisible here. A coupon is filed against the
  // asset that generated it (VITALI), so the cash account that actually
  // received the $240 listed nothing at all: the balance had grown and there
  // was no way to see why, or to find a duplicate payment and delete it. They
  // are marked `_incomingFrom` so the row can say where the money came from and
  // stay read-only for linking (it belongs to the source, not to this account).
  //
  // Outgoing transfers had the same blind spot the other way: TRANSFER moves
  // money between two tracked accounts (_originItemId → _linkedItemId), but
  // the type wasn't even in the filter list below, so an account that SENT
  // money showed nothing explaining why its balance dropped (FASE DU). Marked
  // `_outgoingTo` and, like incoming rows, read-only here: editing a transfer
  // means touching both accounts' balances, which this single-account editor
  // isn't set up to do safely.
  //
  // Y una TERCERA vez lo mismo, cerrada abajo: un gasto sobre otro activo
  // pagado desde esta cuenta (`_paidFromItemId`). Cuando el mismo punto ciego
  // aparece tres veces, la regla que queda escrita es que toda fila que MUEVE
  // el saldo de esta cuenta tiene que verse acá, sin importar contra qué activo
  // esté archivada.
  const linkedTransactions = useMemo(() => {
    const sym = (item.symbol || '').toUpperCase()
    const pool = allItems || existingItems || []
    const byId = new Map(pool.map((it) => [it.id, it]))
    const bySym = new Map(pool.filter((it) => it.symbol).map((it) => [String(it.symbol).toUpperCase(), it]))
    const byName = new Map(pool.filter((it) => it.name).map((it) => [String(it.name).toUpperCase(), it]))
    const resolve = (ref) => (ref
      ? (byId.get(ref) || bySym.get(String(ref).toUpperCase()) || byName.get(String(ref).toUpperCase()))
      : null)

    const own = []
    const incoming = []
    const outgoing = []
    ;(transactions || []).forEach((tx) => {
      if (tx.type === 'TRANSFER') {
        if (tx._linkedItemId === item.id) {
          const source = tx._originItemId ? byId.get(tx._originItemId) : null
          incoming.push({ ...tx, _incomingFrom: source ? (source.name || source.symbol) : null })
        } else if (tx._originItemId === item.id) {
          const dest = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
          outgoing.push({ ...tx, _outgoingTo: dest ? (dest.name || dest.symbol) : null })
        }
        return
      }
      // Un GASTO sobre otro activo, pagado desde esta cuenta: reparar el techo
      // de un inmueble baja el saldo de la cuenta que lo pagó (FASE KW), pero
      // la fila se archiva contra el INMUEBLE (`_linkedItemId`), así que acá no
      // aparecía nada. Es el MISMO punto ciego que ya se cerró para el dinero
      // entrante (un cupón que cae en otra cuenta) y para una transferencia
      // saliente, una tercera vez: el saldo bajaba y no había forma de ver por
      // qué. `_paidFromItemId` es el campo que ya se escribía justo para esto y
      // que hasta hoy no leía nadie. Read-only igual que los otros dos: el
      // movimiento vive en el activo al que se le gastó.
      if (tx.type === 'FEE') {
        if (tx._paidFromItemId === item.id) {
          const on = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
          outgoing.push({ ...tx, _outgoingTo: on ? (on.name || on.symbol) : null, _outgoingIsExpense: true })
        }
        return
      }
      if (!['DEPOSIT', 'WITHDRAWAL', 'DIVIDEND', 'INTEREST'].includes(tx.type)) return
      const isOwn = tx._linkedItemId
        ? tx._linkedItemId === item.id
        : (!!sym && (tx.symbol || '').toUpperCase() === sym)
      if (isOwn) { own.push(tx); return }
      // Routed here explicitly, or routed here by the source's income setting.
      let source = null
      if (tx._destinationItemId && tx._destinationItemId === item.id) {
        source = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
      } else if (tx.type === 'DIVIDEND' || tx.type === 'INTEREST') {
        const src = tx._linkedItemId ? byId.get(tx._linkedItemId) : null
        if (src && !tx._reinvested && src.dividendAction !== 'reinvest') {
          const dest = resolve(src.incomeDestination)
          if (dest && dest.id === item.id) source = src
        }
      } else return
      if (source || (tx._destinationItemId && tx._destinationItemId === item.id)) {
        incoming.push({ ...tx, _incomingFrom: source ? (source.name || source.symbol) : null })
      }
    })
    return [...own, ...incoming, ...outgoing].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }, [transactions, item.id, item.symbol, allItems, existingItems])

  const itemFindings = useMemo(() => (findings || []).filter((f) => f.itemId === item.id), [findings, item.id])

  const handleContribution = async () => {
    const amt = parseAmount(contribAmount)
    if (!amt || amt <= 0) return
    setContribSaving(true)
    setError('')
    try {
      const itemCurrency = form.currency || item._originalCurrency || item.currency || 'USD'
      const isAdd = contribType === 'add'
      const rawItem = stripEnriched(item)

      const txType = isAdd
        ? (contribIsIncome && !isBank ? 'DIVIDEND' : 'DEPOSIT')
        : 'WITHDRAWAL'
      const transaction = {
        date: contribDate,
        type: txType,
        symbol: item.symbol || item.name || '',
        description: contribDesc || (isAdd
          ? (txType === 'DIVIDEND'
            ? `${t('Ingreso de', 'Income from')} ${item.name || item.symbol}`
            : `${t('Aporte a', 'Contribution to')} ${item.name || item.symbol}`)
          : `${t('Retiro de', 'Withdrawal from')} ${item.name || item.symbol}`),
        totalAmount: amt,
        currency: itemCurrency,
        _linkedItemId: item.id,
        _source: 'manual_contribution',
        // FASE OB. Esta fila mueve el saldo en la misma operación: la marca
        // permite deshacerla al borrarla (lib/cashflowReversal.js).
        _balanceMoved: true,
        ...(txType === 'DIVIDEND' && isBankLike ? { _reinvested: true } : {}),
      }

      const { itemFields, newLot, lotClose } = buildContributionFields({
        item: {
          type: form.type,
          quantity: parseQuantity(form.quantity),
          purchasePrice: parseAmount(form.purchasePrice),
          currentPrice: parseAmount(form.currentPrice) || parseAmount(form.purchasePrice),
          symbol: item.symbol,
          institution: item.institution,
          currency: itemCurrency,
        },
        amount: amt,
        date: contribDate,
        isAdd,
        currency: itemCurrency,
      })
      if (itemFields.purchasePrice != null) set('purchasePrice', itemFields.purchasePrice.toString())
      if (itemFields.currentPrice != null) set('currentPrice', itemFields.currentPrice.toString())
      if (itemFields.quantity != null) set('quantity', itemFields.quantity.toString())

      const prefFields = (!isBank && isAdd && item._contribIsIncome !== contribIsIncome)
        ? { _contribIsIncome: contribIsIncome }
        : undefined

      if (onExecuteContribution) {
        await onExecuteContribution({ itemId: item.id, itemFields, transaction, newLot, lotClose, prefFields })
      } else {
        await onSave({ ...rawItem, ...itemFields })
        if (onAddTransaction) await onAddTransaction(transaction)
      }

      setContribAmount('')
      setContribDesc('')
      setShowContribution(false)
      setContribSuccess(isAdd ? t('Aporte registrado', 'Contribution recorded') : t('Retiro registrado', 'Withdrawal recorded'))
      setTimeout(() => setContribSuccess(''), 3000)
    } catch (err) {
      setError(err.message)
    }
    setContribSaving(false)
  }
  const isBondOrAlt = /bond|bono|inversion|alternative|alternativ/i.test(form.type)
  const isCrypto = /crypto|cripto/i.test(form.type)
  const isDebt = /debt|deuda|pasivo|liability/i.test(form.type)
  const isProperty = isPropertyItem({ type: form.type })
  const propertyDebtOptions = useMemo(() => debtOptions(existingItems.filter(it => it.id !== item.id)), [existingItems, item.id])
  const isReceivable = form.isReceivable
  const isCreditCard = form.subtype === 'credit_card' || /credit.?card|tarjeta/i.test(form.type)
  const isAlternative = /alternative|alternativ/i.test(form.type)
  const hasIncome = !isMarket && !isDebt

  useEscClose(onClose)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const rawItem = stripEnriched(item)
      const updated = {
        ...rawItem,
        symbol: form.symbol.trim(),
        name: form.name.trim(),
        type: form.type,
        subtype: form.subtype || '',
        quantity: parseQuantity(form.quantity),
        purchasePrice: parseAmount(form.purchasePrice),
        // ⛔ Guardar una cuenta de SALDO no puede dejarla ilegible.
        //
        // En una cuenta de saldo el campo de cantidad NO se muestra (hay un
        // solo campo, el saldo, y su onChange ya normaliza la cantidad a 1),
        // así que el usuario no tiene forma de expresar una cantidad: no hay
        // intención que pisar. Pero el formulario se siembra con la cantidad
        // GUARDADA, así que abrir la cuenta y presionar Guardar sin tocar el
        // saldo reescribía ese cero tal cual, y el saldo seguía leyéndose como
        // 0.00 en la Hoja y en el patrimonio.
        //
        // Ese era un callejón sin salida documentado: el editor es la única
        // pantalla donde uno intentaría arreglar un saldo a mano, y era
        // justamente la que no podía. Ahora abrir y guardar REPARA la cuenta.
        //
        // Misma definición compartida que usan las cuatro ramas de
        // `planCellEdit` y el motor de aportes: solo se escribe 1 cuando la
        // cantidad guardada NO SIRVE, una legítima distinta de 1 se deja
        // intacta, y un saldo en cero apaga la cantidad.
        institution: form.institution.trim(),
        // null (not undefined) clears the field on merge — the item goes back
        // to Personal; every entity filter treats null as 'default'.
        entityId: form.entityId && form.entityId !== 'default' ? form.entityId : null,
        currency: form.currency,
        acquisitionDate: form.acquisitionDate || '',
        accountType: form.accountType,
      }

      if (form.currentPrice && !isMarket) updated.currentPrice = parseAmount(form.currentPrice)
      if (isBank) updated.currentPrice = parseAmount(form.purchasePrice)

      // ⛔ Va DESPUES de que el saldo quedo resuelto, y esa posicion es el
      // arreglo, no un detalle.
      //
      // En una cuenta de saldo el usuario ve UN solo campo (el saldo) que
      // escribe `form.purchasePrice`; `currentPrice` se DERIVA de el, dos
      // lineas arriba. Leer `form.currentPrice` para decidir la cantidad
      // agarraba el valor VIEJO: teclear 0 dejaba `form.currentPrice` en 240,
      // asi que la cantidad se juzgaba contra 240, se conservaba en 1, y la
      // cuenta se guardaba con los dos precios en cero y cantidad 1. Con eso
      // `getItemPrice` cae en cascada a `price`/`cost` y un residuo ahi la
      // RESUCITA: exactamente el saldo que volvia a 240 despues de vaciarla.
      //
      // Se juzga contra `updated.currentPrice`, que es el saldo que de verdad
      // se va a guardar, asi que no puede volver a desincronizarse.
      if (isBankLike) Object.assign(updated, balanceQuantityPatch({ quantity: updated.quantity }, updated.currentPrice))

      // FASE HV. Desde cuándo es cierto el saldo guardado. Se sella en CADA
      // guardado de un activo que no cotiza, no solo cuando el número cambia:
      // el usuario está mirando el campo y apretando Guardar, y eso es
      // justamente afirmar que ese número vale hoy. Ver AddAccountModal para
      // qué resuelve el campo. La contra, asumida a propósito: editar solo el
      // nombre de una cuenta cuyo saldo quedó viejo también lo declara actual.
      // Es visible y corregible (el desglose de rendimiento que se deduce de
      // ahí se propone, nunca se aplica solo), y la alternativa (sellar solo
      // cuando el monto cambia) deja fuera el caso de teclear el mismo número
      // a propósito para confirmarlo.
      // ⛔ FASE MS. El DIA LOCAL, nunca `toISOString()`, que devuelve el dia
      // UTC. La spec dice literal que este sello significa "hoy: el usuario
      // esta mirando el campo y apretando Guardar", y eso es el dia que el
      // usuario esta viviendo. En Guatemala (UTC-6) el dia UTC rota a las 6pm,
      // asi que guardar un saldo de noche lo sellaba con la fecha de MAÑANA, y
      // la regla del saldo es "HASTA balanceAsOf manda el saldo": un cupon del
      // dia siguiente quedaba dentro de la foto y NO se acreditaba nunca.
      // Reproducido: guardar a las 7pm del 31 de agosto sellaba 2026-09-01.
      if (!isMarket) updated.balanceAsOf = todayLocalISO()

      // Dividend settings (market assets)
      if (isMarket) {
        updated.dividendAction = form.dividendAction
        // FASE OB. Misma regla que la rama de abajo (FASE HV2): reinvertir y
        // tener destino son excluyentes. Acá el destino SOBREVIVÍA al cambio,
        // y la limpieza del motor seguía debitando esa cuenta por cupones que
        // ya iban a acciones.
        if (updated.dividendAction === 'reinvest') updated.incomeDestination = ''
        else if (form.incomeDestination) updated.incomeDestination = form.incomeDestination
      }

      // Income settings (non-market assets)
      if (hasIncome && showIncome) {
        updated.incomeMode = form.incomeMode
        updated.rateType = form.rateType
        if (form.rateType === 'variable') {
          updated.rateMin = parseAmount(form.rateMin) || 0
          updated.rateMax = parseAmount(form.rateMax) || 0
          updated.incomeRate = (updated.rateMin + updated.rateMax) / 2
        } else if (form.incomeMode === 'percent') {
          updated.incomeRate = parseAmount(form.incomeRate) || 0
        } else {
          updated.incomeAmount = parseAmount(form.incomeAmount) || 0
        }
        if (form.accrual === ACCRUAL_DAILY && form.rateType !== 'continuous') {
          // FASE KT. Mismo helper que el alta: un solo lugar define qué
          // calendario implica el devengo diario.
          updated.accrual = ACCRUAL_DAILY
          Object.assign(updated, dailyAccrualScheduleFields())
          updated.businessDayRule = 'exact'
        } else if (form.rateType !== 'continuous') {
          // Volver a mensual tiene que BORRAR la marca, o el activo seguiría
          // devengando diario con un calendario que el usuario ya cambió.
          updated.accrual = 'monthly'
          // Ver AddAccountModal: 1..31, y 31 significa "último día del mes".
          updated.incomePayDay = Math.min(31, Math.max(1, parseInt(form.incomePayDay) || 1))
          updated.incomeMonthsExplicit = form.incomeMonths.length > 0
          updated.incomeMonths = form.incomeMonths.length > 0 ? form.incomeMonths : [0,1,2,3,4,5,6,7,8,9,10,11]
          updated.businessDayRule = form.businessDayRule
        } else {
          updated.accrualMethod = 'compound_continuous'
          updated.incomeMonths = [0,1,2,3,4,5,6,7,8,9,10,11]
          updated.incomeMonthsExplicit = true
        }
        // FASE HV2. `dividendAction` se guardaba SOLO en la rama de activos de
        // mercado, así que el selector "¿Qué hacés con los pagos?" que este
        // mismo formulario muestra para un bono, un banco o un alternativo era
        // un control que no hacía nada: elegir "Se reinvierten" y guardar
        // dejaba el ítem en 'cash' igual. Reportado por el usuario, que puso
        // reinvertir en su fondo líquido y siguió viendo el aviso de "¿a qué
        // cuenta llegan los pagos?" (ese hallazgo excluye a los que reinvierten,
        // así que seguía saliendo justamente porque el cambio nunca se guardó).
        // Solo se veía al EDITAR: al crear la cuenta sí se guardaba.
        updated.dividendAction = form.dividendAction || 'cash'
        // Reinvertir y tener destino son excluyentes: el dinero se queda o se
        // va. Sin esto, un destino viejo sobrevive al cambio y los motores que
        // miran `incomeDestination` siguen mandando el pago a otra cuenta.
        if (updated.dividendAction === 'reinvest') updated.incomeDestination = ''
        else if (form.incomeDestination) updated.incomeDestination = form.incomeDestination
        if (form.capitalReturn) {
          updated.capitalReturn = parseAmount(form.capitalReturn) || 0
          if (form.capitalDestination) updated.capitalDestination = form.capitalDestination
        }
      }

      // Maturity
      if (form.maturityDate) {
        updated.maturityDate = form.maturityDate
        updated.maturityAction = form.maturityAction
        if (form.conversionDetails) updated.conversionDetails = form.conversionDetails
      } else {
        updated.maturityDate = ''
      }

      // Illiquid
      updated.isIlliquid = form.isIlliquid
      if (form.isIlliquid && form.lastManualValuation) {
        updated.lastManualValuation = parseAmount(form.lastManualValuation) || 0
        updated.lastValuationDate = new Date().toISOString().split('T')[0]
        updated.valuationMethod = 'manual'
      }

      // Custody
      if (form.custodyType) {
        updated.custodyType = form.custodyType
        updated.custodyDetails = form.custodyDetails
      }

      // Notes & beneficiary
      updated.notes = form.notes || ''
      updated.tags = form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : []
      updated.beneficiary = form.beneficiary || ''

      // Fees
      if (form.managementFee) {
        updated.managementFee = parseAmount(form.managementFee) || 0
        updated.managementFeeType = form.managementFeeType || 'percent'
      }
      if (form.expenseRatio) updated.expenseRatio = parseAmount(form.expenseRatio) || 0
      if (form.entryFee) {
        updated.entryFee = parseAmount(form.entryFee) || 0
        updated.entryFeeMode = form.entryFeeMode || 'separate'
      }

      // Tax jurisdiction & asset country
      updated.taxJurisdiction = form.taxJurisdiction || ''
      updated.assetCountry = form.assetCountry || ''

      // SAFE fields
      if (isAlternative && form.subtype === 'safe_note') {
        updated.safeType = form.safeType
        updated.safeCap = parseAmount(form.safeCap) || 0
        updated.safeDiscount = parseAmount(form.safeDiscount) || 0
      }

      // VC/startup direct-investment fields — purely informational, see
      // AddAccountModal's comment on the same fields.
      if (isAlternative && form.subtype === 'private_equity') {
        updated.investmentStage = form.investmentStage || ''
        updated.roundValuation = parseAmount(form.roundValuation) || 0
        updated.ownershipPct = parseAmount(form.ownershipPct) || 0
        updated.committedCapital = parseAmount(form.committedCapital) || 0
      }

      // Inmueble: enganche, préstamo vinculado y los dos costos fijos. Se
      // escriben SIEMPRE (no solo si tienen valor) para que borrar un campo de
      // verdad lo borre: con `if (form.x)` un cero o un vacío dejarían vivo el
      // valor viejo, que es cómo alguien "quita" el enganche y sigue viéndolo.
      // ⛔ Ninguno entra a getItemValue: el patrimonio no se mueve.
      if (isProperty) {
        updated.downPayment = parseAmount(form.downPayment) || 0
        updated.linkedDebtId = form.linkedDebtId || ''
        updated.adminFeeMonthly = parseAmount(form.adminFeeMonthly) || 0
        updated.propertyTaxAnnual = parseAmount(form.propertyTaxAnnual) || 0
      }

      // Debt fields
      if (isDebt) {
        if (form.isReceivable) {
          updated.isReceivable = true
          updated.isDebt = false
          updated.countInNetWorth = form.countInNetWorth || false
        } else {
          updated.isDebt = true
          updated.isReceivable = false
        }
        updated.interestRate = parseAmount(form.interestRate) || 0
        // FASE LT: sin período, una tasa mensual se lee como anual (12x menos
        // interés). Ver lib/debtMath.js.
        updated.ratePeriod = form.ratePeriod === 'monthly' ? 'monthly' : 'annual'
        if (form.debtScheme) updated.debtScheme = form.debtScheme
        if (form.originalPrincipal) updated.originalPrincipal = parseAmount(form.originalPrincipal) || 0
        updated.minimumPayment = parseAmount(form.minimumPayment) || 0
        updated.monthlyPayment = parseAmount(form.monthlyPayment) || 0
        updated.debtTerm = form.debtTerm || ''
        updated.installmentsTotal = parseInt(form.installmentsTotal) || 0
        updated.installmentsRemaining = parseInt(form.installmentsRemaining) || 0
        if (form.maturityDate) updated.maturityDate = form.maturityDate
        if (isCreditCard) {
          updated.cardBrand = form.cardBrand || ''
          updated.rewardType = form.rewardType || ''
          updated.rewardRate = parseAmount(form.rewardRate) || 0
          updated.rewardBalance = parseAmount(form.rewardBalance) || 0
        }
      }

      // Same guardrails as file imports — manual edits previously skipped them.
      const validationErrors = validateItem(updated)
      if (validationErrors.length > 0) {
        setError(validationErrors.join(' · '))
        setSaving(false)
        return
      }

      // Detect a value change that has no matching cash-flow transaction. Only the
      // ambiguous cases prompt: bank-like balances (deposit vs interest?) and market
      // quantities (bought more vs correction?). Debts/receivables are skipped, and
      // valuation-style price edits on non-market assets are treated as adjustments.
      let flowDelta = 0
      if (!isDebt && !form.isReceivable) {
        const rawQty = Number(rawItem.quantity) || 0
        const rawPP = Number(rawItem.purchasePrice) || 0
        if (isBankLike) {
          flowDelta = (updated.purchasePrice || 0) - rawPP
        } else if (isMarket) {
          const unitPrice = Number(rawItem.currentPrice) || parseAmount(form.currentPrice)
          flowDelta = ((updated.quantity || 0) - rawQty) * unitPrice
        } else {
          // FASE OA. Un bono/alternativo guardado con cantidad distinta de 1
          // (la forma que deja el bug de la cantidad heredada al cambiar de
          // tipo) no entraba a NINGUNA rama: cambiarle la cantidad no
          // preguntaba nada y no escribia ningun movimiento. Su valor es
          // cantidad x valor de compra, asi que el delta que importa es el del
          // TOTAL, la misma pregunta que ya se hace para una cuenta de saldo.
          flowDelta = ((updated.quantity || 0) * (updated.purchasePrice || 0)) - (rawQty * rawPP)
        }
      }
      if (Math.abs(flowDelta) > 0.01) {
        setSaving(false)
        setPendingFlowConfirm({ delta: flowDelta, updated })
        return
      }

      await finalizeSave(updated, false, 0)
      return
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const finalizeSave = async (updated, createFlow, delta) => {
    setSaving(true)
    setError('')
    try {
      await onSave(updated)
      // ⛔ Extensión de la lógica congelada G, aprobada por el usuario el 23 ago
      // 2026. El depósito de apertura se fecha AL CREAR con la fecha de
      // adquisición, y editarla acá actualizaba solo el ítem: el rebobinado del
      // Spreadsheet usa la fecha del DEPÓSITO, así que con el depósito en agosto
      // y la fecha corregida a enero cada mes anterior quedaba en 0.00, para
      // siempre. Se mueve la FECHA, nunca el monto (sigue siendo principal +
      // comisión, escrito por el handleSubmit único de AddAccountModal).
      //
      // Best-effort a propósito: el ítem ya se guardó, y hacer fallar el guardado
      // entero por no poder re-fechar un movimiento sería peor que el hueco.
      if (onUpdateTransaction && updated.acquisitionDate !== item.acquisitionDate) {
        const fix = openingDepositDateFix(transactions, item, updated.acquisitionDate)
        if (fix) {
          try { await onUpdateTransaction(fix.id, { date: fix.date }) } catch (err) { console.error('[opening-deposit]', err.message) }
        }
      }
      if (createFlow && onAddTransaction && Math.abs(delta) > 0.01) {
        await onAddTransaction({
          date: new Date().toISOString().split('T')[0],
          type: delta > 0 ? 'DEPOSIT' : 'WITHDRAWAL',
          symbol: item.symbol || item.name || '',
          description: `${delta > 0 ? t('Aporte a', 'Contribution to') : t('Retiro de', 'Withdrawal from')} ${item.name || item.symbol}`,
          totalAmount: Math.abs(delta),
          currency: form.currency || item._originalCurrency || item.currency || 'USD',
          _linkedItemId: item.id,
          _source: 'manual_edit_adjustment',
        })
      }
      setPendingFlowConfirm(null)
      if (onNavigate) {
        onNavigate('next')
      } else {
        onClose()
      }
    } catch (err) { setError(err.message) }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    try {
      await onDelete(item.id)
      onClose()
    } catch (err) { setError(err.message) }
  }

  // Check if other items reference this one
  const referencedBy = existingItems.filter(it =>
    it.id !== item.id && (it.incomeDestination === item.id || it.capitalDestination === item.id
      || it.linkedDebtId === item.id)
  )

  const inputCls = 'w-full px-3 py-2 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded-lg text-sm text-[var(--text-primary,white)] focus:outline-none focus:border-blue-500/50'
  const labelCls = 'text-xs text-[var(--text-secondary,#94a3b8)] mb-1 block'
  // Ver AddAccountModal: 29/30/31 no caben en todos los meses, y la app paga el
  // último día real de cada uno.
  const payDayHint = (parseInt(form.incomePayDay, 10) || 0) >= 29
    ? t('En los meses más cortos se paga el último día.', 'In shorter months it pays on the last day.')
    : null

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onBackdropClick} role="dialog" aria-modal="true" aria-labelledby="edit-acct-modal-title">
      <DiscardHint show={backdropArmed} lang={lang} />
      <div ref={trapRef} className="modal-glass max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--card-border,#38383A)]">
          <h2 id="edit-acct-modal-title" className="text-lg font-bold text-[var(--text-primary,white)]">{t('Editar', 'Edit')} {item.name || item.symbol}</h2>
          <button onClick={onClose} className="text-[var(--text-secondary,#94a3b8)] hover:text-[var(--text-primary,white)] text-xl leading-none" aria-label="Close edit asset modal">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 border rounded-lg text-sm" role="alert" aria-live="assertive" style={{ backgroundColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--text-negative) 20%, transparent)', color: 'var(--text-negative)' }}>{error}</div>}

          {/* Data-gap findings for THIS item, same engine + same "Resolver"
              action as ChispuSuggestions and AccountReviewModal — someone who
              opened the editor directly (not through "Completar información")
              should still see and fix a gap without having to know that other
              screen exists (FASE DU). */}
          {itemFindings.length > 0 && (
            <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--alert-warn-bg)', border: '1px solid var(--alert-warn-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--alert-warn-icon)' }}>{t('Chispu detectó:', 'Chispu detected:')}</p>
              <ul className="mt-1.5 space-y-1.5">
                {itemFindings.map((f) => (
                  <li key={f.id} className="text-xs flex items-start justify-between gap-2" style={{ color: 'var(--alert-warn-icon)' }}>
                    <span>· {lang === 'es' ? f.textEs : f.textEn}</span>
                    {f.action?.kind === 'cashflow' && onOpenCashflow && (
                      <button type="button" onClick={() => { onClose(); onOpenCashflow(f.action.prefill || { flowType: 'DEPOSIT', origin: 'external', linkedId: item.id, alreadyReflected: true }) }}
                        className="shrink-0 underline font-medium" style={{ color: 'var(--alert-warn-icon)' }}>
                        {t('Resolver', 'Resolve')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sector badge */}
          {item.sector && (
            <div className="flex gap-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)', color: 'var(--accent-blue)' }}>{item.sector}</span>
              {item.industry && <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-purple) 10%, transparent)', color: 'var(--accent-purple)' }}>{item.industry}</span>}
              {item.exchangeName && <span className="text-xs bg-[var(--input-bg,#000000)] text-[var(--text-muted,#475569)] px-2 py-0.5 rounded">{item.exchangeName}</span>}
            </div>
          )}

          {/* Section 1: Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-name" className={labelCls}>{t('Nombre', 'Name')}</label>
              <input id="edit-name" value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="edit-institution" className={labelCls}>{t('Institución', 'Institution')}</label>
              <input id="edit-institution" value={form.institution} onChange={e => set('institution', e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Move the account between entities (personal / business / family) */}
          {entities.length > 1 && (
            <div>
              <label htmlFor="edit-entity" className={labelCls}>{t('Entidad', 'Entity')}</label>
              <select id="edit-entity" value={form.entityId} onChange={e => set('entityId', e.target.value)} className={inputCls}>
                {entities.map((en) => (
                  <option key={en.id} value={en.id}>{en.icon || '📁'} {en.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="edit-type" className={labelCls}>{t('Tipo', 'Type')}</label>
              <select id="edit-type" value={form.type} onChange={e => set('type', e.target.value)} className={inputCls}>
                <option value="Stock">Stock</option>
                <option value="Crypto">Crypto</option>
                <option value="Fund">{t('Fondo/ETF', 'Fund/ETF')}</option>
                <option value="Bond">{t('Bono', 'Bond')}</option>
                <option value="Bank">{t('Banco', 'Bank')}</option>
                <option value="RealEstate">{t('Inmueble', 'Real Estate')}</option>
                <option value="Alternative">{t('Alternativo', 'Alternative')}</option>
                <option value="Debt">{t('Deuda/Pasivo', 'Debt/Liability')}</option>
                <option value="Inmueble">{t('Inmueble (legacy)', 'Real Estate (legacy)')}</option>
                <option value="Inversion">{t('Inversión (legacy)', 'Investment (legacy)')}</option>
              </select>
            </div>
            <div>
              <label htmlFor="edit-currency" className={labelCls}>{t('Moneda', 'Currency')}</label>
              {/* FASE ID: misma regla que AddAccountModal: si el item guarda una
                  moneda fuera de la lista fija (ej. 'GBp', peniques de Londres),
                  se agrega como opción para que el select nunca muestre una
                  moneda distinta de la guardada (un value sin opción renderiza
                  la primera, USD, y se lee como dato corrupto). */}
              <select id="edit-currency" value={form.currency} onChange={e => requestCurrencyChange(e.target.value)} className={inputCls}>
                {currencyOptions(form.currency).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="edit-account-type" className={labelCls}>{t('Cuenta', 'Account')}</label>
              <select id="edit-account-type" value={form.accountType} onChange={e => set('accountType', e.target.value)} className={inputCls}>
                {ACCOUNT_TYPES.map(at => <option key={at.key} value={at.key}>{lang === 'es' ? at.es : at.en}</option>)}
              </select>
            </div>
          </div>

          {/* Un cambio de moneda con precios ya cargados NUNCA se aplica solo
              — adivinar entre "convertir" y "solo re-etiquetar" es adivinar
              la intención, y las dos son arreglos opuestos. */}
          {pendingCurrency && (
            <div className="rounded-lg p-3 text-xs space-y-2" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-orange) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-orange) 30%, transparent)' }}>
              <p style={{ color: 'var(--text-secondary)' }}>
                {t(
                  `Cambiaste la moneda de ${pendingCurrency.from} a ${pendingCurrency.to}. ¿Los montos que ves están en ${pendingCurrency.from} y hay que convertirlos, o solo escribiste mal la moneda y el número ya está bien en ${pendingCurrency.to}?`,
                  `You changed the currency from ${pendingCurrency.from} to ${pendingCurrency.to}. Are the amounts you see in ${pendingCurrency.from} and need converting, or was ${pendingCurrency.from} just the wrong pick and the number is already right in ${pendingCurrency.to}?`
                )}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => resolveCurrencyChange('convert')}
                  className="px-2.5 py-1.5 rounded-lg font-medium" style={{ backgroundColor: 'var(--accent-orange)', color: '#fff' }}>
                  {t('Convertir los montos', 'Convert the amounts')}
                </button>
                <button type="button" onClick={() => resolveCurrencyChange('relabel')}
                  className="px-2.5 py-1.5 rounded-lg font-medium border" style={{ borderColor: 'var(--card-border)', color: 'var(--text-secondary)' }}>
                  {t('Solo cambiar la etiqueta', 'Just change the label')}
                </button>
              </div>
            </div>
          )}

          {/* Section 2: Position */}
          {isBank ? (
            <div>
              <label htmlFor="edit-current-balance" className={labelCls}>{t('Saldo actual', 'Current balance')} {t('en', 'in')} {form.currency}</label>
              <input id="edit-current-balance" value={form.purchasePrice} onChange={e => { set('purchasePrice', e.target.value); set('quantity', '1') }}
                type="text" inputMode="decimal" className={inputCls} />
              <FxHint amount={form.purchasePrice} from={form.currency} to={baseCurrency} convert={convert} t={t} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-quantity" className={labelCls}>{t('Cantidad', 'Quantity')} <InfoTip text={isMarket
                  ? t('Número de unidades, acciones o participaciones que posees.', 'Number of units, shares or participations you own.')
                  : t('Para un bono o un alternativo lo normal es cantidad 1 con el monto completo en el valor de compra. Si pones más de 1, el valor de compra se lee POR UNIDAD y el total es cantidad × valor.', 'For a bond or an alternative the norm is quantity 1 with the full amount as the purchase value. If you set more than 1, the purchase value is read PER UNIT and the total is quantity × value.')} /></label>
                <input id="edit-quantity" value={form.quantity} onChange={e => set('quantity', e.target.value)}
                  type="text" inputMode="decimal" className={inputCls} />
              </div>
              <div>
                <label htmlFor="edit-purchase-price" className={labelCls}>
                  {isMarket ? t('Precio compra', 'Buy price') : ((parseQuantity(form.quantity) || 1) === 1 ? t('Valor compra', 'Purchase value') : t('Valor compra por unidad', 'Purchase value per unit'))} {t('en', 'in')} {form.currency}
                  <InfoTip text={t('Precio por unidad al momento de la compra. Valor total = cantidad × precio.', 'Price per unit at time of purchase. Total value = quantity × price.')} />
                </label>
                <input id="edit-purchase-price" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)}
                  type="text" inputMode="decimal" className={inputCls} />
                <FxHint amount={form.purchasePrice} from={form.currency} to={baseCurrency} convert={convert} t={t} />
              </div>
            </div>
          )}

          {!isMarket && !isBank && (
            <div>
              <label htmlFor="edit-current-price" className={labelCls}>
                {t('Valor actual', 'Current value')} {t('en', 'in')} {form.currency}
                <InfoTip text={t('El valor de mercado actual. Si lo dejas vacío, se usa el precio de compra. Para activos de mercado se actualiza automáticamente.', 'Current market value. If empty, purchase price is used. Market assets update automatically.')} />
              </label>
              <input id="edit-current-price" value={form.currentPrice} onChange={e => set('currentPrice', e.target.value)}
                type="text" inputMode="decimal" placeholder={t('Dejar vacío = precio de compra', 'Empty = purchase price')}
                className={inputCls} />
              <FxHint amount={form.currentPrice} from={form.currency} to={baseCurrency} convert={convert} t={t} />
            </div>
          )}

          <div>
            <label htmlFor="edit-acquisition-date" className={labelCls}>{t('Fecha de adquisición', 'Acquisition date')}</label>
            <input id="edit-acquisition-date" value={form.acquisitionDate} onChange={e => set('acquisitionDate', e.target.value)}
              type="date" max={new Date().toISOString().split('T')[0]} className={inputCls} />
          </div>

          {/* Contribution / Withdrawal */}
          {!isDebt && (onExecuteContribution || onAddTransaction) && (
            <div className="space-y-3">
              {contribSuccess && (
                <div className="px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-green) 10%, transparent)', color: 'var(--accent-green)', border: '1px solid color-mix(in srgb, var(--accent-green) 20%, transparent)' }}>
                  {contribSuccess}
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowContribution(true); setContribType('add') }}
                  className="flex-1 px-3 py-2.5 text-xs font-semibold rounded-lg transition-all border flex items-center justify-center gap-1"
                  style={{ color: 'var(--accent-green)', borderColor: 'color-mix(in srgb, var(--accent-green) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 10%, transparent)' }}>
                  <span className="text-sm">+</span> {t('Agregar Dinero', 'Add Money')}
                </button>
                <button type="button" onClick={() => { setShowContribution(true); setContribType('withdraw') }}
                  className="flex-1 px-3 py-2.5 text-xs font-semibold rounded-lg transition-all border flex items-center justify-center gap-1"
                  style={{ color: 'var(--text-negative)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--text-negative) 10%, transparent)' }}>
                  <span className="text-sm">-</span> {t('Retirar', 'Withdraw')}
                </button>
              </div>

              {showContribution && (
                <div className="border rounded-lg p-3 space-y-3"
                  style={{ borderColor: contribType === 'add' ? 'color-mix(in srgb, var(--accent-green) 30%, transparent)' : 'color-mix(in srgb, var(--text-negative) 30%, transparent)', backgroundColor: contribType === 'add' ? 'color-mix(in srgb, var(--accent-green) 5%, transparent)' : 'color-mix(in srgb, var(--text-negative) 5%, transparent)' }}>
                  <p className="text-xs font-medium" style={{ color: contribType === 'add' ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                    {contribType === 'add' ? t('Nuevo aporte', 'New contribution') : t('Retiro de fondos', 'Withdraw funds')}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="edit-contrib-amount" className={labelCls}>{t('Monto', 'Amount')} ({form.currency})</label>
                      <input id="edit-contrib-amount" value={contribAmount} onChange={e => setContribAmount(e.target.value)}
                        type="text" inputMode="decimal" min="0" placeholder="7000" autoFocus className={inputCls} />
                    </div>
                    <div>
                      <label htmlFor="edit-contrib-date" className={labelCls}>{t('Fecha', 'Date')}</label>
                      <input id="edit-contrib-date" value={contribDate} onChange={e => setContribDate(e.target.value)}
                        type="date" max={new Date().toISOString().split('T')[0]} className={inputCls} />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="edit-contrib-description" className={labelCls}>{t('Descripción (opcional)', 'Description (optional)')}</label>
                    <input id="edit-contrib-description" value={contribDesc} onChange={e => setContribDesc(e.target.value)}
                      placeholder={contribType === 'add'
                        ? (contribIsIncome && !isBank
                          ? t('Ej: Intereses junio', 'E.g. June interest')
                          : t('Ej: Aporte junio', 'E.g. June contribution'))
                        : t('Ej: Retiro parcial', 'E.g. Partial withdrawal')}
                      className={inputCls} />
                  </div>
                  {contribType === 'add' && !isBank && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={contribIsIncome} onChange={e => setContribIsIncome(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-600 accent-emerald-500" />
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {t('Es ingreso generado (intereses, dividendos)', 'Is earned income (interest, dividends)')}
                      </span>
                      <InfoTip text={t(
                        'Si es dinero que genera la inversión (intereses, dividendos), no afecta el cálculo de retorno. Si es dinero nuevo que aportas, se registra como depósito.',
                        'If this is money generated by the investment (interest, dividends), it won\'t affect return calculations. If it\'s new money you\'re adding, it\'s recorded as a deposit.'
                      )} />
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShowContribution(false)}
                      className="flex-1 px-3 py-2 text-xs border border-[var(--card-border,#38383A)] rounded-lg text-[var(--text-secondary,#94a3b8)]">
                      {t('Cancelar', 'Cancel')}
                    </button>
                    <button type="button" onClick={handleContribution} disabled={contribSaving || !contribAmount || parseAmount(contribAmount) <= 0}
                      className="flex-1 px-3 py-2 text-xs font-medium rounded-lg disabled:opacity-40"
                      style={{ backgroundColor: contribType === 'add' ? 'var(--accent-green)' : 'var(--text-negative)', color: '#ffffff' }}>
                      {<BusyLabel busy={contribSaving} lang={lang}>{t('Registrar', 'Record')}</BusyLabel>}
                    </button>
                  </div>
                </div>
              )}

              {linkedTransactions.length > 0 && (
                <div className="border border-[var(--card-border,#38383A)] rounded-lg p-3">
                  <p className="text-xs font-medium text-[var(--text-secondary,#94a3b8)] mb-2">
                    {t('Historial de movimientos', 'Transaction history')} <span style={{ color: 'var(--text-muted,#475569)' }}>({linkedTransactions.length})</span>
                  </p>
                  <div className={`space-y-1 ${showAllTx ? 'max-h-64 overflow-y-auto' : ''}`}>
                    {(showAllTx ? linkedTransactions : linkedTransactions.slice(0, 3)).map(tx => {
                      // A DIVIDEND linked to this item means it GENERATED that
                      // income — a positive event for it — even when the cash
                      // settles in a different destination account. Only a
                      // WITHDRAWAL is actually money leaving this item's own
                      // value; showing the dividend red/negative here read as
                      // "VITALI lost $240" when its own value never changed.
                      const outgoing = tx._outgoingTo !== undefined
                      // Money that arrived FROM another asset. It is filed against
                      // that asset, so editing or re-linking it here would move
                      // someone else's record. Visible and deletable (that is how
                      // you find a duplicated coupon), but not editable.
                      const incoming = tx._incomingFrom !== undefined
                      // A TRANSFER's sign depends on which side of it THIS account
                      // is on, not its type (it's neither a DEPOSIT nor a
                      // WITHDRAWAL) — incoming is a gain to this account, outgoing
                      // a loss, same green/red convention as everything else.
                      const isPositive = tx.type === 'TRANSFER'
                        ? incoming
                        : (tx.type === 'DEPOSIT' || tx.type === 'DIVIDEND' || tx.type === 'INTEREST')
                      const confirming = confirmDeleteTxId === tx.id
                      // Same story the other way: a transfer OUT touches the
                      // destination account's balance too, so it isn't editable
                      // from a single-account form either.
                      const editing = editingTxId === tx.id && !incoming && !outgoing
                      if (editing) {
                        return (
                          <div key={tx.id} className="py-2 border-b border-[var(--card-border,#38383A)]/30 last:border-0 space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <span className="text-[10px] block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('Fecha', 'Date')}</span>
                                <input type="date" value={txDraft.date} max={new Date().toISOString().split('T')[0]}
                                  onChange={e => setTxDraft(d => ({ ...d, date: e.target.value }))} className={inputCls} />
                              </div>
                              <div>
                                <span className="text-[10px] block mb-0.5" style={{ color: 'var(--text-muted)' }}>{t('Monto', 'Amount')} ({tx.currency || form.currency})</span>
                                <input type="text" inputMode="decimal" min="0" value={txDraft.amount}
                                  onChange={e => setTxDraft(d => ({ ...d, amount: e.target.value }))} className={inputCls} />
                              </div>
                            </div>
                            {!tx._linkedItemId && (
                              <label className="flex items-start gap-2 cursor-pointer p-2 rounded"
                                style={{ backgroundColor: 'var(--alert-info-bg)', border: '1px solid var(--alert-info-border)' }}>
                                <input type="checkbox" checked={txDraft.link}
                                  onChange={e => setTxDraft(d => ({ ...d, link: e.target.checked }))}
                                  className="w-3.5 h-3.5 mt-0.5 rounded accent-blue-500 shrink-0" />
                                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                                  {t(`Vincular este movimiento a ${item.name || item.symbol}`, `Link this movement to ${item.name || item.symbol}`)}
                                  <span className="block" style={{ color: 'var(--text-muted)' }}>
                                    {t('Deja de estar suelto: la lista y la gráfica pasan a contarlo igual.', 'It stops floating loose: the list and the chart start counting it the same way.')}
                                  </span>
                                </span>
                              </label>
                            )}
                            <div className="flex gap-2">
                              <button type="button" onClick={() => { setEditingTxId(null); setError('') }}
                                className="flex-1 px-2 py-1.5 text-xs rounded border border-[var(--card-border,#38383A)]" style={{ color: 'var(--text-secondary)' }}>
                                {t('Cancelar', 'Cancel')}
                              </button>
                              <button type="button" onClick={() => handleSaveTx(tx)} disabled={savingTxId === tx.id}
                                className="flex-1 px-2 py-1.5 text-xs font-medium rounded text-white disabled:opacity-50"
                                style={{ backgroundColor: 'var(--accent-blue-strong, #2563eb)' }}>
                                {<BusyLabel busy={savingTxId === tx.id} lang={lang}>{t('Guardar', 'Save')}</BusyLabel>}
                              </button>
                            </div>
                          </div>
                        )
                      }
                      return (
                        <div key={tx.id} className="border-b border-[var(--card-border,#38383A)]/30 last:border-0">
                        <div className="flex items-center justify-between gap-2 text-xs py-1">
                          <span style={{ color: 'var(--text-muted)' }}>{formatTxDate(tx.date)}</span>
                          <div className="text-right min-w-0">
                            {/* FASE ME2: el monto va en ABSOLUTO porque el signo lo pone
                                isPositive. Sin el abs, un totalAmount negativo (corrección,
                                reversa) imprimía "-Q-488.07": el doble negativo que
                                lib/financeAmount.js:9 nombra literalmente. */}
                            <span style={{ color: isPositive ? 'var(--accent-green)' : 'var(--text-negative)' }}>
                              {isPositive ? '+' : '-'}{tx.currency || form.currency} {Math.abs(tx.totalAmount || 0).toLocaleString()}
                            </span>
                            {incoming && (
                              <span className="ml-1 px-1 py-0.5 rounded text-[9px] align-middle"
                                style={{ color: 'var(--accent-cyan)', backgroundColor: 'color-mix(in srgb, var(--accent-cyan) 15%, transparent)' }}
                                title={t('Este dinero llegó desde otro activo. El movimiento vive en ese activo: aquí solo se ve entrar.', 'This money arrived from another asset. The record lives on that asset: here you only see it come in.')}>
                                {tx._incomingFrom ? t(`de ${tx._incomingFrom}`, `from ${tx._incomingFrom}`) : t('recibido', 'received')}
                              </span>
                            )}
                            {outgoing && (
                              <span className="ml-1 px-1 py-0.5 rounded text-[9px] align-middle"
                                style={{ color: 'var(--accent-orange)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)' }}
                                title={tx._outgoingIsExpense
                                  ? t('Un gasto sobre otro activo, pagado desde esta cuenta. El movimiento vive en ese activo: aquí solo se ve salir.', 'An expense on another asset, paid from this account. The record lives on that asset: here you only see it go out.')
                                  : t('Este dinero salió hacia otro activo. El movimiento vive en ambas cuentas: aquí solo se ve salir.', 'This money left for another asset. The record lives on both accounts: here you only see it go out.')}>
                                {tx._outgoingIsExpense
                                  ? (tx._outgoingTo ? t(`gasto en ${tx._outgoingTo}`, `expense on ${tx._outgoingTo}`) : t('gasto', 'expense'))
                                  : (tx._outgoingTo ? t(`hacia ${tx._outgoingTo}`, `to ${tx._outgoingTo}`) : t('transferido', 'transferred'))}
                              </span>
                            )}
                            {!incoming && !outgoing && !tx._linkedItemId && (
                              <span className="ml-1 px-1 py-0.5 rounded text-[9px] align-middle"
                                style={{ color: 'var(--accent-orange)', backgroundColor: 'color-mix(in srgb, var(--accent-orange) 15%, transparent)' }}
                                title={t('Este movimiento se detectó por el símbolo, no está vinculado a la cuenta. Suele ser un registro viejo o duplicado.', 'This movement was matched by symbol, it isn\'t linked to the account. Usually an old or duplicate record.')}>
                                {t('sin vincular', 'unlinked')}
                              </span>
                            )}
                            {tx.description && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{tx.description}</p>}
                          </div>
                          <span className="flex items-center gap-1 shrink-0">
                            {onUpdateTransaction && !incoming && !outgoing && (
                              <button type="button" onClick={() => startEditTx(tx)}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors"
                                style={{ color: 'var(--text-muted)', borderColor: 'var(--card-border,#38383A)' }}
                                title={t('Corregir la fecha o el monto, o vincularlo a esta cuenta', 'Fix the date or amount, or link it to this account')}>
                                {t('Editar', 'Edit')}
                              </button>
                            )}
                            {onDeleteTransaction && (
                              <button type="button" onClick={() => handleDeleteTx(tx)} disabled={deletingTxId === tx.id}
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors disabled:opacity-50"
                                style={confirming
                                  ? { color: '#ffffff', backgroundColor: 'var(--text-negative)', borderColor: 'var(--text-negative)' }
                                  : { color: 'var(--text-muted)', borderColor: 'var(--card-border,#38383A)' }}
                                title={t('Borrar este movimiento (ej. un duplicado)', 'Delete this movement (e.g. a duplicate)')}>
                                {<BusyLabel busy={deletingTxId === tx.id} lang={lang}>{confirming ? t('Confirmar', 'Confirm') : t('Borrar', 'Delete')}</BusyLabel>}
                              </button>
                            )}
                          </span>
                        </div>
                        {/* Borrar una transferencia devuelve el dinero a las DOS
                            cuentas, no solo quita la fila. Misma redaccion que
                            la tarjeta de movimientos recientes, desde
                            lib/transferReversal.js. */}
                        {confirming && [
                          ...reversalLines(transferReversalPlan(tx, planItems), lang, txMoney),
                          ...cashflowReversalLines(cashflowReversalPlan(tx, planItems), lang, txMoney),
                          // FASE OD. Borrar una VENTA la deshace (o dice por que no).
                          ...saleReversalLines(saleReversalPlan(tx, planItems, lots, transactions || []), lang, txMoney),
                        ].map((line, k) => (
                          <div key={k} className="text-[11px] pb-1" style={{ color: 'var(--text-muted)' }}>{line}</div>
                        ))}
                        </div>
                      )
                    })}
                  </div>
                  {linkedTransactions.length > 3 && (
                    <button type="button" onClick={() => setShowAllTx(v => !v)}
                      className="w-full text-center text-xs mt-2 pt-2 border-t border-[var(--card-border,#38383A)]/50"
                      style={{ color: 'var(--accent-blue)' }}>
                      {showAllTx ? t('Ver menos', 'Show less') : t(`Ver todos (${linkedTransactions.length})`, `Show all (${linkedTransactions.length})`)}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Maturity + illiquid — same lifecycle question ("when/how does this
              asset stop looking like this?"), so one accordion instead of two
              always-open blocks. Maturity only applies to bonds/alternatives;
              illiquid applies to those plus real estate. */}
          {(isBondOrAlt || /realestate|inmueble/i.test(form.type)) && (
            <FormSection icon="📅" title={t('Vencimiento & Liquidez', 'Maturity & Liquidity')} summary={(() => {
              const parts = []
              if (isBondOrAlt && form.maturityDate) parts.push(`${t('Vence', 'Due')} ${form.maturityDate}`)
              if (form.isIlliquid) parts.push(t('ilíquido', 'illiquid'))
              return parts.length > 0 ? parts.join(' · ') : t('sin configurar', 'not set')
            })()}>
              {isBondOrAlt && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="edit-maturity-date" className={labelCls}>{t('Fecha vencimiento', 'Maturity date')}</label>
                    <input id="edit-maturity-date" value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                      type="date" className={inputCls} />
                  </div>
                  <div>
                    <label htmlFor="edit-at-maturity" className={labelCls}>{t('Al vencimiento', 'At maturity')}</label>
                    <select id="edit-at-maturity" value={form.maturityAction} onChange={e => set('maturityAction', e.target.value)} className={inputCls}>
                      <option value="return_capital">{t('Devolver capital', 'Return capital')}</option>
                      <option value="auto_renew">{t('Renovar', 'Auto-renew')}</option>
                      <option value="convert_equity">{t('Convertir', 'Convert to equity')}</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-3 px-3 py-2 border border-[var(--card-border,#38383A)] rounded-lg">
                  <button type="button" onClick={() => set('isIlliquid', !form.isIlliquid)}
                    className="w-8 h-4 rounded-full transition-colors relative"
                    style={{ backgroundColor: form.isIlliquid ? 'var(--accent-orange)' : 'var(--card-border, #38383A)' }}>
                    <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${form.isIlliquid ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className="text-xs text-[var(--text-primary,white)]">{t('Activo ilíquido', 'Illiquid asset')}</span>
                </div>
                {form.isIlliquid && (
                  <div>
                    <label htmlFor="edit-manual-valuation" className={labelCls}>{t('Valuación manual', 'Manual valuation')}</label>
                    <input id="edit-manual-valuation" value={form.lastManualValuation} onChange={e => set('lastManualValuation', e.target.value)}
                      type="text" inputMode="decimal" placeholder={t('Valor estimado actual', 'Current estimated value')} className={inputCls} />
                  </div>
                )}
              </div>
            </FormSection>
          )}

          {/* Custody for crypto */}
          {isCrypto && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-custody" className={labelCls}>{t('Custodia', 'Custody')}</label>
                <select id="edit-custody" value={form.custodyType} onChange={e => set('custodyType', e.target.value)} className={inputCls}>
                  <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                  <option value="custodial">{t('Exchange', 'Exchange')}</option>
                  <option value="self_custody">Self-Custody</option>
                  <option value="defi_protocol">DeFi Protocol</option>
                </select>
              </div>
              <div>
                <label htmlFor="edit-custody-details" className={labelCls}>{t('Detalles', 'Details')}</label>
                <input id="edit-custody-details" value={form.custodyDetails} onChange={e => set('custodyDetails', e.target.value)}
                  placeholder="Ledger, Binance..." className={inputCls} />
              </div>
            </div>
          )}

          {/* Debt fields */}
          {isDebt && (
            <div className="border rounded-lg p-3 space-y-3" style={{ borderColor: 'color-mix(in srgb, var(--text-negative) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--text-negative) 5%, transparent)' }}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium" style={{ color: 'var(--text-negative)' }}>{t('Deuda / Pasivo', 'Debt / Liability')}</p>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => set('isReceivable', !form.isReceivable)}
                    className="w-8 h-4 rounded-full transition-colors relative"
                    style={{ backgroundColor: form.isReceivable ? 'var(--accent-cyan)' : 'var(--card-border, #38383A)' }}>
                    <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${form.isReceivable ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className="text-xs text-[var(--text-secondary,#94a3b8)]">{t('Cuenta por cobrar', 'Receivable')}</span>
                </div>
              </div>

              {isReceivable && (
                <div className="flex items-center gap-2 px-2 py-1.5 border rounded" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-cyan) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-cyan) 20%, transparent)' }}>
                  <button type="button" onClick={() => set('countInNetWorth', !form.countInNetWorth)}
                    className="w-8 h-4 rounded-full transition-colors relative"
                    style={{ backgroundColor: form.countInNetWorth ? 'var(--accent-cyan)' : 'var(--card-border, #38383A)' }}>
                    <span className={`absolute w-3 h-3 bg-white rounded-full top-0.5 transition-transform ${form.countInNetWorth ? 'left-4' : 'left-0.5'}`} />
                  </button>
                  <span className="text-xs" style={{ color: 'var(--accent-cyan)' }}>{t('Incluir en patrimonio neto', 'Include in net worth')}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-interest-rate" className={labelCls}>{t('Tasa interés %', 'Interest rate %')}</label>
                  <div className="flex gap-2">
                    <input id="edit-interest-rate" value={form.interestRate} onChange={e => set('interestRate', e.target.value)}
                      placeholder="7.5" type="text" inputMode="decimal" className={inputCls} />
                    <select aria-label={t('Período de la tasa', 'Rate period')} value={form.ratePeriod} onChange={e => set('ratePeriod', e.target.value)} className={inputCls} style={{ maxWidth: '7.5rem' }}>
                      <option value="annual">{t('% anual', '% yearly')}</option>
                      <option value="monthly">{t('% mensual', '% monthly')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="edit-debt-term" className={labelCls}>{t('Plazo', 'Term')}</label>
                  <select id="edit-debt-term" value={form.debtTerm} onChange={e => set('debtTerm', e.target.value)} className={inputCls}>
                    <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                    <option value="3m">3 {t('meses', 'months')}</option>
                    <option value="6m">6 {t('meses', 'months')}</option>
                    <option value="12m">12 {t('meses', 'months')}</option>
                    <option value="24m">24 {t('meses', 'months')}</option>
                    <option value="36m">36 {t('meses', 'months')}</option>
                    <option value="payday">{t('Día de pago', 'Payday')}</option>
                    <option value="revolving">Revolving</option>
                    <option value="custom">{t('Otro', 'Custom')}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="edit-monthly-payment" className={labelCls}>{t('Pago mensual', 'Monthly payment')}</label>
                  <input id="edit-monthly-payment" value={form.monthlyPayment} onChange={e => set('monthlyPayment', e.target.value)}
                    placeholder="500" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-installments-total" className={labelCls}>{t('Cuotas total', 'Total pmts')}</label>
                  <input id="edit-installments-total" value={form.installmentsTotal} onChange={e => set('installmentsTotal', e.target.value)}
                    placeholder="24" type="number" inputMode="numeric" step="1" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-installments-remaining" className={labelCls}>{t('Cuotas rest.', 'Pmts left')}</label>
                  <input id="edit-installments-remaining" value={form.installmentsRemaining} onChange={e => set('installmentsRemaining', e.target.value)}
                    placeholder="18" type="number" inputMode="numeric" step="1" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-min-payment" className={labelCls}>{t('Pago mínimo', 'Min payment')}</label>
                  <input id="edit-min-payment" value={form.minimumPayment} onChange={e => set('minimumPayment', e.target.value)}
                    placeholder="500" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-debt-maturity-date" className={labelCls}>{t('Fecha vencimiento', 'Maturity date')}</label>
                  <input id="edit-debt-maturity-date" value={form.maturityDate} onChange={e => set('maturityDate', e.target.value)}
                    type="date" className={inputCls} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-debt-scheme" className={labelCls}>{t('¿Cómo se paga?', 'How is it paid?')}</label>
                  <select id="edit-debt-scheme" value={form.debtScheme} onChange={e => set('debtScheme', e.target.value)} className={inputCls}>
                    <option value="">{t('-- Automático --', '-- Automatic --')}</option>
                    <option value="amortizing">{t('Cuota fija (banco)', 'Fixed installment (bank)')}</option>
                    <option value="interest_only">{t('Interés sobre saldo, capital libre', 'Interest on balance, principal free')}</option>
                    <option value="revolving">{t('Revolvente (tarjeta)', 'Revolving (card)')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-original-principal" className={labelCls}>{t('Monto original (opcional)', 'Original amount (optional)')}</label>
                  <input id="edit-original-principal" value={form.originalPrincipal} onChange={e => set('originalPrincipal', e.target.value)}
                    placeholder="50000" type="text" inputMode="decimal" className={inputCls} />
                </div>
              </div>

              {!form.isReceivable && (
                <DebtBreakdownPreview
                  lang={lang}
                  currency={form.currency || 'USD'}
                  balance={parseAmount(form.currentPrice) || parseAmount(form.purchasePrice) || 0}
                  draft={{
                    isDebt: true,
                    subtype: item.subtype,
                    interestRate: parseAmount(form.interestRate) || 0,
                    ratePeriod: form.ratePeriod,
                    debtScheme: form.debtScheme || undefined,
                    monthlyPayment: parseAmount(form.monthlyPayment) || 0,
                    minimumPayment: parseAmount(form.minimumPayment) || 0,
                    installmentsRemaining: parseInt(form.installmentsRemaining) || 0,
                    maturityDate: form.maturityDate || '',
                  }}
                />
              )}

              {isCreditCard && (
                <div className="border-t border-red-500/10 pt-3 space-y-3">
                  <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-negative)' }}>{t('Tarjeta de crédito', 'Credit Card')}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="edit-card-brand" className={labelCls}>{t('Marca', 'Brand')}</label>
                      <select id="edit-card-brand" value={form.cardBrand} onChange={e => set('cardBrand', e.target.value)} className={inputCls}>
                        <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                        <option value="visa">Visa</option>
                        <option value="mastercard">Mastercard</option>
                        <option value="amex">American Express</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="edit-reward-type" className={labelCls}>{t('Tipo reward', 'Reward type')}</label>
                      <select id="edit-reward-type" value={form.rewardType} onChange={e => set('rewardType', e.target.value)} className={inputCls}>
                        <option value="">{t('Ninguno', 'None')}</option>
                        <option value="miles">{t('Millas', 'Miles')}</option>
                        <option value="cashback">Cashback</option>
                        <option value="points">{t('Puntos', 'Points')}</option>
                      </select>
                    </div>
                  </div>
                  {form.rewardType && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="edit-reward-rate" className={labelCls}>{t('Tasa reward %', 'Reward rate %')}</label>
                        <input id="edit-reward-rate" value={form.rewardRate} onChange={e => set('rewardRate', e.target.value)}
                          placeholder="1.5" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                      <div>
                        <label htmlFor="edit-reward-balance" className={labelCls}>{t('Balance acumulado', 'Accumulated balance')}</label>
                        <input id="edit-reward-balance" value={form.rewardBalance} onChange={e => set('rewardBalance', e.target.value)}
                          placeholder="5000" type="text" inputMode="decimal" className={inputCls} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SAFE Note fields */}
          {isAlternative && form.subtype === 'safe_note' && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'color-mix(in srgb, var(--accent-pink) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-pink) 5%, transparent)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-pink)' }}>🔮 SAFE Note</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>{t('Tipo', 'Type')}</label>
                  <select value={form.safeType} onChange={e => set('safeType', e.target.value)} className={inputCls}>
                    <option value="post_money">Post-Money</option>
                    <option value="pre_money">Pre-Money</option>
                    <option value="mfn">MFN</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Cap</label>
                  <input value={form.safeCap} onChange={e => set('safeCap', e.target.value)}
                    placeholder="10000000" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t('Desc %', 'Disc %')}</label>
                  <input value={form.safeDiscount} onChange={e => set('safeDiscount', e.target.value)}
                    placeholder="20" type="text" inputMode="decimal" className={inputCls} />
                </div>
              </div>
            </div>
          )}

          {/* Inmueble: el enganche, el préstamo que lo financia y los dos
              costos fijos de tenerlo. De aquí sale la tarjeta de
              AssetDetailModal (cuánto llevas pagado, cuánto falta, capital
              propio). ⛔ Solo lectura para el patrimonio: la deuda ya resta por
              su cuenta como ítem propio, ver lib/propertyEquity.js. */}
          {isProperty && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 5%, transparent)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-blue)' }}>
                🏠 {t('Financiamiento y costos', 'Financing and costs')}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label htmlFor="edit-downPayment" className={labelCls}>{t('Enganche', 'Down payment')}</label>
                  <input id="edit-downPayment" value={form.downPayment} onChange={e => set('downPayment', e.target.value)}
                    placeholder="20000" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-linkedDebtId" className={labelCls}>
                    {t('Préstamo que la financia', 'Loan financing it')}
                    <InfoTip text={t('Vinculá el préstamo y calculamos solos cuánto llevas pagado, cuánto falta y tu capital propio. No cambia tu patrimonio: la deuda ya resta por su cuenta.',
                                     'Link the loan and we work out how much you have paid, how much is left, and your equity. It does not change your net worth: the debt already subtracts on its own.')} />
                  </label>
                  {propertyDebtOptions.length > 0 ? (
                    <select id="edit-linkedDebtId" value={form.linkedDebtId}
                      onChange={e => set('linkedDebtId', e.target.value)} className={inputCls}>
                      <option value="">{t('-- Sin préstamo --', '-- No loan --')}</option>
                      {propertyDebtOptions.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name || d.symbol}{d.subtype === 'mortgage' ? ` (${t('hipoteca', 'mortgage')})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
                      {t('No tienes préstamos cargados. Agregalo con "Nuevo → Deuda".',
                         'No loans on file. Add one with "New → Debt".')}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="edit-adminFeeMonthly" className={labelCls}>{t('Admin / mantenimiento (al mes)', 'HOA / upkeep (monthly)')}</label>
                  <input id="edit-adminFeeMonthly" value={form.adminFeeMonthly} onChange={e => set('adminFeeMonthly', e.target.value)}
                    placeholder="150" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label htmlFor="edit-propertyTaxAnnual" className={labelCls}>{t('Impuesto (al año)', 'Property tax (yearly)')}</label>
                  <input id="edit-propertyTaxAnnual" value={form.propertyTaxAnnual} onChange={e => set('propertyTaxAnnual', e.target.value)}
                    placeholder="1200" type="text" inputMode="decimal" className={inputCls} />
                </div>
              </div>
            </div>
          )}

          {/* VC/startup direct investment fields — cap-table context, purely
              informational (never feeds the return formula). */}
          {isAlternative && form.subtype === 'private_equity' && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'color-mix(in srgb, var(--accent-purple) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-purple) 5%, transparent)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-purple)' }}>🚀 {t('Ronda de inversión', 'Investment round')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>{t('Etapa', 'Stage')}</label>
                  <select value={form.investmentStage} onChange={e => set('investmentStage', e.target.value)} className={inputCls}>
                    <option value="">{t('-- Opcional --', '-- Optional --')}</option>
                    <option value="pre_seed">Pre-seed</option>
                    <option value="seed">Seed</option>
                    <option value="series_a">Series A</option>
                    <option value="series_b">Series B</option>
                    <option value="series_c_plus">Series C+</option>
                    <option value="growth">{t('Growth / Late stage', 'Growth / Late stage')}</option>
                    <option value="buyout">Buyout / PE</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t('Valuación de la ronda', 'Round valuation')}</label>
                  <input value={form.roundValuation} onChange={e => set('roundValuation', e.target.value)}
                    placeholder="10000000" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>% {t('de la empresa', 'of the company')}</label>
                  <input value={form.ownershipPct} onChange={e => set('ownershipPct', e.target.value)}
                    placeholder="0.5" type="text" inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>
                    {t('Capital comprometido', 'Committed capital')}
                    {' '}
                    <InfoTip text={t('El monto total que te comprometiste a aportar (se va llamando por partes). La tarjeta de métricas VC/PE lo usa para el PIC: qué % del compromiso ya se llamó. Opcional, no afecta el rendimiento.', 'The total amount you committed (called in pieces over time). The VC/PE metrics card uses it for PIC: what % of the commitment has been called. Optional, does not affect returns.')} />
                  </label>
                  <input value={form.committedCapital} onChange={e => set('committedCapital', e.target.value)}
                    placeholder="50000" type="text" inputMode="decimal" className={inputCls} />
                </div>
              </div>
            </div>
          )}

          {/* Fees */}
          <FormSection icon="💸" title={t('Costos & Comisiones', 'Costs & Fees')} summary={(() => {
            const parts = []
            if (parseAmount(form.entryFee) > 0) parts.push(`${t('Entrada', 'Entry')} ${parseAmount(form.entryFee).toFixed(2)}`)
            if (parseAmount(form.managementFee) > 0) parts.push(form.managementFeeType === 'fixed' ? `Mgmt $${parseAmount(form.managementFee).toFixed(2)}` : `Mgmt ${parseAmount(form.managementFee).toFixed(2)}%`)
            if (parseAmount(form.expenseRatio) > 0) parts.push(`Expense ${parseAmount(form.expenseRatio).toFixed(2)}%`)
            return parts.length > 0 ? parts.join(' · ') : t('sin configurar', 'not set')
          })()}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>{t('Costo entrada', 'Entry fee')} <InfoTip text={t('Monto fijo en tu moneda (ej: $80). NO es porcentaje. Es el costo de entrada o comisión que pagaste una sola vez.', 'Fixed amount in your currency (e.g. $80). NOT a percentage. One-time entry cost or commission you paid.')} /></label>
                <input value={form.entryFee} onChange={e => set('entryFee', e.target.value)}
                  placeholder="80" type="text" inputMode="decimal" className={inputCls}
                  title={t('Costo de incorporación, comisión de entrada, etc.', 'Incorporation cost, entry commission, etc.')} />
              </div>
              <div>
                <label className={labelCls}>
                  {t('Mgmt fee', 'Mgmt fee')}
                  {' '}
                  <button type="button" onClick={() => set('managementFeeType', form.managementFeeType === 'fixed' ? 'percent' : 'fixed')}
                    className="text-xs px-1.5 py-0.5 rounded bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] transition-colors"
                    style={{ color: 'var(--accent-blue)' }}>
                    {form.managementFeeType === 'fixed' ? '$' : '%'}
                  </button>
                  {' '}
                  <InfoTip text={form.managementFeeType === 'fixed'
                    ? t('Monto FIJO anual en tu moneda. Ej: 50 = $50/año. Toca $ para cambiar a porcentaje.', 'FIXED annual amount in your currency. E.g. 50 = $50/yr. Tap $ to switch to percentage.')
                    : t('Porcentaje ANUAL sobre el valor total. Ej: 0.50 = 0.50%/año. Toca % para cambiar a monto fijo.', 'Annual PERCENTAGE on total value. E.g. 0.50 = 0.50%/yr. Tap % to switch to fixed amount.')} />
                </label>
                <input value={form.managementFee} onChange={e => set('managementFee', e.target.value)}
                  placeholder={form.managementFeeType === 'fixed' ? '50' : '0.50'} type="text" inputMode="decimal" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>{t('Expense %', 'Expense %')} <InfoTip text={t('Ratio de gastos ANUAL en porcentaje. Ej: 0.03 = 0.03% por año. Este es un costo operativo del fondo/instrumento.', 'Annual expense ratio as a PERCENTAGE. E.g. 0.03 = 0.03% per year. This is the fund/instrument operating cost.')} /></label>
                <input value={form.expenseRatio} onChange={e => set('expenseRatio', e.target.value)}
                  placeholder="0.03" type="text" inputMode="decimal" className={inputCls}
                  title={t('Ratio de gastos anual %', 'Annual expense ratio %')} />
              </div>
            </div>

            {/* Only asked once there IS a fee: which side of the purchase value
                it sits on decides how much really left your pocket, and that is
                the denominator of every return % for this asset. */}
            {parseAmount(form.entryFee) > 0 && (() => {
              const fee = parseAmount(form.entryFee) || 0
              const typed = (parseQuantity(form.quantity) || 1) * (parseAmount(form.purchasePrice))
              const cur = form.currency || 'USD'
              const fmt = (v) => `${cur} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              const modes = [
                { key: 'separate', es: 'Se pagó aparte', en: 'Paid separately' },
                { key: 'deducted', es: 'Se descontó del monto', en: 'Deducted from amount' },
              ]
              return (
                <div>
                  <label className={labelCls}>
                    {t('¿Cómo se cobró ese costo de entrada?', 'How was that entry cost charged?')}
                    {' '}
                    <InfoTip text={t(
                      'Cambia cuánto dinero salió realmente de tu bolsillo, que es contra lo que se mide tu rendimiento. "Se pagó aparte": mandaste el monto de compra Y ADEMÁS la comisión. "Se descontó del monto": mandaste solo el monto de compra y la comisión salió de ahí, así que al activo entró menos.',
                      'It changes how much money actually left your pocket, which is what your return is measured against. "Paid separately": you sent the purchase amount AND the fee on top. "Deducted from amount": you sent just the purchase amount and the fee came out of it, so less actually bought the asset.'
                    )} />
                  </label>
                  <div className="flex gap-1.5">
                    {modes.map(m => (
                      <button key={m.key} type="button" onClick={() => set('entryFeeMode', m.key)}
                        className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                        style={form.entryFeeMode === m.key
                          ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' }
                          : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                        {lang === 'es' ? m.es : m.en}
                      </button>
                    ))}
                  </div>
                  {typed > 0 && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                      {form.entryFeeMode === 'deducted'
                        ? t(`Saliste con ${fmt(typed)} en total, y al activo entraron ${fmt(typed - fee)}.`,
                            `${fmt(typed)} left your pocket in total, and ${fmt(typed - fee)} actually went into the asset.`)
                        : t(`Saliste con ${fmt(typed + fee)} en total: ${fmt(typed)} al activo más ${fmt(fee)} de comisión.`,
                            `${fmt(typed + fee)} left your pocket in total: ${fmt(typed)} into the asset plus ${fmt(fee)} in fees.`)}
                    </p>
                  )}
                </div>
              )
            })()}

            {(parseAmount(form.entryFee) > 0 || parseAmount(form.managementFee) > 0 || parseAmount(form.expenseRatio) > 0) && (
              <p className="text-xs" style={{ color: 'color-mix(in srgb, var(--accent-orange) 60%, transparent)' }}>
                {parseAmount(form.entryFee) > 0 && `${t('Entrada', 'Entry')}: $${parseAmount(form.entryFee).toFixed(2)}  `}
                {parseAmount(form.managementFee) > 0 && (
                  form.managementFeeType === 'fixed'
                    ? `${t('Mgmt', 'Mgmt')}: $${parseAmount(form.managementFee).toFixed(2)}/yr  `
                    : `${t('Mgmt', 'Mgmt')}: ${parseAmount(form.managementFee).toFixed(2)}%  `
                )}
                {parseAmount(form.expenseRatio) > 0 && `Expense: ${parseAmount(form.expenseRatio).toFixed(2)}%  `}
                {(() => {
                  const bal = (parseAmount(form.purchasePrice)) * (parseQuantity(form.quantity))
                  if (bal <= 0) return null
                  const mgmt = form.managementFeeType === 'fixed' ? (parseAmount(form.managementFee) || 0) : bal * ((parseAmount(form.managementFee) || 0) / 100)
                  const exp = bal * ((parseAmount(form.expenseRatio) || 0) / 100)
                  const total = mgmt + exp
                  return total > 0 ? `(~$${total.toFixed(0)}/yr)` : null
                })()}
              </p>
            )}
          </FormSection>

          {/* Notes, tags, beneficiary, tax jurisdiction & asset country — five
              rarely-touched fields that used to each get their own always-open
              block. One accordion, one summary line. */}
          <FormSection icon="🗂️" title={t('Detalles adicionales', 'Additional details')} summary={(() => {
            const parts = []
            if (form.beneficiary) parts.push(form.beneficiary)
            if (form.taxJurisdiction) parts.push(form.taxJurisdiction)
            if (form.assetCountry) parts.push(form.assetCountry)
            if (form.tags) parts.push(`${form.tags.split(',').filter(Boolean).length} ${t('etiquetas', 'tags')}`)
            if (form.notes) parts.push(t('notas', 'notes'))
            return parts.length > 0 ? parts.join(' · ') : t('sin configurar', 'not set')
          })()}>
            <div>
              <label className={labelCls}>{t('Notas', 'Notes')}</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder={t('Notas adicionales...', 'Additional notes...')}
                rows={2} className={inputCls + ' resize-none'} />
            </div>
            <div>
              <label className={labelCls}>{t('Etiquetas', 'Tags')} <span className="text-[var(--text-muted,#475569)] font-normal">({t('separadas por coma', 'comma-separated')})</span></label>
              <input value={form.tags} onChange={e => set('tags', e.target.value)}
                placeholder={t('largo plazo, alta prioridad...', 'long term, high priority...')}
                className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Beneficiario', 'Beneficiary')}</label>
              <input value={form.beneficiary} onChange={e => set('beneficiary', e.target.value)}
                placeholder={t('Nombre del beneficiario...', 'Beneficiary name...')}
                className={inputCls} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t('Jurisdicción fiscal', 'Tax jurisdiction')}</label>
                <select value={form.taxJurisdiction} onChange={e => set('taxJurisdiction', e.target.value)} className={inputCls}>
                  <option value="">{t('-- Opcional --', '-- Optional --')}</option>
                  <option value="GT">🇬🇹 Guatemala</option>
                  <option value="MX">{'🇲🇽 '}{t('México', 'Mexico')}</option>
                  <option value="US">🇺🇸 USA</option>
                  <option value="CO">🇨🇴 Colombia</option>
                  <option value="CL">🇨🇱 Chile</option>
                  <option value="BR">{'🇧🇷 '}{t('Brasil', 'Brazil')}</option>
                  <option value="PE">{'🇵🇪 '}{t('Perú', 'Peru')}</option>
                  <option value="AR">🇦🇷 Argentina</option>
                  <option value="OTHER">{t('Otro', 'Other')}</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>{t('País del activo', 'Asset country')}</label>
                <select value={form.assetCountry} onChange={e => set('assetCountry', e.target.value)} className={inputCls}>
                  <option value="">{t('-- Opcional --', '-- Optional --')}</option>
                  <option value="GT">🇬🇹 Guatemala</option>
                  <option value="MX">{'🇲🇽 '}{t('México', 'Mexico')}</option>
                  <option value="US">🇺🇸 USA</option>
                  <option value="CO">🇨🇴 Colombia</option>
                  <option value="CL">🇨🇱 Chile</option>
                  <option value="BR">{'🇧🇷 '}{t('Brasil', 'Brazil')}</option>
                  <option value="PE">{'🇵🇪 '}{t('Perú', 'Peru')}</option>
                  <option value="AR">🇦🇷 Argentina</option>
                  <option value="CR">🇨🇷 Costa Rica</option>
                  <option value="PA">{'🇵🇦 '}{t('Panamá', 'Panama')}</option>
                  <option value="ES">{'🇪🇸 '}{t('España', 'Spain')}</option>
                  <option value="UK">🇬🇧 UK</option>
                  <option value="DE">{'🇩🇪 '}{t('Alemania', 'Germany')}</option>
                  <option value="CH">{'🇨🇭 '}{t('Suiza', 'Switzerland')}</option>
                  <option value="JP">{'🇯🇵 '}{t('Japón', 'Japan')}</option>
                  <option value="CN">🇨🇳 China</option>
                  <option value="KR">{'🇰🇷 '}{t('Corea del Sur', 'South Korea')}</option>
                  <option value="HK">🇭🇰 Hong Kong</option>
                  <option value="SG">{'🇸🇬 '}{t('Singapur', 'Singapore')}</option>
                  <option value="AU">🇦🇺 Australia</option>
                  <option value="CA">{'🇨🇦 '}{t('Canadá', 'Canada')}</option>
                  <option value="GLOBAL">{t('Global / Multi-país', 'Global / Multi-country')}</option>
                  <option value="OTHER">{t('Otro', 'Other')}</option>
                </select>
              </div>
            </div>
          </FormSection>

          {/* Section 3: Income/Dividends */}
          {isMarket && item.dividendYield > 0 && (
            <div className="border rounded-lg p-3 space-y-2" style={{ borderColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 5%, transparent)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--accent-green)' }}>💰 {t('Dividendo', 'Dividend')}: {item.dividendYield}% {item.incomeFrequency || ''}</p>
              <div>
                <p className="text-xs text-[var(--text-muted,#475569)] mb-1">{t('Acción con dividendos:', 'Dividend action:')}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => set('dividendAction', 'cash')}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                    style={form.dividendAction === 'cash' ? { backgroundColor: 'color-mix(in srgb, var(--accent-cyan) 20%, transparent)', color: 'var(--accent-cyan)', borderColor: 'color-mix(in srgb, var(--accent-cyan) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                    💵 {t('Efectivo', 'Cash')}
                  </button>
                  <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                    style={form.dividendAction === 'reinvest' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                    🔄 {t('Reinvertir', 'Reinvest')}
                  </button>
                </div>
              </div>
              {form.dividendAction === 'cash' && (
                <div>
                  <label className={labelCls}>{t('Dividendos van a:', 'Dividends go to:')}</label>
                  <select value={form.incomeDestination}
                    onChange={e => { if (e.target.value === '__new__') { setCreatingDest(true); return } set('incomeDestination', e.target.value) }}
                    className={inputCls}>
                    <option value="">{t('Auto (cash del broker)', 'Auto (broker cash)')}</option>
                    {destItems.filter(it => it.id !== item.id).map(it => (
                      <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>
                    ))}
                    {onCreateDestination && <option value="__new__">+ {t('Crear cuenta nueva', 'Create new account')}</option>}
                  </select>
                  {creatingDest && onCreateDestination && (
                    <InlineCreateAccount onCreate={onCreateDestination} onCancel={() => setCreatingDest(false)}
                      onCreated={handleDestCreated} lang={lang} defaultCurrency={form.currency}
                      sourceAcquisitionDate={form.acquisitionDate || item.acquisitionDate || null} />
                  )}
                </div>
              )}
            </div>
          )}

          {hasIncome && (
            <FormSection icon="💰" title={t('Configurar rendimiento', 'Configure yield')}
              open={showIncome} onToggle={setShowIncome}
              summary={(() => {
                if (form.rateType === 'variable' && (form.rateMin || form.rateMax)) return `${form.rateMin || 0}%-${form.rateMax || 0}% ${t('variable', 'variable')}`
                if (form.rateType === 'continuous' && form.incomeRate) return `${form.incomeRate}% ${t('continua', 'continuous')}`
                if (form.incomeMode === 'percent' && form.incomeRate) return `${form.incomeRate}% ${t('anual', 'annual')}`
                if (form.incomeMode === 'fixed' && form.incomeAmount) return `${form.currency} ${form.incomeAmount} ${t('por pago', 'per payment')}`
                return t('sin configurar', 'not set')
              })()}>
              {/* Rate type */}
              <div>
                <label className={labelCls}>{t('Tipo de tasa', 'Rate type')}</label>
                <div className="flex gap-1">
                  {[{ key: 'fixed', es: 'Fija', en: 'Fixed' }, { key: 'variable', es: 'Variable', en: 'Variable' }, { key: 'continuous', es: 'Continua', en: 'Continuous' }].map(rt => (
                    <button key={rt.key} type="button" onClick={() => set('rateType', rt.key)}
                      className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                      style={form.rateType === rt.key ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                      {lang === 'es' ? rt.es : rt.en}
                    </button>
                  ))}
                </div>
              </div>

              {/* Income mode */}
              <div className="flex gap-1">
                <button type="button" onClick={() => set('incomeMode', 'fixed')}
                  className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                  style={form.incomeMode === 'fixed' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                  {t('Monto fijo', 'Fixed amount')}
                </button>
                <button type="button" onClick={() => set('incomeMode', 'percent')}
                  className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                  style={form.incomeMode === 'percent' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                  {t('% del saldo', '% of balance')}
                </button>
              </div>

              {/* Frecuencia de devengo (FASE KT). Solo con tasa: un monto fijo
                  no devenga, se paga. */}
              {form.incomeMode !== 'fixed' && form.rateType !== 'continuous' && (
                <div>
                  <label className={labelCls}>{t('¿Con qué frecuencia acumula?', 'How often does it accrue?')}</label>
                  <div className="flex gap-1">
                    {[{ k: 'monthly', es: 'Mensual', en: 'Monthly' }, { k: ACCRUAL_DAILY, es: 'Diario', en: 'Daily' }].map(o => (
                      <button key={o.k} type="button" onClick={() => set('accrual', o.k)}
                        className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                        style={form.accrual === o.k ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                        {lang === 'es' ? o.es : o.en}
                      </button>
                    ))}
                  </div>
                  {form.accrual === ACCRUAL_DAILY && (
                    <p className="text-[10px] mt-1.5 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {t('Acumula todos los días y se registra UN movimiento el último día de cada mes con lo acumulado.',
                         'It accrues every day and ONE movement is recorded on the last day of each month with the total accrued.')}
                    </p>
                  )}
                </div>
              )}

              {/* Rate inputs */}
              {form.rateType === 'variable' ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className={labelCls}>{t('Tasa mín %', 'Min %')}</label>
                    <input value={form.rateMin} onChange={e => set('rateMin', e.target.value)}
                      placeholder="4.5" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('Tasa máx %', 'Max %')}</label>
                    <input value={form.rateMax} onChange={e => set('rateMax', e.target.value)}
                      placeholder="5.5" type="text" inputMode="decimal" className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t('Día pago', 'Pay day')}</label>
                    <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                      type="number" inputMode="numeric" min="1" max="31" className={inputCls} />
                      {payDayHint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{payDayHint}</p>}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    {form.incomeMode === 'fixed' ? (<>
                      <label className={labelCls}>{t('Monto por pago', 'Per payment')} <InfoTip text={t('Monto fijo que recibes en cada pago, en la moneda del activo.', 'Fixed amount you receive each payment, in the asset\'s currency.')} /></label>
                      <input value={form.incomeAmount} onChange={e => set('incomeAmount', e.target.value)}
                        type="text" inputMode="decimal" className={inputCls} />
                    </>) : (<>
                      <label className={labelCls}>{t('Tasa anual %', 'Annual rate %')} <InfoTip text={t('Tasa de rendimiento anual en porcentaje. Se divide entre los meses de pago seleccionados.', 'Annual yield rate as percentage. Divided among selected payment months.')} /></label>
                      <input value={form.incomeRate} onChange={e => set('incomeRate', e.target.value)}
                        type="text" inputMode="decimal" className={inputCls} />
                    </>)}
                  </div>
                  {form.rateType !== 'continuous' && (
                    <div>
                      <label className={labelCls}>{t('Día de pago', 'Pay day')}</label>
                      <input value={form.incomePayDay} onChange={e => set('incomePayDay', e.target.value)}
                        type="number" inputMode="numeric" min="1" max="31" className={inputCls} />
                      {payDayHint && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{payDayHint}</p>}
                    </div>
                  )}
                </div>
              )}

              {/* Business day rule */}
              {form.rateType !== 'continuous' && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[var(--text-muted,#475569)]">{t('Día hábil:', 'Business day:')}</label>
                  <select value={form.businessDayRule} onChange={e => set('businessDayRule', e.target.value)}
                    className="px-2 py-1 bg-[var(--input-bg,#000000)] border border-[var(--card-border,#38383A)] rounded text-xs text-[var(--text-primary,white)]">
                    <option value="exact">{t('Exacto', 'Exact')}</option>
                    <option value="next_business_day">{t('Sig. día hábil', 'Next business day')}</option>
                  </select>
                </div>
              )}

              {/* Payment months */}
              {form.rateType !== 'continuous' && (
                <div>
                  <label className={labelCls}>{t('Meses de pago', 'Payment months')}</label>
                  <div className="flex flex-wrap gap-1">
                    {['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'].map((label, i) => {
                      const active = form.incomeMonths.includes(i)
                      return (
                        <button key={i} type="button"
                          onClick={() => set('incomeMonths', active ? form.incomeMonths.filter(x => x !== i) : [...form.incomeMonths, i].sort((a, b) => a - b))}
                          className="px-2 py-1 text-xs font-medium rounded transition-all border"
                          style={active ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 25%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* What happens with each payment — reinvest was only offered for
                  dividend stocks; bonds/CDT/alternatives can reinvest too
                  (processDividends already supports it for any asset). */}
              <div>
                <label className={labelCls}>{t('¿Qué haces con los pagos?', 'What do you do with payments?')}</label>
                <div className="flex gap-2">
                  <button type="button" onClick={() => set('dividendAction', 'cash')}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                    style={form.dividendAction !== 'reinvest' ? { backgroundColor: 'color-mix(in srgb, var(--accent-cyan) 20%, transparent)', color: 'var(--accent-cyan)', borderColor: 'color-mix(in srgb, var(--accent-cyan) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                    💵 {t('Los recibo', 'I receive them')}
                  </button>
                  <button type="button" onClick={() => set('dividendAction', 'reinvest')}
                    className="flex-1 px-2 py-1.5 text-xs font-medium rounded transition-all border"
                    style={form.dividendAction === 'reinvest' ? { color: 'var(--accent-blue)', backgroundColor: 'color-mix(in srgb, var(--accent-blue) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-blue) 40%, transparent)' } : { backgroundColor: 'var(--input-bg,#000000)', color: 'var(--text-muted,#475569)', borderColor: 'var(--card-border,#38383A)' }}>
                    🔄 {t('Se reinvierten', 'They reinvest')}
                  </button>
                </div>
              </div>

              {/* Income destination — irrelevant while reinvesting */}
              {form.dividendAction === 'reinvest' ? (
                <p className="text-xs" style={{ color: 'var(--text-muted,#475569)' }}>
                  {t('Cada pago se reinvierte en este mismo activo (aumenta tu posición).', 'Each payment is reinvested into this same asset (grows your position).')}
                </p>
              ) : (
                <div>
                  <label className={labelCls}>{t('Pagos van a:', 'Payments go to:')}</label>
                  <select value={form.incomeDestination}
                    onChange={e => { if (e.target.value === '__new__') { setCreatingDest(true); return } set('incomeDestination', e.target.value) }}
                    className={inputCls}>
                    <option value="">{t('-- Seleccionar --', '-- Select --')}</option>
                    {destItems.filter(it => it.id !== item.id).map(it => (
                      <option key={it.id} value={it.id}>{it.name || it.symbol} {it.institution ? `(${it.institution})` : ''}</option>
                    ))}
                    {onCreateDestination && <option value="__new__">+ {t('Crear cuenta nueva', 'Create new account')}</option>}
                  </select>
                  {creatingDest && onCreateDestination && (
                    <InlineCreateAccount onCreate={onCreateDestination} onCancel={() => setCreatingDest(false)}
                      onCreated={handleDestCreated} lang={lang} defaultCurrency={form.currency}
                      sourceAcquisitionDate={form.acquisitionDate || item.acquisitionDate || null} />
                  )}
                </div>
              )}

              {/* Capital return */}
              <div>
                <label className={labelCls}>{t('Capital devuelto por pago', 'Capital returned per payment')}</label>
                <input value={form.capitalReturn} onChange={e => set('capitalReturn', e.target.value)}
                  placeholder="0" type="text" inputMode="decimal" className={inputCls} />
              </div>
            </FormSection>
          )}

          {/* Flow confirmation — a value delta needs classifying before save */}
          {pendingFlowConfirm && (() => {
            const { delta, updated } = pendingFlowConfirm
            const isAdd = delta > 0
            const amtStr = `${form.currency} ${Math.abs(delta).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            return (
              <div className="p-3 border rounded-lg text-xs space-y-2" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-orange) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-orange) 25%, transparent)' }}>
                <p style={{ color: 'var(--accent-orange)' }} className="font-medium">
                  {t(`El valor de esta cuenta ${isAdd ? 'subió' : 'bajó'} ${amtStr}. ¿Qué representa este cambio?`,
                     `This account's value ${isAdd ? 'increased' : 'decreased'} by ${amtStr}. What does this change represent?`)}
                </p>
                <p style={{ color: 'var(--text-muted)' }}>
                  {t('Si es dinero que metiste o sacaste, se registra como movimiento para que no infle tu retorno.',
                     'If it is money you added or took out, it is recorded as a cash flow so it does not inflate your return.')}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button type="button" disabled={saving} onClick={() => finalizeSave(updated, true, delta)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                    {isAdd ? t('Aporte (dinero nuevo)', 'Deposit (new money)') : t('Retiro (dinero que salió)', 'Withdrawal (money out)')}
                  </button>
                  <button type="button" disabled={saving} onClick={() => finalizeSave(updated, false, 0)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-50"
                    style={{ color: 'var(--text-secondary)', borderColor: 'var(--card-border)' }}>
                    {t('Ganancia/pérdida o corrección', 'Gain/loss or correction')}
                  </button>
                  <button type="button" disabled={saving} onClick={() => setPendingFlowConfirm(null)}
                    className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-50"
                    style={{ color: 'var(--text-muted)' }}>
                    {t('Cancelar', 'Cancel')}
                  </button>
                </div>
              </div>
            )
          })()}

          {/* Actions — sticky so Guardar/Cancelar never require scrolling past
              every accordion, even with Rendimiento expanded. Stacks on mobile
              (Eliminar+total on top, Cancelar/Guardar full-width below) so four
              controls don't get squeezed onto one 375px-wide row. */}
          <div className="sticky bottom-0 -mx-6 -mb-6 mt-2 px-6 py-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 rounded-b-[20px]"
            style={{ background: 'var(--bg-card)', backdropFilter: 'var(--glass-blur-strong)', WebkitBackdropFilter: 'var(--glass-blur-strong)', borderTop: '1px solid var(--card-border,#38383A)' }}>
            <div className="flex items-center gap-3 order-2 sm:order-1">
              <button type="button" onClick={handleDelete}
                className="px-4 py-2.5 text-xs font-medium rounded-lg transition-colors border"
                style={confirmDelete ? { backgroundColor: 'var(--text-negative)', color: '#ffffff', borderColor: 'var(--text-negative)' } : { color: 'var(--text-negative)', borderColor: 'color-mix(in srgb, var(--text-negative) 30%, transparent)' }}>
                {confirmDelete ? t('Confirmar', 'Confirm') : t('Eliminar', 'Delete')}
              </button>
              {(() => {
                const qty = parseQuantity(form.quantity) || (isBank ? 1 : 0)
                const price = parseAmount(form.currentPrice) || parseAmount(form.purchasePrice)
                const total = qty * price
                const isDebtType = /debt|deuda/i.test(form.type)
                const fmt = (v) => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                // Lo que la app lee HOY para este ítem, con la MISMA función que
                // usan la Hoja, el patrimonio y los reportes. El número de
                // arriba es una vista previa de lo que se va a GUARDAR (cae a
                // cantidad 1 en una cuenta de saldo, que es lo que el guardado
                // ahora de verdad escribe); si el guardado todavía no ocurrió y
                // lo almacenado se lee distinto, hay que DECIRLO: que estas dos
                // superficies se contradijeran en silencio es lo que hizo
                // indiagnosticable este caso durante cuatro rondas.
                const stored = getItemValue(item)
                const drift = Math.abs(stored - total) > 0.005
                if (total > 0) return (
                  <span className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium px-2 py-1 rounded" style={{ color: 'var(--accent-green)', backgroundColor: 'color-mix(in srgb, var(--accent-green) 10%, transparent)' }}>
                      {isDebtType ? t('Deuda', 'Debt') : ''} {form.currency} {fmt(total)}
                    </span>
                    {drift && (
                      <span className="text-[11px]" style={{ color: 'var(--alert-warn-icon)' }}>
                        {t(
                          `Hoy la app lo lee como ${form.currency} ${fmt(stored)}. Guardá para corregirlo.`,
                          `The app currently reads it as ${form.currency} ${fmt(stored)}. Save to fix it.`
                        )}
                      </span>
                    )}
                  </span>
                )
                // Un saldo en CERO se dice, no se esconde: sin esto, "esta
                // cuenta vale cero" y "no hay nada que mostrar" se veían igual,
                // que es justo lo que el usuario viene a confirmar cuando acaba
                // de vaciar una cuenta.
                if (isBank && !isDebtType) return (
                  <span className="text-xs font-medium px-2 py-1 rounded" style={{ color: 'var(--text-muted)', backgroundColor: 'color-mix(in srgb, var(--text-muted) 10%, transparent)' }}>
                    {form.currency} {fmt(0)}
                  </span>
                )
                return null
              })()}
            </div>
            <div className="flex-1 order-1 sm:order-2" />
            <div className="flex gap-3 order-3">
              <button type="button" onClick={onClose}
                className="flex-1 sm:flex-none px-4 py-2.5 border border-[var(--card-border,#38383A)] text-[var(--text-secondary,#cbd5e1)] rounded-lg hover:bg-[var(--input-bg,#2C2C2E)] transition-colors text-sm">
                {t('Cancelar', 'Cancel')}
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 sm:flex-none px-6 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors text-sm font-medium"
                style={{ backgroundColor: 'var(--accent-blue)', color: '#ffffff' }}>
                {<BusyLabel busy={saving} lang={lang}>{onNavigate ? t('Guardar →', 'Save →') : t('Guardar', 'Save')}</BusyLabel>}
              </button>
            </div>
          </div>

          {/* Delete warning */}
          {confirmDelete && referencedBy.length > 0 && (
            <div className="p-3 border rounded-lg text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--accent-orange) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent-orange) 20%, transparent)', color: 'var(--accent-orange)' }}>
              {t('Estos activos reciben pagos de este activo y serán desvinculados:', 'These assets receive payments from this asset and will be unlinked:')}
              <ul className="mt-1 space-y-0.5">
                {referencedBy.map(it => <li key={it.id}>• {it.name || it.symbol}</li>)}
              </ul>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
