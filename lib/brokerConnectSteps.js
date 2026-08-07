// The "Empezar" wizard for connecting ANY broker/exchange (IBKR keeps its own
// dedicated Flex Query flow — lib/brokerCompletion.js — and is not built from
// this). Three independent, NON-exclusive ways to bring data in, always
// offered TOGETHER instead of forcing a pick between "API" or "CSV" upfront
// the way the old two-button row did. Framed as additive, per the user's own
// framing: no step is required, and doing more than one is explicitly
// encouraged — a file gives current positions, a screenshot can cover history
// a file format doesn't carry, an API keeps future syncs automatic. None of
// the three is "the right way" with the others as a fallback.
//
// Pure and framework-free: which steps exist for THIS broker, in what order,
// with what copy, is testable without rendering anything. The screenshot step
// is not new AI plumbing — it points at the same read-with-your-own-AI prompt
// FileImportModal already offers at the bottom of the importer; this just
// gives it its own numbered step instead of being something a first-time
// user has to scroll past everything else to ever find.

export function buildBrokerConnectSteps(broker, howTo, lang = 'es') {
  const t = (es, en) => (lang === 'es' ? es : en)
  if (!broker) return []

  return [
    {
      key: 'file',
      icon: 'file',
      title: t('Archivo (CSV / Excel)', 'File (CSV / Excel)'),
      blurb: t('El estado de cuenta o historial que tu broker te deja descargar.',
                "The statement or history your broker lets you download."),
      available: true,
      instructionSteps: howTo?.csv?.steps || null,
      instructionNote: howTo?.csv?.note || null,
      fallbackText: !howTo?.csv ? (broker.instructions?.[lang] || broker.instructions?.en || null) : null,
      cta: t('Subir archivo', 'Upload file'),
    },
    {
      key: 'screenshot',
      icon: 'camera',
      title: t('Captura de pantalla', 'Screenshot'),
      blurb: t('¿Tienes una foto del valor de tu cuenta en el tiempo, o de tus posiciones? Ayuda a rellenar lo que el archivo no trae.',
                "Got a picture of your account value over time, or of your positions? It helps fill in what the file leaves out."),
      available: true,
      instructionSteps: null,
      cta: t('Usarla en el importador', 'Use it in the importer'),
    },
    {
      key: 'api',
      icon: 'key',
      title: t('Conexión automática (API)', 'Automatic connection (API)'),
      blurb: broker.hasApi
        ? t('Se sincroniza sola de aquí en adelante: no vuelves a subir nada a mano.',
            'Syncs itself from here on: you never upload anything by hand again.')
        : t('Este broker no ofrece una API pública todavía.', "This broker doesn't offer a public API yet."),
      available: !!broker.hasApi,
      authType: broker.authType || null,
      instructionSteps: howTo?.api?.steps || null,
      instructionNote: howTo?.api?.note || null,
      fields: broker.fields || [],
      cta: broker.authType === 'oauth' ? t('Autorizar', 'Authorize') : t('Conectar', 'Connect'),
    },
  ]
}
