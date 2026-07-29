// Shared map from crypto ticker → CoinGecko coin id. Used both for current
// prices (/api/prices) and historical charts (/api/prices/chart) so the two
// never drift. Keep keys uppercase.
export const CRYPTO_MAP = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano',
  DOT: 'polkadot', AVAX: 'avalanche-2', MATIC: 'matic-network',
  LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave', XRP: 'ripple',
  DOGE: 'dogecoin', SHIB: 'shiba-inu', BNB: 'binancecoin',
  ATOM: 'cosmos', NEAR: 'near', FTM: 'fantom', ALGO: 'algorand',
  XLM: 'stellar', LTC: 'litecoin', BCH: 'bitcoin-cash',
  USDT: 'tether', USDC: 'usd-coin', DAI: 'dai',
  MANA: 'decentraland', SAND: 'the-sandbox', APE: 'apecoin',
  CRO: 'crypto-com-chain', VET: 'vechain', HBAR: 'hedera-hashgraph',
  ICP: 'internet-computer', FIL: 'filecoin', EOS: 'eos',
  XTZ: 'tezos', THETA: 'theta-token', EGLD: 'elrond-erd-2',
  CELR: 'celer-network', CELO: 'celo',
  // Cosmos / L2 / newer coins
  OSMO: 'osmosis', OP: 'optimism', ARB: 'arbitrum', INJ: 'injective-protocol',
  TIA: 'celestia', SEI: 'sei-network', SUI: 'sui', APT: 'aptos',
  RUNE: 'thorchain', KAVA: 'kava', JUNO: 'juno-network', SCRT: 'secret',
  AKT: 'akash-network', STARS: 'stargaze', EVMOS: 'evmos', DYDX: 'dydx-chain',
  TRX: 'tron', TON: 'the-open-network', GRT: 'the-graph', LDO: 'lido-dao',
  MKR: 'maker', SNX: 'havven', RNDR: 'render-token', IMX: 'immutable-x',
}
