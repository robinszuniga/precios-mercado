import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { estadoPresupuesto } from '@shared/presupuesto.ts'
import { leerRuta } from '../app/ruta.ts'
import { BarraPresupuesto } from './BarraPresupuesto.tsx'
import { leerNumero } from './ui.tsx'
import { precioAtipico } from './RegistrarPrecio.tsx'

const d = (precio: number) => ({ estado: 'en_carrito' as const, cantidad: 1, precio_unitario: precio, borrado: false })

describe('BarraPresupuesto', () => {
  it.each([
    [50_000, 'verde', 'Te quedan'],
    [90_000, 'amarillo', 'Te quedan'],
    [120_000, 'rojo', 'Te pasaste'],
  ])('%d de 100.000 → %s', (gasto, color, texto) => {
    const { container } = render(<BarraPresupuesto estado={estadoPresupuesto([d(gasto)], 100_000, 0.85)} />)
    expect(container.firstChild).toHaveAttribute('data-color', color)
    expect(screen.getByText(texto)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(Math.min(100, Math.round(gasto / 1000))))
  })

  it('sin presupuesto solo muestra el total', () => {
    render(<BarraPresupuesto estado={estadoPresupuesto([d(12_345)], null, 0.85)} />)
    expect(screen.getByText('$ 12.345')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
})

describe('precio atípico', () => {
  it('pide confirmar si se aleja más de 50 % del anterior (un cero de más o de menos)', () => {
    expect(precioAtipico(19900, 1990)).toBe(true)
    expect(precioAtipico(199, 1990)).toBe(true)
    expect(precioAtipico(2200, 1990)).toBe(false)
    expect(precioAtipico(2200, null)).toBe(false)
  })
})

describe('utilidades', () => {
  it('lee números como se escriben en Colombia', () => {
    expect(leerNumero('4.500')).toBe(4500)
    expect(leerNumero('1,37')).toBe(1.37)
    expect(leerNumero('250000')).toBe(250000)
    expect(leerNumero('')).toBeNull()
    expect(leerNumero('abc')).toBeNull()
  })

  it('rutas por hash', () => {
    expect(leerRuta('#/producto/abc%20d')).toEqual({ vista: 'producto', id: 'abc d' })
    expect(leerRuta('#/historico/compra/c1')).toEqual({ vista: 'historico', compraId: 'c1' })
    expect(leerRuta('')).toEqual({ vista: 'lista' })
    expect(leerRuta('#/cualquiera')).toEqual({ vista: 'lista' })
  })
})
