import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, guardarMeta } from '../datos/db.ts'
import { Ajustes } from './Ajustes.tsx'

const URL_EXEC = 'https://script.google.com/macros/s/OTRO/exec'
/** Los servidores de GitHub Actions son más lentos que un celular con jsdom arrancando: margen amplio. */
const ESPERA = 10_000

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
  // En una máquina lenta la base local responde tarde: se toca el botón cuando ya está habilitado.
  const boton = screen.getByRole('button', { name: 'Guardar y probar' })
  await waitFor(() => expect(boton).toBeEnabled(), { timeout: ESPERA })
  fireEvent.click(boton)
}

describe('Ajustes · copia en Google', () => {
  it('si la URL es de un proyecto sin configurar lo dice, con el proyecto, y no muestra "Copia activa"', async () => {
    backend({ proyecto: 'zzz999', configurado: false })
    await probar()
    expect(await screen.findByRole('alert', {}, { timeout: ESPERA })).toHaveTextContent('proyecto de Apps Script sin configurar (proyecto …zzz999)')
    expect(screen.queryByText(/Copia activa/)).toBeNull()
    expect(screen.getByText(/Todavía no se ha guardado nada en Google/)).toBeInTheDocument()
  })

  it('conectado: dice a qué proyecto y la copia queda activa tras sincronizar', async () => {
    backend({ proyecto: 'abc123', configurado: true, hoja: true })
    await probar()
    expect(await screen.findByText('✔ Conectado al proyecto …abc123. Copiando tus datos…', {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(await screen.findByText(/Copia activa \(proyecto …abc123\)/, {}, { timeout: ESPERA })).toBeInTheDocument()
  })
})

describe('Ajustes · dirección', () => {
  it('una dirección que no es de Google no se guarda y el token no sale a ninguna parte', async () => {
    const mock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', mock)
    render(<Ajustes />)
    fireEvent.change(await screen.findByLabelText('Dirección de la aplicación web (termina en /exec)'), { target: { value: 'https://ejemplo.com/exec' } })
    fireEvent.change(screen.getByLabelText('Clave (token)'), { target: { value: 'secreta' } })
    const boton = screen.getByRole('button', { name: 'Guardar y probar' })
    await waitFor(() => expect(boton).toBeEnabled(), { timeout: ESPERA })
    fireEvent.click(boton)
    expect(await screen.findByRole('alert', {}, { timeout: ESPERA })).toHaveTextContent('no parece la de una aplicación web de Google')
    expect(mock).not.toHaveBeenCalled()
    expect((await db.meta.get('conexion'))?.valor).toEqual({ url: '', token: '' })
  })
})

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

describe('Ajustes · script de Google', () => {
  it('con cargador: dice que se actualiza solo y "Actualizar ahora" pide la actualización', async () => {
    const acciones: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ ok: true, data: { app: 'precios-mercado', v: 1, proyecto: 'abc123', configurado: true, hoja: true, version: 'gas-v1' }, error: null, v: 1 }))
      const a = JSON.parse(String(init.body)).a
      acciones.push(a)
      const data = a === 'diag'
        ? { pestanasFaltantes: [], version: 'gas-v3', cargador: 1, actualizacion: { estado: 'error', nueva: 'gas-v4', mensaje: 'No se pudo actualizar: Code.js: HTTP 502', fecha: '' } }
        : a === 'actualizarScript' ? { estado: 'actualizado', nueva: 'gas-v4', mensaje: 'Actualizado de gas-v3 a gas-v4.', fecha: '', cargador: 1 }
          : a === 'pull' ? { tablas: {}, cursor: 'c' } : { resultados: [] }
      return new Response(JSON.stringify({ ok: true, data, error: null, v: 1 }))
    }))
    await probar()
    expect(await screen.findByText(/Versión gas-v3\. Se actualiza solo/, {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(screen.getByText('No se pudo actualizar: Code.js: HTTP 502')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar ahora' }))
    expect(await screen.findByText('Actualizado de gas-v3 a gas-v4.', {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(acciones).toContain('actualizarScript')
    expect(await screen.findByText(/Versión gas-v4/, {}, { timeout: ESPERA })).toBeInTheDocument()
  })

  it('sin cargador (código pegado completo): explica cómo dejarlo automático y no ofrece "Actualizar ahora"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ ok: true, data: { app: 'precios-mercado', v: 1, proyecto: 'abc123', configurado: true, hoja: true, version: 'gas-v1' }, error: null, v: 1 }))
      const a = JSON.parse(String(init.body)).a
      const data = a === 'diag'
        ? { pestanasFaltantes: [], version: 'gas-v1', actualizacion: { estado: 'api_apagada', nueva: 'gas-v2', mensaje: 'Falta activar la API', fecha: '' } }
        : a === 'pull' ? { tablas: {}, cursor: 'c' } : { resultados: [] }
      return new Response(JSON.stringify({ ok: true, data, error: null, v: 1 }))
    }))
    await probar()
    expect(await screen.findByText(/pega el cargador en Apps Script/, {}, { timeout: ESPERA })).toBeInTheDocument()
    expect(screen.queryByText(/Falta activar la API/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Actualizar ahora' })).toBeNull()
  })
})
