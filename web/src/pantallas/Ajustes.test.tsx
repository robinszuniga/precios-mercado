import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, guardarMeta } from '../datos/db.ts'
import { Ajustes } from './Ajustes.tsx'

const URL_EXEC = 'https://script.google.com/macros/s/OTRO/exec'

function backend(ping: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ ok: true, data: { app: 'precios-mercado', v: 1, ...ping }, error: null, v: 1 }))
    const a = JSON.parse(String(init.body)).a
    const data = a === 'diag' ? { pestanasFaltantes: [] } : a === 'pull' ? { tablas: {}, cursor: 'c' } : { resultados: [] }
    return new Response(JSON.stringify({ ok: true, data, error: null, v: 1 }))
  }))
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: '', token: '' })
})
afterEach(() => vi.unstubAllGlobals())

async function probar() {
  render(<Ajustes />)
  fireEvent.change(await screen.findByLabelText('Dirección de la aplicación web (termina en /exec)'), { target: { value: URL_EXEC } })
  fireEvent.change(screen.getByLabelText('Clave (token)'), { target: { value: 'clave' } })
  fireEvent.click(screen.getByRole('button', { name: 'Guardar y probar' }))
}

describe('Ajustes · copia en Google', () => {
  it('si la URL es de un proyecto sin configurar lo dice, con el proyecto, y no muestra "Copia activa"', async () => {
    backend({ proyecto: 'zzz999', configurado: false })
    await probar()
    expect(await screen.findByRole('alert')).toHaveTextContent('proyecto de Apps Script sin configurar (proyecto …zzz999)')
    expect(screen.queryByText(/Copia activa/)).toBeNull()
    expect(screen.getByText(/Todavía no se ha guardado nada en Google/)).toBeInTheDocument()
  })

  it('conectado: dice a qué proyecto y la copia queda activa tras sincronizar', async () => {
    backend({ proyecto: 'abc123', configurado: true, hoja: true })
    await probar()
    expect(await screen.findByText('✔ Conectado al proyecto …abc123. Copiando tus datos…')).toBeInTheDocument()
    expect(await screen.findByText(/Copia activa \(proyecto …abc123\)/)).toBeInTheDocument()
  })
})
