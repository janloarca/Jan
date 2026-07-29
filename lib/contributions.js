// Shared contribution math for "add / withdraw money on an existing asset".
// Used by EditAccountModal (Add Money / Withdraw) and CashFlowModal (deposits,
// withdrawals and yields linked to an account), so both doors apply the SAME
// balance / lot semantics. Operates on RAW item fields (item's own currency),
// never on enriched/base-converted values.

export function isBankLikeItem(item) {
  const type = item?.type || ''
  const isMarket = /stock|crypto|fund|etf/i.test(type) && !/realestate/i.test(type)
  const isBank = /bank|banco/i.test(type)
  return isBank || (!isMarket && (Number(item?.quantity) || 1) === 1)
}

// Builds the Firestore writes for a contribution (isAdd) or withdrawal (!isAdd)
// of `amount` (in the item's currency) dated `date` (YYYY-MM-DD).
// Returns { itemFields, newLot?, lotClose? } ready for executeContribution().
//  - Bank-like / static (qty 1): value is the balance → shift purchasePrice and
//    currentPrice by the amount (each keeps its own level, so an asset whose
//    market value drifted from cost doesn't lose the gain).
//  - Share-based: convert the amount to shares at the current price; adds create
//    a lot at `date` (so history reconstructs), withdrawals FIFO-close lots.
export function buildContributionFields({ item, amount, date, isAdd, currency }) {
  const amt = Number(amount) || 0
  if (isBankLikeItem(item)) {
    const oldPurchase = Number(item.purchasePrice) || 0
    const oldCurrent = Number(item.currentPrice ?? item.purchasePrice) || 0
    const delta = isAdd ? amt : -amt
    return {
      itemFields: {
        purchasePrice: Math.max(0, oldPurchase + delta),
        currentPrice: Math.max(0, oldCurrent + delta),
      },
    }
  }

  const pricePerUnit = Number(item.currentPrice) || Number(item.purchasePrice) || 1
  const oldQty = Number(item.quantity) || 0
  const shares = amt / pricePerUnit

  if (isAdd) {
    return {
      itemFields: { quantity: oldQty + shares },
      newLot: {
        symbol: (item.symbol || '').toUpperCase(),
        quantity: shares,
        costBasis: pricePerUnit,
        currency: currency || item.currency || 'USD',
        acquisitionDate: date,
        institution: item.institution || '',
      },
    }
  }

  const out = { itemFields: { quantity: Math.max(0, oldQty - shares) } }
  if (shares > 0) {
    out.lotClose = {
      symbol: (item.symbol || '').toUpperCase(),
      qty: shares,
      price: pricePerUnit,
      date,
      institution: item.institution || '',
    }
  }
  return out
}
