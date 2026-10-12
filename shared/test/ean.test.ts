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

  it('con ceros de más o de menos (GTIN-14, o recortados) sigue siendo el mismo código; un código de empaque o corto no', () => {
    expect(mismoEan('07702001234561', '7702001234561')).toBe(true) // GTIN-14 con un cero adelante
    expect(mismoEan('12345678905', '0012345678905')).toBe(true) // 11 dígitos contra 13
    expect(mismoEan('96385074', '0000096385074')).toBe(true) // EAN-8
    expect(mismoEan('17702001234568', '7702001234561')).toBe(false) // otro nivel de empaque, no el mismo
    expect(mismoEan('7702001234561', '7702001234562')).toBe(false)
    expect(mismoEan('1234567', '0001234567')).toBe(false) // demasiado corto para ser un código
  })
})
