import { describe, expect, it } from 'vitest'
import { claveProducto, emparejar, leerLista, leerRenglon, unidadPorNombre } from '../src/importarLista.ts'

const r = (linea: string) => {
  const x = leerRenglon(linea)
  return x && { nombre: x.nombre, cantidad: x.cantidad, unidad: x.unidad_base, aviso: !!x.aviso }
}

describe('leerRenglon', () => {
  it.each([
    ['Arroz 5 kg', 'Arroz', 5, 'g', false],
    ['5 kg de arroz', 'Arroz', 5, 'g', false],
    ['arroz 5kg', 'Arroz', 5, 'g', false],
    ['Arroz x 5 kg', 'Arroz', 5, 'g', false],
    ['Carne molida 1 lb', 'Carne molida', 0.5, 'g', false],
    ['Arroz 5 libras', 'Arroz', 2.5, 'g', false],
    ['½ libra de queso costeño', 'Queso costeño', 0.25, 'g', false],
    ['Queso media libra', 'Queso', 0.25, 'g', false],
    ['medio kilo de tomate', 'Tomate', 0.5, 'g', false],
    ['Papa 1 1/2 kg', 'Papa', 1.5, 'g', false],
    ['Papa 1,5 kg', 'Papa', 1.5, 'g', false],
    ['Frijol 500 g', 'Frijol', 0.5, 'g', false],
    ['Sal 1.000 g', 'Sal', 1, 'g', false],
    ['un kilo de carne', 'Carne', 1, 'g', false],
    ['kilo de carne', 'Carne', 1, 'g', false],
    ['Leche x6 L', 'Leche', 6, 'ml', false],
    ['Aceite 900 ml', 'Aceite', 0.9, 'ml', false],
    ['Aceite 1 litro', 'Aceite', 1, 'ml', false],
    ['Leche 6 und x 1,1 L', 'Leche', 6.6, 'ml', false],
    ['Arroz 2 bolsas de 1 kg', 'Arroz', 2, 'g', false],
    ['Huevos 30', 'Huevos', 30, 'unidad', false],
    ['Huevos 1 cubeta', 'Huevos', 30, 'unidad', false],
    ['Limones 1 docena', 'Limones', 12, 'unidad', false],
    ['Papel higiénico 12 rollos', 'Papel higiénico', 12, 'unidad', false],
    ['Cebolla larga 1 atado', 'Cebolla larga', 1, 'unidad', false],
    ['Pasta 4 x 250 g', 'Pasta', 1, 'g', false],
    ['Leche 1100 ml x 6 unidades', 'Leche', 6.6, 'ml', false],
    ['Aceite 900 ml x 2 und', 'Aceite', 1.8, 'ml', false],
    ['Atún 160 g x 3 unidades', 'Atún', 0.48, 'g', false],
    ['Arroz 1 kg x 5 unidades', 'Arroz', 5, 'g', false],
    ['Gaseosa 1,5 litros x 2', 'Gaseosa', 3, 'ml', false],
    ['Papel 2 paquetes x 12 rollos', 'Papel', 24, 'unidad', false],
    ['Huevos 30 und x 2', 'Huevos', 60, 'unidad', false],
    ['Arroz 500 kg', 'Arroz', 500, 'g', true],
    ['Huevos 300', 'Huevos', 300, 'unidad', true],
    ['Huevos 1 cubeta x 30', 'Huevos', 30, 'unidad', false],
    ['1 docena x 12 huevos', 'Huevos', 12, 'unidad', false],
    ['Queso 1 libra y media', 'Queso', 0.75, 'g', false],
    ['2 kilos y medio de papa', 'Papa', 2.5, 'g', false],
    ['Papa kilo y medio', 'Papa', 1.5, 'g', false],
    ['Carne 1.250 kg', 'Carne', 1.25, 'g', false],
    ['Queso 1,500 g', 'Queso', 0.002, 'g', true],
    ['2 Límpido', 'Límpido', 2, 'ml', true],
    ['Plátano verde 6', 'Plátano verde', 6, 'unidad', false],
    ['Leche 1 paca', 'Leche', 1, 'unidad', true],
    ['Arroz 5', 'Arroz', 5, 'g', true],
    ['Arroz (5)', 'Arroz', 5, 'g', true],
    ['Sal', 'Sal', 1, 'g', true],
    ['Aguacate', 'Aguacate', 1, 'unidad', true],
    ['ARROZ DIANA 5 KG', 'Arroz diana', 5, 'g', false],
  ])('%s', (linea, nombre, cantidad, unidad, aviso) => {
    expect(r(linea)).toEqual({ nombre, cantidad, unidad, aviso })
  })

  it('limpia viñetas, numeración, casillas, emojis y la hora de WhatsApp', () => {
    expect(r('- Tomate 1 kg')?.nombre).toBe('Tomate')
    expect(r('• Tomate 1 kg')?.nombre).toBe('Tomate')
    expect(r('1. Papa 2 kilos')).toEqual({ nombre: 'Papa', cantidad: 2, unidad: 'g', aviso: false })
    expect(r('2) Cebolla 1 kg')?.nombre).toBe('Cebolla')
    expect(r('☐ Café 500 g')?.nombre).toBe('Café')
    expect(r('🥚 Huevos 30')?.nombre).toBe('Huevos')
    expect(r('[27/9/26, 10:15 a. m.] Robinson: Arroz 5 kg')?.nombre).toBe('Arroz')
    expect(r('27/9/26 10:15 - Robinson: Arroz 5 kg')?.nombre).toBe('Arroz')
    expect(r('*Arroz* 5 kg')?.nombre).toBe('Arroz')
    expect(r('Arroz: 5 kg')?.nombre).toBe('Arroz')
    expect(r('Arroz - 5 kg')?.nombre).toBe('Arroz')
  })

  it('sin nombre no hay producto', () => {
    expect(leerRenglon('5 kg')).toBeNull()
    expect(leerRenglon('   ')).toBeNull()
  })
})

