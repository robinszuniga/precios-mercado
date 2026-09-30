import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Avisos, avisar, Hoja } from './ui.tsx'

describe('hojas y lectores de pantalla', () => {
  it('con una hoja abierta lo de atrás queda inerte, la hoja y los avisos no, y al cerrar se libera', async () => {
    const raiz = document.createElement('div')
    raiz.id = 'raiz'
    document.body.appendChild(raiz)
    const { rerender, unmount } = render(<Hoja abierta titulo="Prueba" onCerrar={() => {}}><button type="button">Dentro</button></Hoja>, { container: raiz.appendChild(document.createElement('div')) })
    expect(raiz).toHaveAttribute('inert')
    expect(screen.getByRole('dialog').closest('#raiz')).toBeNull() // la hoja vive en el <body>, fuera de lo inerte
    rerender(<Hoja abierta={false} titulo="Prueba" onCerrar={() => {}}><button type="button">Dentro</button></Hoja>)
    await waitFor(() => expect(raiz).not.toHaveAttribute('inert'))
    unmount()
    raiz.remove()
  })

  it('el aviso con Deshacer se puede tocar aunque haya una hoja abierta', async () => {
    const raiz = document.createElement('div')
    raiz.id = 'raiz'
    document.body.appendChild(raiz)
    const deshacer = vi.fn()
    render(<><Hoja abierta titulo="Prueba" onCerrar={() => {}}><p>x</p></Hoja><Avisos /></>, { container: raiz.appendChild(document.createElement('div')) })
    avisar('Quitado', deshacer)
    const boton = await screen.findByRole('button', { name: 'Deshacer' })
    expect(boton.closest('#raiz')).toBeNull() // el aviso vive en el <body>, fuera de lo inerte
    fireEvent.click(boton)
    await waitFor(() => expect(deshacer).toHaveBeenCalled())
    raiz.remove()
  })
})
