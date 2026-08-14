export const CARD_REGISTRY = {
  'OL-01': { component: 'NetWorthCard', section: 'overview-left', label: 'Net Worth' },
  'OL-02': { component: 'BenchmarkComparison', section: 'overview-left', label: 'Benchmark' },
  // PriceAlerts dejó de ser card del overview (FASE IC): vive en su modal,
  // abierto desde QuickActionsCard.
  'ACT-01': { component: 'QuickActionsCard', section: 'overview-right', label: 'Actions' },
  'OL-04': { component: 'UpcomingDividends', section: 'overview-left', label: 'Upcoming Dividends' },
  'OL-05': { component: 'ContinuousYieldDisplay', section: 'overview-left', label: 'Continuous Yield' },
  'OL-06': { component: 'VariableRateDashboard', section: 'overview-left', label: 'Variable Rate' },
  'OL-07': { component: 'MaturityCalendar', section: 'overview-left', label: 'Maturity Calendar' },
  'OL-08': { component: 'Watchlist', section: 'overview-left', label: 'Watchlist' },
  'OL-09': { component: 'TopMovers', section: 'overview-left', label: 'Top Movers' },

  'INV-01': { component: 'InvestedByYearCard', section: 'overview-right', label: 'Invested by Year' },

  'OR-01': { component: 'PortfolioGrowthChart', section: 'overview-right', label: 'Growth Chart' },
  'OR-02': { component: 'AssetAllocation', section: 'overview-right', label: 'Asset Allocation' },
  'OR-03': { component: 'InvestmentClassBreakdown', section: 'overview-right', label: 'Investment Classes' },
  'OR-04': { component: 'ValueBreakdown', section: 'overview-right', label: 'Value Breakdown' },
  'OR-05': { component: 'SnapshotComparison', section: 'overview-right', label: 'Snapshot Comparison' },

  'PR-01': { component: 'PerformanceSummary', section: 'performance-risk', label: 'Performance Summary' },
  'PR-02': { component: 'PerformanceAttribution', section: 'performance-risk', label: 'Attribution' },
  'PR-03': { component: 'RiskMetrics', section: 'performance-risk', label: 'Risk Metrics' },
  'PR-04': { component: 'CurrencyImpact', section: 'performance-risk', label: 'Currency Impact' },
  'PR-05': { component: 'MonthlyPerformance', section: 'performance-risk', label: 'Monthly Performance' },

  'IG-01': { component: 'DividendIncome', section: 'income-goals', label: 'Dividend Income' },
  'IG-02': { component: 'GainsReport', section: 'income-goals', label: 'Gains Report' },
  'IG-03': { component: 'ConcentrationRisk', section: 'income-goals', label: 'Concentration Risk' },
  'IG-04': { component: 'IncomeCalendar', section: 'income-goals', label: 'Income Calendar' },
  'IG-05': { component: 'GoalTracker', section: 'income-goals', label: 'Goal Tracker' },
  'IG-06': { component: 'FinancialHealth', section: 'income-goals', label: 'Financial Health' },
  'IG-07': { component: 'RecurringTransactions', section: 'income-goals', label: 'Recurring Transactions' },
  'IG-08': { component: 'SavingsRate', section: 'income-goals', label: 'Savings Rate' },
  'IG-09': { component: 'FeeAnalysis', section: 'income-goals', label: 'Fee Analysis' },
  'IG-10': { component: 'RebalanceSuggestions', section: 'income-goals', label: 'Rebalance Suggestions' },
  'IG-11': { component: 'ProjectionSimulator', section: 'income-goals', label: 'Projection Simulator' },

  'HO-01': { component: 'AccountsTable', section: 'holdings', label: 'Holdings Table' },
  'HO-02': { component: 'RecentTransactions', section: 'holdings', label: 'Recent Transactions' },
  'HO-03': { component: 'DataQualityCard', section: 'holdings', label: 'Data Quality' },
}

export const SECTIONS = {
  'overview-left': { label: 'Overview (Left)', order: 0 },
  'overview-right': { label: 'Overview (Right)', order: 1 },
  'performance-risk': { label: 'Performance & Risk', order: 2 },
  'income-goals': { label: 'Income & Goals', order: 3 },
  'holdings': { label: 'Holdings', order: 4 },
}

export function getCardsBySection(section) {
  return Object.entries(CARD_REGISTRY)
    .filter(([, meta]) => meta.section === section)
    .map(([id, meta]) => ({ id, ...meta }))
}
