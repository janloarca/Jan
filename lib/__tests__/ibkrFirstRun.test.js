/**
 * FASE NM. Las dos reglas de la pantalla que SOLO ve un primerizo de IBKR.
 *
 * Viven en JSX que jest no puede montar sin el dashboard entero (el modal de
 * sync y el importador), así que se fijan LEYENDO LA FUENTE: precedente
 * ibkrImportGate.test.js. Se strippean comentarios antes de juzgar, porque los
 * propios comentarios de estos arreglos NOMBRAN lo que prohíben (lección
 * FASE LE).
 */
const fs = require('fs')
const path = require('path')

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (p) => strip(fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8'))

const sync = read('components/IBKRSyncModal.jsx')
const importer = read('components/FileImportModal.jsx')
const dashboard = read('app/dashboard/page.jsx')

describe('FASE NM: el explicador de seguridad no se impone', () => {
  // La inversión que producía: la pantalla abría ~90 palabras sobre cifrado
  // (lo que NO hace falta para actuar) y dejaba plegado "Cómo conseguir tu
  // clave de API" (lo único que sí), sobre un usuario que por definición
  // todavía no tiene un Flex Web Service Token.
  it('arranca cerrado', () => {
    expect(sync).toMatch(/const \[showExplainer, setShowExplainer\] = useState\(false\)/)
  })

  it('ya no lo re-abre una llave de localStorage', () => {
    expect(sync).not.toMatch(/chispudo-ibkr-explained/)
  })

  it('las instrucciones siguen ahí, a un toque', () => {
    // Plegarlas fue la decisión de FASE IH2 (con la lista abierta los campos
    // caían fuera de la vista) y se conserva: lo que cambia es cuál de las dos
    // cosas ocupa el espacio de arriba, no que las instrucciones desaparezcan.
    expect(sync).toMatch(/<BrokerSteps steps=\{getBrokerHowTo\('ibkr'\)\.api\.steps\}[^>]*collapsible/)
  })
})

describe('FASE NM: el paso del archivo no contradice al paso de la API', () => {
  // El paso 1 termina prometiendo "no hace falta que esperes aquí, tus datos
  // se actualizarán solos" y el viaje avanza de inmediato a "Subir tu Flex
  // XML": la app pedía a mano el trabajo que acababa de decir que no hacía
  // falta hacer.
  it('el importador declara el paso opcional cuando la API ya sincroniza', () => {
    expect(importer).toMatch(/apiAlreadySyncs && \(/)
    expect(importer).toMatch(/Opcional: ya conectaste por API/)
  })

  it('el dashboard solo lo declara con IBKR conectado de verdad', () => {
    expect(dashboard).toMatch(/apiAlreadySyncs=\{importBrokerHint === 'ibkr' && ibkrConnected\}/)
  })

  it('la barra del viaje dice lo MISMO que la pantalla', () => {
    // Dos superficies que el usuario ve a la vez: si la barra dijera
    // "Subir tu Flex XML" a secas mientras la pantalla lo llama opcional,
    // seguiríamos teniendo dos mensajes sobre el mismo paso.
    expect(dashboard).toMatch(/Subir tu Flex XML \(opcional\)/)
    expect(dashboard).toMatch(/Upload your Flex XML \(optional\)/)
  })

  it('el paso NO desaparece: sigue habiendo zona de subida', () => {
    // El sync todavía no aterrizó cuando el usuario está parado acá, y un Flex
    // Query al que le falte una sección sincroniza vacío (FASE GG): el archivo
    // sigue siendo la salida, solo que presentada como lo que es.
    expect(importer).toMatch(/Arrastra tu archivo aquí/)
  })
})
