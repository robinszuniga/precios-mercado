import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const EAN = '7702511000014'
let detector: { detect: () => Promise<{ rawValue: string }[]> }
let cargarDetector: () => Promise<unknown>
vi.mock('./detector.ts', () => ({ obtenerDetector: () => cargarDetector() }))

import { Escaner } from './Escaner.tsx'

const pistas: { stop: ReturnType<typeof vi.fn> }[] = []

beforeEach(() => {
  pistas.length = 0
  detector = { detect: async () => [{ rawValue: EAN }] }
  cargarDetector = async () => detector
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        const pista = { stop: vi.fn() }
        pistas.push(pista)
        return { getTracks: () => [pista] } as unknown as MediaStream
      }),
    },
  })
  // jsdom no reproduce video: se simula que ya está listo para leer.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 })
})
afterEach(() => vi.restoreAllMocks())

describe('Escaner', () => {
  it('entrega el código leído y apaga la cámara al salir', async () => {
    const onCodigo = vi.fn()
    const { unmount } = render(<Escaner onCodigo={onCodigo} onCancelar={() => {}} />)
    await waitFor(() => expect(onCodigo).toHaveBeenCalledWith(EAN))
    expect(onCodigo).toHaveBeenCalledTimes(1)
    unmount()
    expect(pistas.every((p) => p.stop.mock.calls.length > 0)).toBe(true)
  })

  it('si el lector no carga, apaga la cámara y ofrece escribir el código (no dice que faltó el permiso)', async () => {
    cargarDetector = async () => { throw new Error('chunk') }
    render(<Escaner onCodigo={() => {}} onCancelar={() => {}} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No pude cargar el lector de códigos')
    expect(screen.getByRole('alert')).not.toHaveTextContent('permiso')
    expect(pistas).toHaveLength(1)
    expect(pistas[0].stop).toHaveBeenCalled()
    expect(screen.getByLabelText('O escribe el código')).toBeInTheDocument()
  })

  it('si el lector falla cuadro tras cuadro, se rinde con un aviso en vez de quedarse "apuntando" para siempre', async () => {
    detector = { detect: async () => { throw new Error('wasm') } }
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<Escaner onCodigo={() => {}} onCancelar={() => {}} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(await screen.findByRole('alert')).toHaveTextContent('El lector de códigos no está funcionando')
      expect(pistas[0].stop).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('el mismo código justo después de guardar se ignora (la cámara sigue apuntando al producto)', async () => {
    const onCodigo = vi.fn()
    let n = 0
    detector = { detect: async () => [{ rawValue: ++n < 6 ? EAN : '7702511000021' }] }
    render(<Escaner ignorar={EAN} onCodigo={onCodigo} onCancelar={() => {}} />)
    await waitFor(() => expect(onCodigo).toHaveBeenCalled(), { timeout: 4000 })
    expect(onCodigo).toHaveBeenCalledWith('7702511000021')
  })

  it('escribir el código a mano: no regaña mientras se escribe, acepta un UPC-A de 12 dígitos', async () => {
    detector = { detect: async () => [] }
    const onCodigo = vi.fn()
    render(<Escaner onCodigo={onCodigo} onCancelar={() => {}} />)
    const campo = await screen.findByLabelText('O escribe el código')
    fireEvent.change(campo, { target: { value: '77025110' } })
    expect(screen.queryByText(/no es válido/)).toBeNull()
    fireEvent.change(campo, { target: { value: '036000291452' } })
    expect(screen.queryByText(/no es válido/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Listo' }))
    expect(onCodigo).toHaveBeenCalledWith('0036000291452')
    fireEvent.change(campo, { target: { value: '7702511000015' } })
    expect(screen.getByText(/no es válido/)).toBeInTheDocument()
  })
})
