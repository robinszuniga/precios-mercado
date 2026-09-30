import { describe, expect, it } from 'vitest'
import { textoPlan } from './compartir.ts'

describe('lista para WhatsApp', () => {
  it('una sección por tienda en negrita, lo sin precio aparte y el total, sin espacios duros', () => {
    const t = textoPlan(
      [
        { tienda: 'OLIMPICA', total: 15600, lineas: [{ nombre: 'Arroz', detalle: '3 × Arroz Diana 1 kg', costo: 15600 }] },
        { tienda: 'D1', total: 12000, lineas: [{ nombre: 'Huevos', detalle: '1 × Huevo AA x 30', costo: 12000 }] },
      ],
      ['Cilantro'],
      27600,
      new Date(2026, 8, 30),
    )
    expect(t).toContain('*Olímpica* · $ 15.600')
    expect(t).toContain('▢ Arroz — 3 × Arroz Diana 1 kg · $ 15.600')
    expect(t).toContain('*D1* · $ 12.000')
    expect(t).toMatch(/Sin precio[^\n]*\n▢ Cilantro/)
    expect(t).toContain('Total estimado: *$ 27.600*')
    expect(t).not.toContain(' ')
    expect(t.split('\n')[0]).toMatch(/^🛒 Mercado · .*30/)
  })

  it('solo lo que va sin precio: sin total', () => {
    expect(textoPlan([], ['Pan'], 0)).not.toContain('Total')
  })

  it('los símbolos de formato en un nombre no se vuelven negrita y no quedan renglones vacíos', () => {
    const t = textoPlan([{ tienda: 'D1', total: 1000, lineas: [{ nombre: 'Arroz *Diana*', detalle: '1 × Diana 1 kg', costo: 1000 }] }], ['Sal — 1 kg', '', '  '], 1000, new Date(2026, 8, 30))
    expect(t).toContain('▢ Arroz Diana — 1 × Diana 1 kg')
    expect(t).not.toMatch(/▢ \s*$/m)
    expect(t).toContain('▢ Sal — 1 kg')
  })
})

