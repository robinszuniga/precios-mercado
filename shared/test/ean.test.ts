import { describe, expect, it } from 'vitest'
import { eanValido, mismoEan, normalizarEan } from '../src/ean.ts'

describe('códigos de barras', () => {
  it('valida el dígito de control de EAN-13, EAN-8 y UPC-A', () => {
    expect(eanValido('7702511000014')).toBe(true)
    expect(eanValido('7702511000015')).toBe(false)
    expect(eanValido('96385074')).toBe(true)
    expect(eanValido('036000291452')).toBe(true) // UPC-A
    expect(eanValido('12345')).toBe(false)
    expect(eanValido('')).toBe(false)
  })

  it('un UPC-A y su EAN-13 son el mismo producto; vacío nunca coincide', () => {
    expect(normalizarEan('036000291452')).toBe('0036000291452')
    expect(mismoEan('036000291452', '0036000291452')).toBe(true)
    expect(mismoEan('7702511000014', ' 7702511000014 ')).toBe(true)
    expect(mismoEan('', '')).toBe(false)
  })
})
