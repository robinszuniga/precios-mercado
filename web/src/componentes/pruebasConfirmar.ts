import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

/** Toca un botón que confirma algo irreversible: espera a que termine su pausa de seguridad (ver `BotonConfirmar`). */
export async function confirmarIrreversible(nombre: string | RegExp, timeout = 5000) {
  const boton = await screen.findByRole('button', { name: nombre }, { timeout })
  await waitFor(() => expect(boton).toBeEnabled(), { timeout })
  fireEvent.click(boton)
}
