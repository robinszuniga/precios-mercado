import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pagina } from '../app/recargar.ts'
import { db } from '../datos/db.ts'

// La descarga del mapa falla (sin señal, o un fragmento que ya no existe tras un despliegue).
vi.mock('../componentes/MapaLeaflet.tsx', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

import { Mapa } from './Mapa.tsx'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  location.hash = '#/mapa'
})

describe('Mapa: si no cargó, «Reintentar»', () => {
  it('recarga la página (un segundo import() fallido no vuelve a pedir nada al navegador, y el CSS que falló tampoco)', async () => {
    const recargar = vi.spyOn(pagina, 'recargar').mockImplementation(() => {})
    render(<Mapa />)
    expect(await screen.findByText(/No se pudo cargar el mapa/, {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(createElement).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(recargar).toHaveBeenCalledTimes(1)
  })
})
