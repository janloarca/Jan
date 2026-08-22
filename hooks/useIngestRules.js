import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/authFetch'

// Las reglas por comercio que el usuario enseñó corrigiendo categorías.
//
// Vive en un hook y no en cada página porque las necesitan DOS superficies (el
// importador de Flujo y el del tablero) y una de las dos no las tenía: el
// importador del tablero clasificaba con CERO reglas aprendidas, así que el
// mismo estado de cuenta daba resultados distintos según desde dónde se
// subiera. Con el fetch duplicado, ese hueco vuelve en la siguiente pantalla
// que monte un importador.
//
// `learn` acepta un LOTE (una entrada por comercio) porque una corrección en la
// vista previa del import puede tocar varios comercios antes de confirmar.
//
// Todo es best-effort: sin reglas, las de fábrica siguen corriendo. Un fallo
// acá no puede romper un import ni una corrección, así que se traga en silencio
// (aunque `learn` sí propaga, para que el caller pueda decidir si lo reporta).
export function useIngestRules(user) {
  const [rules, setRules] = useState([])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    authFetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list' }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && Array.isArray(d?.rules)) setRules(d.rules) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user])

  // Enseña una sola corrección. `label` es cómo el usuario llama al comercio en
  // sus palabras; no participa del matching, pero es lo que después permite
  // mostrar "DONALD · mecánico" en vez de un código del banco.
  const learn = useCallback(async (merchant, category, label = null) => {
    if (!merchant || !category) return
    const res = await authFetch('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'learn', merchant, category, label: label || null }),
    })
    const data = res.ok ? await res.json().catch(() => null) : null
    if (Array.isArray(data?.rules)) setRules(data.rules)
    return data
  }, [])

  // Un lote. La copia local se actualiza con la ÚLTIMA respuesta del servidor,
  // que ya contiene todas las reglas acumuladas.
  const learnMany = useCallback(async (entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return
    for (const e of entries) await learn(e?.merchant, e?.category, e?.label)
  }, [learn])

  return { rules, setRules, learn, learnMany }
}
