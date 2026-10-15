export const TIENDAS = ['EXITO', 'OLIMPICA', 'D1', 'METRO', 'ARA'] as const
export type Tienda = (typeof TIENDAS)[number]

export const TIENDAS_VTEX = ['EXITO', 'OLIMPICA', 'D1'] as const
export type TiendaVtex = (typeof TIENDAS_VTEX)[number]

export interface InfoTienda {
  nombre: string
  /** Base del catálogo VTEX. Éxito sirve la API legacy bajo /io (sin /io responde 308). */
  catalogo: string | null
  /** Base de /api/checkout/pub/regions. Se configura aparte porque el smoke test confirma cada una. */
  checkout: string | null
  /** Home, para leer la cookie vtex_segment (channel). */
  home: string | null
}

export const INFO_TIENDAS: Record<Tienda, InfoTienda> = {
  EXITO: {
    nombre: 'Éxito',
    catalogo: 'https://www.exito.com/io',
    checkout: 'https://www.exito.com/io',
    home: 'https://www.exito.com/',
  },
  OLIMPICA: {
    nombre: 'Olímpica',
    catalogo: 'https://www.olimpica.com',
    checkout: 'https://www.olimpica.com',
    home: 'https://www.olimpica.com/',
  },
  D1: {
    nombre: 'D1',
    catalogo: 'https://www.d1.com.co',
    checkout: 'https://www.d1.com.co',
    home: 'https://www.d1.com.co/',
  },
  // Metro no tiene tienda en línea propia: su sitio manda a comprar en jumbocolombia.com (la plataforma de Jumbo), que no atiende
  // Riohacha (la región de la ciudad viene sin vendedores) y avisa que sus precios no siempre coinciden con los del supermercado.
  // Investigado el 15-oct-2026: lo que devuelve sin ciudad son precios de otra región. Por eso es de precio manual, como Ara.
  METRO: { nombre: 'Metro', catalogo: null, checkout: null, home: null },
  ARA: { nombre: 'Ara', catalogo: null, checkout: null, home: null },
}

export function esTienda(v: unknown): v is Tienda {
  return typeof v === 'string' && (TIENDAS as readonly string[]).includes(v)
}

export function esTiendaVtex(v: unknown): v is TiendaVtex {
  return typeof v === 'string' && (TIENDAS_VTEX as readonly string[]).includes(v)
}
