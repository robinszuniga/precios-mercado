import { useEffect, useState } from 'react'

export type Ruta =
  | { vista: 'lista' }
  | { vista: 'producto'; id: string }
  | { vista: 'plan' }
  | { vista: 'compra' }
  | { vista: 'historico'; productoId?: string; compraId?: string }
  | { vista: 'ajustes' }

/** Navegación por hash: GitHub Pages no tiene fallback para SPA y el botón Atrás de Android sigue funcionando. */
export function leerRuta(hash: string): Ruta {
  const partes = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
  switch (partes[0]) {
    case 'producto': return partes[1] ? { vista: 'producto', id: partes[1] } : { vista: 'lista' }
    case 'plan': return { vista: 'plan' }
    case 'compra': return { vista: 'compra' }
    case 'historico':
      if (partes[1] === 'producto' && partes[2]) return { vista: 'historico', productoId: partes[2] }
      if (partes[1] === 'compra' && partes[2]) return { vista: 'historico', compraId: partes[2] }
      return { vista: 'historico' }
    case 'ajustes': return { vista: 'ajustes' }
    default: return { vista: 'lista' }
  }
}

export function ir(ruta: string) {
  const hash = ruta.startsWith('#') ? ruta : `#/${ruta.replace(/^\//, '')}`
  // Si se navega desde una hoja abierta (ej. "Archivar"), su entrada del historial se reemplaza: si no, Atrás
  // volvería a una pantalla con la hoja fantasma y el siguiente Atrás no haría nada.
  if (history.state?.hoja) location.replace(hash)
  else window.location.hash = hash
}

/** Posición de scroll por pantalla: al volver de un producto, la lista queda donde estaba. */
const posiciones = new Map<string, number>()

export function useRuta(): Ruta {
  const [ruta, setRuta] = useState(() => leerRuta(window.location.hash))
  useEffect(() => {
    let actual = window.location.hash
    const guardar = () => posiciones.set(actual, window.scrollY)
    window.addEventListener('scroll', guardar, { passive: true })
    const cambio = () => {
      actual = window.location.hash
      setRuta(leerRuta(actual))
      const y = posiciones.get(actual) ?? 0
      // Espera a que la pantalla se pinte con sus datos (la base local responde un instante después).
      const inicio = performance.now()
      const intentar = () => {
        const cabe = document.documentElement.scrollHeight - window.innerHeight >= y
        if (cabe || performance.now() - inicio > 1500) window.scrollTo(0, y)
        else requestAnimationFrame(intentar)
      }
      requestAnimationFrame(intentar)
    }
    window.addEventListener('hashchange', cambio)
    return () => {
      window.removeEventListener('hashchange', cambio)
      window.removeEventListener('scroll', guardar)
    }
  }, [])
  return ruta
}