describe('unidadPorNombre', () => {
  it.each([
    ['Leche entera', 'ml'], ['Jabón líquido', 'ml'], ['Jabón en barra', 'unidad'], ['Aguacate', 'unidad'],
    ['Agua', 'ml'], ['Panela', 'g'], ['Pan tajado', 'unidad'], ['Lechuga', 'unidad'], ['Arroz', 'g'],
  ])('%s → %s', (n, u) => expect(unidadPorNombre(n)).toBe(u))
})

describe('leerLista', () => {
  it('lista de WhatsApp con títulos de pasillo', () => {
    const texto = `[27/9/26, 10:15 a. m.] Robinson: Lista de mercado
*Granos*
- Arroz 5 kg
- Fríjol 1 lb

LÁCTEOS:
Leche 6 L
Huevos 30

🧼 Aseo:
Papel higiénico 12 rollos`
    const xs = leerLista(texto)
    expect(xs.map((x) => [x.pasillo, x.nombre, x.cantidad, x.unidad_base])).toEqual([
      ['Granos', 'Arroz', 5, 'g'],
      ['Granos', 'Fríjol', 0.5, 'g'],
      ['Lácteos', 'Leche', 6, 'ml'],
      ['Lácteos', 'Huevos', 30, 'unidad'],
      ['Aseo', 'Papel higiénico', 12, 'unidad'],
    ])
  })

  it('mayúsculas como título solo si el resto no va en mayúsculas', () => {
    expect(leerLista('CARNES\nPollo 2 kg\nCarne molida 1 kg')[0].pasillo).toBe('Carnes')
    const todo = leerLista('ARROZ 5 KG\nSAL\nAZUCAR 2 KG')
    expect(todo.map((x) => x.nombre)).toEqual(['Arroz', 'Sal', 'Azucar'])
  })

  it('todo en un renglón separado por comas (sin romper "1,5")', () => {
    expect(leerLista('arroz 5 kg, papa 1,5 kg, huevos 30; sal').map((x) => [x.nombre, x.cantidad])).toEqual([
      ['Arroz', 5], ['Papa', 1.5], ['Huevos', 30], ['Sal', 1],
    ])
  })

  it('copiado de Excel o Google Sheets con encabezado', () => {
    const xs = leerLista('Producto\tCantidad\tUnidad\tPasillo\nArroz\t5\tkg\tGranos\nLeche\t6\tL\tLácteos\nHuevos\t30\tund\tLácteos')
    expect(xs.map((x) => [x.nombre, x.cantidad, x.unidad_base, x.pasillo])).toEqual([
      ['Arroz', 5, 'g', 'Granos'], ['Leche', 6, 'ml', 'Lácteos'], ['Huevos', 30, 'unidad', 'Lácteos'],
    ])
  })

  it('copiado de Excel sin encabezado', () => {
    const xs = leerLista('Arroz\t5\tkg\nAceite\t1\tL\nPapa\t2\tkg')
    expect(xs.map((x) => [x.nombre, x.cantidad, x.unidad_base, x.pasillo])).toEqual([
      ['Arroz', 5, 'g', ''], ['Aceite', 1, 'ml', ''], ['Papa', 2, 'g', ''],
    ])
  })

  it('repetidos se suman y se avisa', () => {
    const xs = leerLista('Arroz 2 kg\nPapa 1 kg\narroz 3 kg')
    expect(xs).toHaveLength(2)
    expect(xs[0]).toMatchObject({ nombre: 'Arroz', cantidad: 5 })
    expect(xs[0].aviso).toMatch(/repetido/)
  })
})

describe('emparejar', () => {
  it('reconoce el producto aunque cambien tildes, mayúsculas o el plural', () => {
    expect(claveProducto('Limones')).toBe(claveProducto('limón'))
    expect(claveProducto('Huevos')).toBe(claveProducto('huevo'))
    expect(claveProducto('Tomates')).toBe(claveProducto('Tomate'))
    const mios = [{ nombre: 'Fríjol', activo: true }, { nombre: 'Leche entera', activo: true }]
    const xs = emparejar(leerLista('frijoles 1 kg\nLeche 6 L'), mios)
    expect(xs[0].existente?.nombre).toBe('Fríjol')
    expect(xs[1].existente).toBeNull()
  })
})

describe('más casos de listas reales', () => {
  it('una sola línea con comas separa aunque el siguiente empiece por número', () => {
    expect(leerLista('arroz, fríjol, 2 kg papa').map((x) => [x.nombre, x.cantidad])).toEqual([['Arroz', 1], ['Fríjol', 1], ['Papa', 2]])
  })

  it('repetido en otra unidad no se pierde: queda el aviso con lo que decía', () => {
    const xs = leerLista('Leche 2 L\nLeche 6 und')
    expect(xs).toHaveLength(1)
    expect(xs[0].aviso).toContain('Leche 6 und')
    expect(xs[0].aviso).not.toContain('se sumó')
  })
})
