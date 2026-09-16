import {
  normalizeIbkrCredentials, ibkrCredentialMessage,
  STORED_TOKEN, MIN_TOKEN_LENGTH, MAX_QUERY_ID_DIGITS,
} from '../ibkrCredentials'

const GOOD_TOKEN = '123456789012345678901234567890'
const GOOD_QID = '1603751'

describe('normalizeIbkrCredentials', () => {
  test('recorta: un espacio invisible al final no puede llegar al vault', () => {
    // El caso real: un token pegado desde una pagina web se lleva un espacio,
    // se guarda CON el espacio, y cada sync posterior falla con un error que se
    // lee como "token invalido" sin que nada apunte al espacio.
    const r = normalizeIbkrCredentials({ token: `  ${GOOD_TOKEN} `, queryId: ` ${GOOD_QID}\n` })
    expect(r.ok).toBe(true)
    expect(r.token).toBe(GOOD_TOKEN)
    expect(r.typedToken).toBe(GOOD_TOKEN)
    expect(r.queryId).toBe(GOOD_QID)
  })

  test('un token pegado en el campo del Query ID se rechaza SIN salir a la red', () => {
    // El error mas comun con los dos campos uno encima del otro. El servidor no
    // lo ataja: acepta cualquier alfanumerico de hasta 50 caracteres.
    const r = normalizeIbkrCredentials({ token: GOOD_TOKEN, queryId: GOOD_TOKEN })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('query-looks-like-token')
    expect(ibkrCredentialMessage(r.reason, 'es')).toMatch(/parece el token/i)
    expect(ibkrCredentialMessage(r.reason, 'en')).toMatch(/looks like the token/i)
  })

  test('un Query ID con letras se rechaza, y su mensaje NO habla del token', () => {
    // Dos rechazos distintos con dos explicaciones distintas: "pegaste el token
    // aca" es mucho mas util que "no son solo numeros" cuando de verdad es eso.
    const r = normalizeIbkrCredentials({ token: GOOD_TOKEN, queryId: 'FlexQuery1' })
    expect(r.reason).toBe('query-not-numeric')
    expect(ibkrCredentialMessage(r.reason, 'es')).not.toMatch(/parece el token/i)
  })

  test('un token truncado se rechaza', () => {
    const r = normalizeIbkrCredentials({ token: 'abc123', queryId: GOOD_QID })
    expect(r.reason).toBe('token-too-short')
    expect('abc123'.length).toBeLessThan(MIN_TOKEN_LENGTH)
  })

  test('el sentinela del vault no tiene longitud que juzgar', () => {
    // El servidor ya tiene el token y el cliente nunca lo vio: medirle el largo
    // a '__stored__' rechazaria cada sync de todo usuario ya conectado.
    const r = normalizeIbkrCredentials({ token: '', queryId: GOOD_QID, hasVaultCreds: true })
    expect(r.ok).toBe(true)
    expect(r.token).toBe(STORED_TOKEN)
    expect(r.typedToken).toBe('')
    expect(STORED_TOKEN.length).toBeLessThan(MIN_TOKEN_LENGTH)
  })

  test('sin token ni vault, y sin Query ID, falta algo', () => {
    expect(normalizeIbkrCredentials({ token: '', queryId: GOOD_QID }).reason).toBe('missing')
    expect(normalizeIbkrCredentials({ token: GOOD_TOKEN, queryId: '   ' }).reason).toBe('missing')
    expect(normalizeIbkrCredentials().reason).toBe('missing')
  })

  test('un Query ID real pasa, y el limite es el que la firma del token cruza', () => {
    expect(normalizeIbkrCredentials({ token: GOOD_TOKEN, queryId: GOOD_QID }).ok).toBe(true)
    const atLimit = '9'.repeat(MAX_QUERY_ID_DIGITS)
    expect(normalizeIbkrCredentials({ token: GOOD_TOKEN, queryId: atLimit }).ok).toBe(true)
    const overLimit = '9'.repeat(MAX_QUERY_ID_DIGITS + 1)
    expect(normalizeIbkrCredentials({ token: GOOD_TOKEN, queryId: overLimit }).ok).toBe(false)
    // El techo tiene que quedar por DEBAJO de lo que mide un token real, o la
    // regla que existe para cazar el campo equivocado no cazaria nada.
    expect(MAX_QUERY_ID_DIGITS).toBeLessThan(MIN_TOKEN_LENGTH)
  })

  test('los valores normalizados salen aunque el veredicto sea negativo', () => {
    // El caller los usa para re-pintar el formulario; devolver undefined ahi
    // obligaria a cada puerta a recortar por su cuenta, que es el patron que
    // este modulo existe para cerrar.
    const r = normalizeIbkrCredentials({ token: '  x ', queryId: ' abc ' })
    expect(r.ok).toBe(false)
    expect(r.typedToken).toBe('x')
    expect(r.queryId).toBe('abc')
  })
})
