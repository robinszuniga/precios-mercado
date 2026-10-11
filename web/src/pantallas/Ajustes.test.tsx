import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../datos/db.ts'
import { Ajustes } from './Ajustes.tsx'

/** Los servidores de GitHub Actions son más lentos que un celular con jsdom arrancando: margen amplio. */
const ESPERA = 10_000

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})
afterEach(() => vi.unstubAllGlobals())

// Las pruebas de la conexión con Google (dirección /exec, token, "Actualizar ahora" del script) se quitaron: esa pantalla
// ya no existe. Con Supabase la cuenta es la que inicia sesión y la función de precios se publica junto con la app.

describe('Ajustes · reglas', () => {
  it('borrar un número para reescribirlo no guarda 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    render(<Ajustes />)
    const campo = await screen.findByLabelText('Precio de tienda vencido (días)', {}, { timeout: ESPERA })
    fireEvent.change(campo, { target: { value: '' } })
    fireEvent.blur(campo)
    fireEvent.change(campo, { target: { value: '0' } })
    fireEvent.blur(campo)
    expect(await db.config.get('vigencia_tienda_max_dias')).toBeUndefined()
    fireEvent.change(campo, { target: { value: '45' } })
    fireEvent.blur(campo)
    await waitFor(async () => expect((await db.config.get('vigencia_tienda_max_dias'))?.valor).toBe('45'))
  })
})

describe('Ajustes · cambios rechazados', () => {
  it('agrupa los motivos con su cuenta y "Reenviar" los vuelve a poner en la cola', async () => {
    const payload = { cambios: [] }
    await db.rechazados.bulkAdd([
      { tabla: 'upsert', filaId: '1', mensaje: 'viola la llave foránea', fecha: 1, payload },
      { tabla: 'upsert', filaId: '2', mensaje: 'viola la llave foránea', fecha: 2, payload },
      { tabla: 'upsert', filaId: '3', mensaje: 'fuera de rango', fecha: 3, payload },
    ])
    render(<Ajustes />)
    fireEvent.click(await screen.findByText('Avanzado (diagnóstico)', {}, { timeout: ESPERA }))
    expect(await screen.findByText('2 × viola la llave foránea')).toBeInTheDocument()
    expect(screen.getByText('1 × fuera de rango')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reenviar los rechazados' }))
    await waitFor(async () => expect(await db.rechazados.count()).toBe(0))
    expect(await db.outbox.count()).toBe(3)
  })
})

