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
  window.location.hash = ruta.startsWith('#') ? ruta : `#/${ruta.replace(/^\//, '')}`
}

export function useRuta(): Ruta {
  const [ruta, setRuta] = useState(() => leerRuta(window.location.hash))
  useEffect(() => {
    const cambio = () => {
      setRuta(leerRuta(window.location.hash))
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', cambio)
    return () => window.removeEventListener('hashchange', cambio)
  }, [])
  return ruta
}
