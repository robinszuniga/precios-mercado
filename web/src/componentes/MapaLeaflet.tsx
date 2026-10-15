import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { Punto, Sede } from '@shared/mapa.ts'
import { INFO_TIENDAS, type Tienda } from '@shared/tiendas.ts'

/** Se carga solo al abrir el mapa (`lazy`): Leaflet y sus estilos no pesan en el resto de la app. */

export interface PinSede {
  sede: Sede
  /** Texto corto bajo el nombre, por ejemplo lo que cuesta la lista ahí. */
  etiqueta: string
  /** La más barata con todo lo de la lista. */
  mejor: boolean
  /** Está en el plan de hoy. */
  enPlan: boolean
}

interface Props {
  centro: Punto
  pines: readonly PinSede[]
  yo: Punto | null
  /** El punto que la persona acaba de marcar para una sede nueva (todavía sin guardar). */
  nuevo?: Punto | null
  seleccionada: string | null
  onSeleccionar: (id: string) => void
  /** Si se da, un toque en el mapa devuelve ese punto (para agregar una sede). */
  onTocarMapa?: (p: Punto) => void
  /** Las teselas (el dibujo del mapa) no se pudieron bajar: normalmente, sin señal. */
  onSinTeselas?: () => void
}

const COLOR: Record<Tienda, { fondo: string; texto: string; letra: string }> = {
  EXITO: { fondo: '#facc15', texto: '#1c1917', letra: 'É' },
  OLIMPICA: { fondo: '#be123c', texto: '#ffffff', letra: 'O' },
  D1: { fondo: '#7f1d1d', texto: '#ffffff', letra: 'D1' },
  METRO: { fondo: '#1d4ed8', texto: '#ffffff', letra: 'M' },
  ARA: { fondo: '#c2410c', texto: '#ffffff', letra: 'A' },
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Lo mínimo que debe medir lo que se toca con el dedo. */
const AREA_TOQUE = 44

function icono(tienda: Tienda, mejor: boolean, enPlan: boolean, elegida: boolean): L.DivIcon {
  const c = COLOR[tienda]
  // El círculo que se ve mide 34 (40 el destacado), pero el área que recibe el toque es de 44 como mínimo: la caja del
  // pin es transparente y el círculo va centrado dentro.
  const tam = mejor || elegida ? 40 : 34
  const area = Math.max(AREA_TOQUE, tam + 4)
  const borde = mejor ? '#15803d' : elegida ? '#0f766e' : '#ffffff'
  const grosor = mejor || elegida ? 4 : 2
  const opacidad = enPlan || mejor || elegida ? 1 : 0.7
  return L.divIcon({
    className: '',
    iconSize: [area, area],
    iconAnchor: [area / 2, area / 2],
    html: `<span style="display:grid;place-items:center;width:${area}px;height:${area}px"><span aria-hidden="true" style="display:grid;place-items:center;width:${tam}px;height:${tam}px;box-sizing:border-box;border-radius:9999px;background:${c.fondo};color:${c.texto};border:${grosor}px solid ${borde};box-shadow:0 1px 4px rgba(0,0,0,.45);font:700 ${c.letra.length > 1 ? 13 : 16}px/1 system-ui,sans-serif;opacity:${opacidad}">${escapar(c.letra)}</span></span>`,
  })
}

const ICONO_NUEVO = L.divIcon({
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  html: '<span aria-hidden="true" style="display:grid;place-items:center;width:36px;height:36px;border-radius:9999px;background:#ffffff;color:#0f766e;border:3px dashed #0f766e;font:700 22px/1 system-ui,sans-serif">+</span>',
})

export default function MapaLeaflet({ centro, pines, yo, nuevo = null, seleccionada, onSeleccionar, onTocarMapa, onSinTeselas }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const mapa = useRef<L.Map | null>(null)
  const capaSedes = useRef<L.LayerGroup | null>(null)
  const capaExtras = useRef<L.LayerGroup | null>(null)
  const marcadores = useRef(new Map<string, L.Marker>())
  const alSeleccionar = useRef(onSeleccionar)
  const alTocar = useRef(onTocarMapa)
  const alFallarTeselas = useRef(onSinTeselas)
  alSeleccionar.current = onSeleccionar
  alTocar.current = onTocarMapa
  alFallarTeselas.current = onSinTeselas
  const encuadrado = useRef('')

  useEffect(() => {
    if (!caja.current) return
    // Controles de zoom en español y más grandes (ver estilos.css): los de fábrica son de 30 px y en inglés.
    const m = L.map(caja.current, { center: [centro.lat, centro.lng], zoom: 13, zoomControl: false })
    L.control.zoom({ zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(m)
    let avisado = false
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).on('tileerror', () => { if (!avisado) { avisado = true; alFallarTeselas.current?.() } }).addTo(m)
    capaSedes.current = L.layerGroup().addTo(m)
    capaExtras.current = L.layerGroup().addTo(m)
    // `wrap()`: en otra «copia del mundo» la longitud sale fuera de -180..180; se lleva a su valor real.
    m.on('click', (e: L.LeafletMouseEvent) => { const p = e.latlng.wrap(); alTocar.current?.({ lat: p.lat, lng: p.lng }) })
    mapa.current = m
    const vivos = marcadores.current
    return () => { m.remove(); mapa.current = null; capaSedes.current = null; capaExtras.current = null; vivos.clear(); encuadrado.current = '' }
    // El mapa se crea una sola vez; lo demás se actualiza abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = mapa.current
    const g = capaSedes.current
    const extras = capaExtras.current
    if (!m || !g || !extras) return
    // Los pines se actualizan en su lugar (no se borran y se vuelven a crear): así el foco del teclado no se pierde.
    const ids = new Set(pines.map((p) => p.sede.id))
    for (const [id, marcador] of marcadores.current) {
      if (!ids.has(id)) { g.removeLayer(marcador); marcadores.current.delete(id) }
    }
    const puntos: L.LatLngExpression[] = []
    for (const p of pines) {
      const { sede } = p
      const nombre = `${INFO_TIENDAS[sede.tienda].nombre}: ${sede.nombre}${p.etiqueta ? `, ${p.etiqueta}` : ''}`
      const icon = icono(sede.tienda, p.mejor, p.enPlan, sede.id === seleccionada)
      let marcador = marcadores.current.get(sede.id)
      if (!marcador) {
        marcador = L.marker([sede.lat, sede.lng], { icon, keyboard: true })
        marcador.on('click', () => alSeleccionar.current(sede.id))
        marcador.addTo(g)
        marcadores.current.set(sede.id, marcador)
        // Enter y Espacio eligen el pin (Leaflet solo reacciona a Enter y no en todos los navegadores).
        marcador.getElement()?.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alSeleccionar.current(sede.id) }
        })
      } else {
        marcador.setLatLng([sede.lat, sede.lng])
        marcador.setIcon(icon)
      }
      // Con dos sedes casi encimadas, la elegida y la más barata quedan por encima y se pueden tocar.
      marcador.setZIndexOffset(sede.id === seleccionada ? 1000 : p.mejor ? 500 : 0)
      const el = marcador.getElement()
      if (el) {
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', nombre)
        el.setAttribute('title', nombre)
      }
      puntos.push([sede.lat, sede.lng])
    }
    extras.clearLayers()
    if (yo) {
      L.circleMarker([yo.lat, yo.lng], { radius: 8, color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(extras)
      puntos.push([yo.lat, yo.lng])
    }
    if (nuevo) L.marker([nuevo.lat, nuevo.lng], { icon: ICONO_NUEVO, interactive: false, keyboard: false }).addTo(extras)
    // Se reencuadra solo cuando cambia qué hay en el mapa, no con cada toque (si no, el mapa saltaría mientras lo mueves).
    const clave = `${pines.map((p) => p.sede.id).join(',')}|${yo ? 'yo' : ''}`
    if (clave !== encuadrado.current) {
      encuadrado.current = clave
      if (puntos.length > 1) m.fitBounds(L.latLngBounds(puntos), { padding: [32, 32], maxZoom: 16 })
      else if (puntos.length === 1) m.setView(puntos[0], 15)
      else m.setView([centro.lat, centro.lng], 13)
    }
  }, [pines, yo, nuevo, seleccionada, centro.lat, centro.lng])

  useEffect(() => {
    const m = mapa.current
    const s = pines.find((p) => p.sede.id === seleccionada)?.sede
    if (m && s) m.panTo([s.lat, s.lng])
    // Solo cuando cambia la sede elegida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionada])

  useEffect(() => {
    const c = caja.current
    if (c) c.style.cursor = onTocarMapa ? 'crosshair' : ''
  }, [onTocarMapa])

  // `isolate`: los controles de Leaflet usan z-index altos y no deben quedar por encima de la barra de abajo ni de las hojas.
  return <div ref={caja} role="region" aria-label="Mapa de tiendas" className="isolate h-72 w-full overflow-hidden rounded-2xl ring-1 ring-stone-200" />
}
