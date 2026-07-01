import { useMemo } from 'react'
import { getItemValue, getTypeCategory } from '@/components/dashboard/utils'

export function useSpreadsheetContext({ items, netWorth, transactions, financeTransactions, returnYTD }) {
  return useMemo(() => {
    const byCategory = { stocks: 0, crypto: 0, bonds: 0, banks: 0, funds: 0, debts: 0 }
    ;(items || []).forEach(it => {
      const cat = getTypeCategory(it.type)
      const val = Math.abs(getItemValue(it))
      if (it.isDebt) byCategory.debts += val
      else if (byCategory[cat] !== undefined) byCategory[cat] += val
    })

    let incomeMonthly = 0
    let expensesMonthly = 0
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    ;(financeTransactions || []).forEach(tx => {
      if (!tx.date || new Date(tx.date) < monthStart) return
      const amt = Math.abs(tx.amount || 0)
      // Finance transactions store type as 'INCOME'/'EXPENSE' (uppercase) — compare
      // case-insensitively or these tokens are permanently 0.
      const type = (tx.type || '').toUpperCase()
      if (type === 'INCOME') incomeMonthly += amt
      else if (type === 'EXPENSE') expensesMonthly += amt
    })

    const savingsRate = incomeMonthly > 0 ? ((incomeMonthly - expensesMonthly) / incomeMonthly) * 100 : 0

    let annualDivs = 0
    ;(items || []).forEach(it => {
      const qty = it.quantity || 1
      const price = it.currentPrice || it.purchasePrice || 0
      const balance = qty * price
      if (it.incomeAmount > 0 && it.incomeMonths) {
        const payCount = Array.isArray(it.incomeMonths) ? it.incomeMonths.length : 12
        annualDivs += it.incomeAmount * payCount
      } else if (it.dividendYield > 0) {
        annualDivs += balance * (it.dividendYield / 100)
      }
    })

    return {
      netWorth: netWorth || 0,
      totalStocks: byCategory.stocks,
      totalCrypto: byCategory.crypto,
      totalBonds: byCategory.bonds,
      totalCash: byCategory.banks,
      totalFunds: byCategory.funds,
      totalDebt: byCategory.debts,
      incomeMonthly,
      expensesMonthly,
      savingsRate,
      portfolioReturn: returnYTD ?? 0,
      dividendYield: netWorth > 0 ? (annualDivs / netWorth) * 100 : 0,
      numPositions: (items || []).length,
      items: items || [],
    }
  }, [items, netWorth, transactions, financeTransactions, returnYTD])
}
