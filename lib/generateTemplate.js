export async function generateTemplate() {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const currentYear = new Date().getFullYear()

  // Sheet 1: Activos
  const assets = [
    ['Simbolo', 'Nombre', 'Tipo', 'Cantidad', 'Precio de Compra (USD)', 'Precio Actual (USD)', 'Moneda', 'Institucion', 'Fecha de Compra', 'Notas'],
    ['AAPL', 'Apple Inc', 'Stock', 10, 150, 195, 'USD', 'Interactive Brokers', '2022-01-15', 'Acciones tecnologia'],
    ['VOO', 'Vanguard S&P 500 ETF', 'Fund', 5, 380, 520, 'USD', 'Vanguard', '2021-06-01', 'ETF indice'],
    ['BTC', 'Bitcoin', 'Crypto', 0.25, 30000, 67000, 'USD', 'Binance', '2023-03-10', ''],
    ['APT-CENTRO', 'Apartamento Centro', 'Inmueble', 1, 85000, 95000, 'USD', '', '2020-08-01', 'Propiedad para renta'],
    ['TERRENO-1', 'Terreno Zona 10', 'Inmueble', 1, 40000, 55000, 'USD', '', '2019-01-15', ''],
    ['CDT-001', 'Certificado Deposito', 'Inversion', 1, 10000, 10800, 'USD', 'Banco Industrial', '2024-01-01', 'Vence dic 2024'],
    ['AHORRO-1', 'Cuenta de Ahorro', 'Banco', 1, 5000, 5200, 'USD', 'BAM', '2020-01-01', ''],
    ['MSFT', 'Microsoft', 'Stock', 8, 280, 420, 'USD', 'Interactive Brokers', '2022-06-15', ''],
    ['ETH', 'Ethereum', 'Crypto', 2, 1800, 3500, 'USD', 'Binance', '2023-01-20', ''],
  ]

  const wsAssets = XLSX.utils.aoa_to_sheet(assets)
  wsAssets['!cols'] = [
    { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 10 },
    { wch: 22 }, { wch: 22 }, { wch: 8 }, { wch: 20 },
    { wch: 16 }, { wch: 24 },
  ]
  XLSX.utils.book_append_sheet(wb, wsAssets, 'Activos')

  // Sheet 2: Historial
  const historyHeader = ['Fecha', 'Total Activos (USD)', 'Total Deudas (USD)', 'Patrimonio Neto (USD)', 'Notas']
  const historyRows = [historyHeader]
  for (let y = currentYear - 7; y < currentYear; y++) {
    historyRows.push([`${y}-12-31`, '', '', '', `Cierre ${y}`])
  }
  const currentMonth = new Date().toISOString().split('T')[0]
  historyRows.push([currentMonth, '', '', '', 'Mes actual'])

  const wsHistory = XLSX.utils.aoa_to_sheet(historyRows)
  wsHistory['!cols'] = [
    { wch: 14 }, { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 20 },
  ]
  XLSX.utils.book_append_sheet(wb, wsHistory, 'Historial')

  // Sheet 3: Transacciones
  const txRows = [
    ['Fecha', 'Tipo', 'Simbolo', 'Descripcion', 'Monto (USD)', 'Moneda'],
    ['2024-03-15', 'DIVIDEND', 'AAPL', 'Dividendo Q1', 25, 'USD'],
    ['2024-06-15', 'DIVIDEND', 'VOO', 'Dividendo Q2', 18, 'USD'],
    ['2024-01-10', 'DEPOSIT', '', 'Deposito mensual', 500, 'USD'],
    ['2024-02-20', 'BUY', 'MSFT', 'Compra 2 acciones', 840, 'USD'],
  ]

  const wsTx = XLSX.utils.aoa_to_sheet(txRows)
  wsTx['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 14 }, { wch: 8 },
  ]
  XLSX.utils.book_append_sheet(wb, wsTx, 'Transacciones')

  // Sheet 4: Instrucciones
  const instrucciones = [
    ['INSTRUCCIONES - Plantilla de Portfolio Chispudo'],
    [''],
    ['HOJA "Activos" - Tus inversiones actuales'],
    ['- Simbolo: Ticker del activo (AAPL, BTC) o un ID unico para propiedades (APT-1)'],
    ['- Nombre: Nombre descriptivo del activo'],
    ['- Tipo: Stock, Crypto, Fund, Inmueble, Inversion, Banco, Bond'],
    ['- Cantidad: Numero de unidades (para propiedades usa 1)'],
    ['- Precio de Compra: Lo que pagaste por unidad en USD'],
    ['- Precio Actual: Valor actual por unidad en USD (para acciones/crypto se actualiza automaticamente)'],
    ['- Moneda: USD, GTQ, MXN, EUR, etc.'],
    ['- Institucion: Broker, banco o donde esta el activo'],
    ['- Fecha de Compra: Formato YYYY-MM-DD'],
    [''],
    ['HOJA "Historial" - Como ha crecido tu patrimonio'],
    ['- Llena el valor total de tus activos y deudas al 31 de diciembre de cada ano'],
    ['- Patrimonio Neto = Total Activos - Total Deudas'],
    ['- Si no tienes deudas, deja esa columna en 0'],
    ['- Esto genera la grafica de crecimiento del portfolio'],
    ['- Entre mas anos tengas, mejor se ve la tendencia'],
    [''],
    ['HOJA "Transacciones" - Historial de movimientos'],
    ['- Tipo: BUY (compra), SELL (venta), DIVIDEND, DEPOSIT, WITHDRAWAL'],
    ['- Monto: El total de la transaccion'],
    [''],
    ['TIPS:'],
    ['- Duplica las filas de ejemplo para agregar mas activos'],
    ['- Borra las filas de ejemplo antes de importar'],
    ['- Solo llena las hojas que necesites, las demas se ignoran'],
  ]

  const wsInst = XLSX.utils.aoa_to_sheet(instrucciones)
  wsInst['!cols'] = [{ wch: 80 }]
  XLSX.utils.book_append_sheet(wb, wsInst, 'Instrucciones')

  XLSX.writeFile(wb, 'plantilla-portfolio-chispudo.xlsx')
}
