'use client'

import { createContext, useContext } from 'react'

// El envoltorio que marca "este modal se está yendo", para que el CSS lo pueda
// animar hacia afuera.
//
// ⛔ LA MARCA VA ACÁ Y NO EN `<html>`, y esto SÍ importa: con una bandera
// global, un modal que se cierra mientras OTRO se abre (el picker de venta hace
// las dos cosas en la misma vuelta) haría que el que entra se dibuje ya
// desvanecido. La marca tiene que alcanzar solo al que de verdad se va.
//
// `display: contents` significa que este div NO genera caja: no ocupa espacio,
// no crea contexto de apilamiento y no cambia una sola regla de layout. Lo
// único que aporta es un nodo del DOM donde colgar el atributo, y el CSS llega
// al overlay del modal con un `>` porque la relación de PARENTESCO se conserva
// aunque la caja no exista.
//
// Sin nada adentro no se renderiza ni el envoltorio.

const ModalExitContext = createContext(false)

// Un modal que se dibuja con `createPortal` sale del árbol del DOM, así que
// ningún selector de CSS puede llegar a él desde este envoltorio. `PrintSummary`
// es exactamente ese caso, y su portal existe por una razón que no se puede
// deshacer (FASE JA4: la regla de impresión `body > *:not(.fixed)` solo alcanza
// a los hijos DIRECTOS de body, así que sin el portal el reporte salía en
// blanco). Para esos, el estado viaja por contexto y el propio modal se pone el
// atributo sobre su raíz portada.
export function useModalExiting() {
  return useContext(ModalExitContext)
}

export default function ModalMount({ closing, children }) {
  if (!children) return null
  return (
    <ModalExitContext.Provider value={!!closing}>
      <div style={{ display: 'contents' }} {...(closing ? { 'data-modal-exit': '' } : {})}>
        {children}
      </div>
    </ModalExitContext.Provider>
  )
}
