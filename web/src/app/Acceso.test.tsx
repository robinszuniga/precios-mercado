import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sesion: null as null | { user: { id: string; email: string } },
  avisarCambio: null as null | ((s: { user: { id: string; email: string } } | null) => void),
}))

vi.mock('../datos/supabase.ts', () => ({
  supabaseConfigurado: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: h.sesion }, error: null }),
      onAuthStateChange: (cb: (evento: string, s: unknown) => void) => {
        h.avisarCambio = (s) => cb('SIGNED_IN', s)
        return { data: { subscription: { unsubscribe: () => { h.avisarCambio = null } } } }
      },
      signInWithOAuth: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    },
  },
}))
vi.mock('../datos/sync.ts', () => ({
  arrancarSincronizacion: () => () => {},
  esperarSincronizacion: async () => {},
}))

import { propietarioDb } from '../datos/db.ts'
import { Acceso } from './Acceso.tsx'

const cuenta = (id: string) => ({ user: { id, email: `${id}@local.test` } })

function Contador() {
  const [n, setN] = useState(0)
  return <button type="button" onClick={() => setN(n + 1)}>Toques: {n}</button>
}

beforeEach(() => { h.sesion = null })

describe('Acceso', () => {
  it('con una sesión guardada abre la app, también en modo estricto de React (que monta dos veces)', async () => {
    h.sesion = cuenta('aaaa')
    render(<StrictMode><Acceso><p>La app</p></Acceso></StrictMode>)
    expect(await screen.findByText('La app')).toBeInTheDocument()
    expect(screen.queryByText(/DatabaseClosedError|No se pudo iniciar sesión/)).toBeNull()
    expect(propietarioDb).toBe('aaaa')
  })

  it('sin sesión muestra el botón para entrar y no la app', async () => {
    render(<StrictMode><Acceso><p>La app</p></Acceso></StrictMode>)
    expect(await screen.findByRole('button', { name: 'Continuar con Google' })).toBeInTheDocument()
    expect(screen.queryByText('La app')).toBeNull()
    expect(propietarioDb).toBeNull()
  })

  it('al cambiar de cuenta la app se monta de cero y la base local pasa a ser la de la cuenta nueva', async () => {
    h.sesion = cuenta('aaaa')
    render(<StrictMode><Acceso><Contador /></Acceso></StrictMode>)
    const boton = await screen.findByRole('button', { name: 'Toques: 0' })
    act(() => boton.click())
    expect(await screen.findByRole('button', { name: 'Toques: 1' })).toBeInTheDocument()

    await act(async () => { h.avisarCambio?.(cuenta('bbbb')) })
    // No queda el estado de la cuenta anterior (los "toques" vuelven a 0) y la base local es la de B.
    expect(await screen.findByRole('button', { name: 'Toques: 0' })).toBeInTheDocument()
    await waitFor(() => expect(propietarioDb).toBe('bbbb'))
  })
})
