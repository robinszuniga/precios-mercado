import type { Punto } from '@shared/mapa.ts'

export type MotivoUbicacion = 'denegado' | 'no_disponible' | 'tiempo'

export class ErrorUbicacion extends Error {
  readonly motivo: MotivoUbicacion
  constructor(motivo: MotivoUbicacion) {
    super(motivo)
    this.motivo = motivo
  }
}

export const MENSAJE_UBICACION: Record<MotivoUbicacion, string> = {
  denegado: 'No tengo permiso para ver dónde estás. Actívalo en los ajustes del navegador para este sitio, o usa «Marcar en el mapa» para poner el punto tú.',
  no_disponible: 'Este dispositivo no pudo darme la ubicación. Usa «Marcar en el mapa» para poner el punto tú.',
  tiempo: 'La ubicación tardó demasiado. Inténtalo de nuevo, o usa «Marcar en el mapa» para poner el punto tú.',
}

export interface Ubicacion extends Punto {
  /** Radio de incertidumbre en metros, si el dispositivo lo dice. */
  precision?: number
}

/**
 * La ubicación de ahora. Solo se usa en pantalla: no se guarda ni se envía a ningún servidor.
 * `exacta` pide la mejor medición (GPS) y no acepta una guardada: para anotar dónde queda una tienda.
 */
export function ubicarme(exacta = false): Promise<Ubicacion> {
  return new Promise((resolver, rechazar) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return rechazar(new ErrorUbicacion('no_disponible'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolver({ lat: p.coords.latitude, lng: p.coords.longitude, precision: typeof p.coords.accuracy === 'number' ? p.coords.accuracy : undefined }),
      (e) => rechazar(new ErrorUbicacion(e.code === 1 ? 'denegado' : e.code === 3 ? 'tiempo' : 'no_disponible')),
      { enableHighAccuracy: exacta, timeout: exacta ? 20_000 : 12_000, maximumAge: exacta ? 0 : 60_000 },
    )
  })
}
