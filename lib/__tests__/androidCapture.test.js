import {
  ANDROID_BODY_TEMPLATE,
  ANDROID_PLACEHOLDERS,
  isUnreplacedPlaceholder,
  alertBodyIsUnconfigured,
} from '../androidCapture'
import { explainIngestError } from '../expenseIngest'

// El defecto que esto cierra: un usuario real de Android configuró la macro y lo
// único que obtuvo de vuelta fue un error sobre el MONTO, un campo que este
// camino ni manda, con instrucciones para ir a Atajos y probar con Apple Pay.

describe('marcadores del cuerpo de Android', () => {
  it('la plantilla es JSON válido y lleva los tres marcadores VISIBLES', () => {
    const parsed = JSON.parse(ANDROID_BODY_TEMPLATE)
    expect(parsed.source).toBe('android')
    // La razón entera de que sean visibles: una cadena vacía se ve terminada, y
    // pegar el cuerpo tal cual no daba ninguna señal de que faltaba un paso.
    expect(parsed.title).toBe(ANDROID_PLACEHOLDERS.title)
    expect(parsed.text).toBe(ANDROID_PLACEHOLDERS.text)
    expect(parsed.occurredAt).toBe(ANDROID_PLACEHOLDERS.occurredAt)
    for (const v of Object.values(ANDROID_PLACEHOLDERS)) expect(v.length).toBeGreaterThan(3)
  })

  it('reconoce las tres formas de llegar sin reemplazar', () => {
    expect(isUnreplacedPlaceholder('')).toBe(true)
    expect(isUnreplacedPlaceholder('   ')).toBe(true)
    expect(isUnreplacedPlaceholder(null)).toBe(true)
    expect(isUnreplacedPlaceholder(ANDROID_PLACEHOLDERS.title)).toBe(true)
    // Una variable que la app NO resolvió llega literal. Se reconoce por la
    // FORMA (un token solo, sin espacios), nunca por un nombre concreto: cada
    // app tiene los suyos y desde acá no se pueden verificar.
    expect(isUnreplacedPlaceholder('[notification_title]')).toBe(true)
    expect(isUnreplacedPlaceholder('%NTITLE')).toBe(true)
  })

  it('un aviso REAL del banco nunca cuenta como marcador', () => {
    expect(isUnreplacedPlaceholder('Compra por Q18.00 en MCDONALDS')).toBe(false)
    expect(isUnreplacedPlaceholder('BAC Credomatic')).toBe(false)
    // Un título con corchetes adentro sí es texto real, no una variable suelta.
    expect(isUnreplacedPlaceholder('[BI] Compra aprobada Q50.00')).toBe(false)
  })

  it('el cuerpo está sin configurar solo si FALTAN los dos campos de texto', () => {
    expect(alertBodyIsUnconfigured(JSON.parse(ANDROID_BODY_TEMPLATE))).toBe(true)
    expect(alertBodyIsUnconfigured({ title: '', text: '' })).toBe(true)
    // Con uno de los dos resuelto hay algo que parsear: el aviso de un banco
    // puede venir entero en el texto y con el título vacío.
    expect(alertBodyIsUnconfigured({ title: '', text: 'Compra Q18.00 en POLLO CAMPERO' })).toBe(false)
    expect(alertBodyIsUnconfigured({ title: 'Banco G&T', text: '' })).toBe(false)
  })
})

describe('el mensaje se dirige a la app que el usuario de verdad tiene', () => {
  it('EMPTY_ALERT abre con lo que SI funcionó, no con el fallo', () => {
    const msg = explainIngestError('EMPTY_ALERT', { source: 'android' })
    // Es la confirmación de conexión que el reporte pedía: la petición llegó y
    // el token sirvió, así que decirlo es más informativo que el rechazo.
    expect(msg).toMatch(/token/i)
    expect(msg).toMatch(/variables/i)
    // Y nombra los marcadores exactos que el usuario tiene pegados en la macro.
    expect(msg).toContain(ANDROID_PLACEHOLDERS.title)
    expect(msg).toContain(ANDROID_PLACEHOLDERS.text)
  })

  it('MISSING_AMOUNT en Android NO manda a Atajos ni a Apple Pay', () => {
    const android = explainIngestError('MISSING_AMOUNT', { source: 'android' })
    expect(android).not.toMatch(/atajo/i)
    expect(android).not.toMatch(/apple pay/i)
    expect(android).not.toMatch(/wallet/i)
    expect(android).toMatch(/notificaci/i)
    // Y el del atajo no se movió: cada uno se arregla en su propia app.
    const ios = explainIngestError('MISSING_AMOUNT', { source: 'shortcut' })
    expect(ios).toMatch(/Atajos/)
    // Sin source declarado se conserva la frase de siempre (el atajo es el
    // default del endpoint), así que ningún caller viejo cambia de mensaje.
    expect(explainIngestError('MISSING_AMOUNT')).toBe(ios)
  })

  it('INVALID_AMOUNT en Android tampoco habla de la variable del atajo', () => {
    const android = explainIngestError('INVALID_AMOUNT', { source: 'android' })
    expect(android).not.toMatch(/Transacci[oó]n → Monto/)
    expect(explainIngestError('INVALID_AMOUNT', { source: 'shortcut' })).toMatch(/Transacci[oó]n → Monto/)
  })

  it('PLACEHOLDER_DATE dice que el gasto SI entró', () => {
    const msg = explainIngestError('PLACEHOLDER_DATE', { source: 'android' })
    expect(msg).toMatch(/se registr/i)
    expect(msg).toMatch(/occurredAt/)
  })
})
