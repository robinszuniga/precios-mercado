import { describe, expect, it } from 'vitest'
import { numeroCO, parseContenido } from '../src/contenido.ts'

describe('numeroCO', () => {
  it.each([
    ['1.000', false, 1000],
    ['1,5', false, 1.5],
    ['1.5', false, 1.5],
    ['2.500', false, 2500],
    ['2.500', true, 2.5],
    ['1.000,5', false, 1000.5],
    ['500', false, 500],
  ])('%s (grande=%s) = %d', (s, grande, esperado) => {
    expect(numeroCO(s, grande)).toBe(esperado)
  })
})

describe('parseContenido', () => {
  it.each([
    ['Arroz Diana 1000 g', 1000, 'g'],
    ['Arroz DIANA x 500 gr', 500, 'g'],
    ['Arroz Roa 1.000 g', 1000, 'g'],
    ['Azúcar Manuelita 2.5 kg', 2500, 'g'],
    ['Azúcar Riopaila 2.500 kg', 2500, 'g'],
    ['Azucar 5 Kg', 5000, 'g'],
    ['Aceite Premier 3000 ml', 3000, 'ml'],
    ['Gaseosa Coca-Cola 1.5 L', 1500, 'ml'],
    ['Gaseosa Postobón 1,5 Lt', 1500, 'ml'],
    ['Leche Colanta Entera 6 und x 1100 ml', 6600, 'ml'],
    ['Leche Alquería x6 200ml', 1200, 'ml'],
    ['Leche Latti 200 ml x 6', 1200, 'ml'],
    ['Atún Van Camps 3 x 160 g', 480, 'g'],
    ['Pack 6 x 200 ml Jugo Hit', 1200, 'ml'],
    ['Huevos AA Kikes x 30 und', 30, 'unidad'],
    ['Huevo Rojo x30', 30, 'unidad'],
    ['Papel Higiénico Familia 12 rollos', 12, 'unidad'],
    ['Queso campesino 250g', 250, 'g'],
    ['Café Sello Rojo 500 gramos', 500, 'g'],
    ['Detergente Fab 1 kg', 1000, 'g'],
    ['Carne molida 1 lb', 500, 'g'],
    ['Agua Cristal 600cc', 600, 'ml'],
    ['Pan tajado Bimbo 600 G', 600, 'g'],
    ['Jabón Rey x 3 und 300 g', 900, 'g'],
    ['Mantequilla 125gr', 125, 'g'],
    ['Pasta Doria Spaghetti 250 g', 250, 'g'],
    ['Crema dental Colgate 3 x 75 ml', 225, 'ml'],
    ['Leche en polvo 380 G', 380, 'g'],
    ['Aguacate Hass und', null, null],
    ['Banano', null, null],
  ])('%s', (nombre, valor, unidad) => {
    const r = parseContenido(nombre)
    if (valor == null) expect(r).toBeNull()
    else expect(r).toMatchObject({ valor, unidad })
  })

  it('las libras quedan con confianza baja', () => {
    expect(parseContenido('Carne 2 lb')?.confianza).toBe('baja')
  })
})
