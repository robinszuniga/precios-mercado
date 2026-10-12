import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Sede } from '@shared/mapa.ts'
import MapaLeaflet, { type PinSede } from './MapaLeaflet.tsx'

const sede = (id: string, tienda: Sede['tienda'], lat: number, lng: number, nombre = id): Sede => ({ id, tienda, nombre, lat, lng })
const pin = (s: Sede, extra: Partial<PinSede> = {}): PinSede => ({ sede: s, etiqueta: '', mejor: false, enPlan: true, ...extra })

describe('MapaLeaflet (el mapa de verdad, sin red: sin teselas)', () => {
  it('dibuja un pin por sede, con nombre accesible, y avisa cuál se tocó', () => {
    const alElegir = vi.fn()
    const pines = [pin(sede('a', 'D1', 11.5, -72.9, 'D1 Calle 15'), { etiqueta: '$ 8.800', mejor: true }), pin(sede('b', 'EXITO', 11.6, -72.9, 'Éxito Centro'))]
    const { container } = render(<MapaLeaflet centro={{ lat: 11.5444, lng: -72.9072 }} pines={pines} yo={null} seleccionada={null} onSeleccionar={alElegir} />)
    expect(screen.getByRole('region', { name: 'Mapa de tiendas' })).toBeInTheDocument()
    const marcadores = container.querySelectorAll('.leaflet-marker-icon')
    expect(marcadores).toHaveLength(2)
    // Nombre accesible completo (no solo la letra del icono) y rol de botón.
    const d1 = container.querySelector('[aria-label="D1: D1 Calle 15, $ 8.800"]')
    expect(d1).not.toBeNull()
    expect(d1).toHaveAttribute('role', 'button')
    fireEvent.click(marcadores[0])
    expect(alElegir).toHaveBeenCalledWith('a')
    // Con teclado: Enter y Espacio eligen el pin.
    alElegir.mockClear()
    fireEvent.keyDown(d1!, { key: 'Enter' })
    fireEvent.keyDown(d1!, { key: ' ' })
    fireEvent.keyDown(d1!, { key: 'a' })
    expect(alElegir).toHaveBeenCalledTimes(2)
    // La atribución de OpenStreetMap es obligatoria.
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain('OpenStreetMap')
  })

  it('al cambiar las sedes se redibujan; con "yo" aparece el punto azul; y al cerrar no deja nada', () => {
    const a = pin(sede('a', 'D1', 11.5, -72.9))
    const b = pin(sede('b', 'ARA', 11.6, -72.9))
    const props = { centro: { lat: 11.5, lng: -72.9 }, seleccionada: null, onSeleccionar: () => {} }
    const { container, rerender, unmount } = render(<MapaLeaflet {...props} pines={[a]} yo={null} />)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1)
    rerender(<MapaLeaflet {...props} pines={[a, b]} yo={{ lat: 11.55, lng: -72.9 }} />)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(2)
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(1) // el círculo de "yo"
    rerender(<MapaLeaflet {...props} pines={[]} yo={null} />)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0)
    unmount()
    expect(document.querySelector('.leaflet-container')).toBeNull()
  })

  it('al cambiar el texto o la elección se actualiza el mismo pin (no se recrea): el foco del teclado se conserva', () => {
    const props = { centro: { lat: 11.5, lng: -72.9 }, yo: null, onSeleccionar: () => {} }
    const a = sede('a', 'D1', 11.5, -72.9)
    const { container, rerender } = render(<MapaLeaflet {...props} pines={[pin(a)]} seleccionada={null} />)
    const antes = container.querySelector('.leaflet-marker-icon') as HTMLElement
    antes.focus()
    rerender(<MapaLeaflet {...props} pines={[pin(a, { etiqueta: '$ 9.900', mejor: true })]} seleccionada="a" />)
    const despues = container.querySelector('.leaflet-marker-icon') as HTMLElement
    expect(despues).toBe(antes)
    expect(despues).toHaveAttribute('aria-label', 'D1: a, $ 9.900')
    expect(document.activeElement).toBe(antes)
  })

  it('el punto marcado para una sede nueva se dibuja aparte y desaparece al limpiarlo', () => {
    const props = { centro: { lat: 11.5, lng: -72.9 }, yo: null, pines: [], seleccionada: null, onSeleccionar: () => {} }
    const { container, rerender } = render(<MapaLeaflet {...props} nuevo={{ lat: 11.5, lng: -72.9 }} />)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1)
    rerender(<MapaLeaflet {...props} nuevo={null} />)
    expect(container.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0)
  })

  it('cada pin recibe el toque en un área de al menos 44 × 44 px (el círculo que se ve es más chico)', () => {
    const pines = [pin(sede('a', 'D1', 11.5, -72.9)), pin(sede('b', 'EXITO', 11.6, -72.9), { mejor: true })]
    const { container } = render(<MapaLeaflet centro={{ lat: 11.5, lng: -72.9 }} pines={pines} yo={null} seleccionada={null} onSeleccionar={() => {}} />)
    const marcadores = [...container.querySelectorAll<HTMLElement>('.leaflet-marker-icon')]
    expect(marcadores).toHaveLength(2)
    for (const m of marcadores) {
      expect(parseInt(m.style.width, 10)).toBeGreaterThanOrEqual(44)
      expect(parseInt(m.style.height, 10)).toBeGreaterThanOrEqual(44)
    }
    // El círculo dibujado queda centrado dentro de esa área.
    expect(marcadores[0].querySelector<HTMLElement>('[aria-hidden]')?.style.width).toBe('34px')
  })

  it('los controles de zoom están en español', () => {
    const { container } = render(<MapaLeaflet centro={{ lat: 11.5, lng: -72.9 }} pines={[]} yo={null} seleccionada={null} onSeleccionar={() => {}} />)
    expect(container.querySelector('a[title="Acercar"]')).not.toBeNull()
    expect(container.querySelector('a[title="Alejar"]')).not.toBeNull()
  })

  it('el nombre de una sede con caracteres raros no inyecta HTML', () => {
    const mala = pin(sede('x', 'D1', 11.5, -72.9, '<img src=x onerror=alert(1)>'))
    const { container } = render(<MapaLeaflet centro={{ lat: 11.5, lng: -72.9 }} pines={[mala]} yo={null} seleccionada={null} onSeleccionar={() => {}} />)
    expect(container.querySelector('img[src="x"]')).toBeNull()
  })
})
