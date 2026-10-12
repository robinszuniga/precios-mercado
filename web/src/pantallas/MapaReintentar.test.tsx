import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../datos/db.ts'

// La primera descarga del mapa falla (sin señal, o un fragmento que ya no existe tras un despliegue); la segunda funciona.
const h = vi.hoisted(() => ({ cargas: 0 }))
vi.mock('../componentes/MapaLeaflet.tsx', () => {
  h.cargas++
  if (h.cargas === 1) throw new Error('Failed to fetch dynamically imported module')
  return { default: () => createElement('div', { 'data-testid': 'mapa' }, 'el mapa') }
})

import { Mapa } from './Mapa.tsx'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  location.hash = '#/mapa'
})

describe('Mapa: si no cargó, «Reintentar» vuelve a pedirlo', () => {
  it('el primer toque en «Reintentar» muestra el mapa (no vuelve al mismo error)', async () => {
    render(<Mapa />)
    expect(await screen.findByText(/No se pudo cargar el mapa/, {}, { timeout: 10_000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByTestId('mapa', {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.queryByText(/No se pudo cargar el mapa/)).toBeNull()
  })
})
