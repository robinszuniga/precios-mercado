import { formatoCop } from '@shared/dinero.ts'
import { formatoKm } from '@shared/mapa.ts'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'

export interface GrupoCompartir {
  tienda: Tienda
  total: number
  lineas: { nombre: string; detalle: string; costo: number }[]
}

/** WhatsApp muestra mal el espacio duro de "$ 1.000" en algunos celulares: se cambia por uno normal. */
const plata = (n: number) => formatoCop(n).replace(/ /g, ' ')

/** Un nombre con asteriscos o guiones bajos se vería en negrita o cursiva en WhatsApp: se quitan esos símbolos. */
const limpio = (t: string) => t.replace(/[*_~`]/g, '').trim()

/** El plan como mensaje de WhatsApp: una sección por tienda (en *negrita*), lo que va sin precio y el total. */
export function textoPlan(grupos: GrupoCompartir[], sinPrecio: string[], total: number, fecha = new Date()): string {
  const dia = fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  const partes = [`🛒 Mercado · ${dia}`]
  for (const g of grupos) {
    partes.push('', `*${INFO_TIENDAS[g.tienda].nombre}* · ${plata(g.total)}`)
    for (const l of g.lineas) partes.push(`▢ ${limpio(l.nombre)} — ${limpio(l.detalle)} · ${plata(l.costo)}`)
  }
  const pendientes = sinPrecio.map(limpio).filter(Boolean)
  if (pendientes.length) {
    partes.push('', '*Sin precio (donde lo encuentres)*')
    for (const n of pendientes) partes.push(`▢ ${n}`)
  }
  if (grupos.length) partes.push('', `Total estimado: *${plata(total)}*`)
  return partes.join('\n')
}

export interface ParadaCompartir {
  tienda: Tienda
  nombre: string
  km: number
}

/** La ruta de hoy como mensaje: paradas en orden, distancia aproximada y el enlace para abrirla en Google Maps. */
export function textoRuta(paradas: ParadaCompartir[], totalKm: number, enlace: string | null, total: number | null, fecha = new Date()): string {
  const dia = fecha.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
  const partes = [`🗺️ Ruta de mercado · ${dia}`]
  paradas.forEach((p, i) => {
    const nombre = limpio(p.nombre)
    const base = INFO_TIENDAS[p.tienda].nombre
    partes.push(`${i + 1}. *${base}*${nombre && nombre !== base ? ` · ${nombre}` : ''}${p.km > 0 ? ` (${i === 0 ? '' : '+'}${formatoKm(p.km)})` : ''}`)
  })
  if (paradas.length > 1 && totalKm > 0) partes.push('', `Recorrido aproximado: ${formatoKm(totalKm)}`)
  if (total != null && total > 0) partes.push(`Total estimado: *${plata(total)}*`)
  if (enlace) partes.push('', enlace)
  return partes.join('\n')
}

/**
 * Lo manda por el menú de compartir del celular (WhatsApp, Telegram…); si no existe, abre WhatsApp directo.
 * Devuelve false si la persona canceló.
 */
export async function compartirTexto(texto: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: texto })
      return true
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
  return true
}
