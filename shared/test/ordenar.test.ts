import { describe, expect, it } from 'vitest'
import { parseContenido } from '../src/contenido.ts'
import type { Candidato } from '../src/vtex/parse.ts'
import { esDeMarca, ordenarCandidatos } from '../src/vtex/ordenar.ts'

let n = 0
function cand(nombre: string, precio: number | null, extra: Partial<Candidato> = {}): Candidato {
  const c = parseContenido(nombre)
  return {
    tienda: 'OLIMPICA', productId: `p${++n}`, skuId: `s${n}`, ean: `77${n}`, nombre, marca: '', url: '', sellerId: '1',
    precio, precioLista: precio, disponible: true, oferta: false,
    contenido: c ? { valor: c.valor, unidad: c.unidad, fuente: 'nombre', confianza: c.confianza } : null,
    ...extra,
  }
}

describe('ordenarCandidatos', () => {
  it('arroz: el arroz simple es seguro; integral y arroz con pollo quedan como alternativas', () => {
    const xs = ordenarCandidatos('Arroz', 'g', [
      cand('Arroz con pollo listo 250 g', 8900),
      cand('Arroz integral Diana 1000 g', 7200, { marca: 'Diana' }),
      cand('Arroz Diana 1000 g', 5200, { marca: 'Diana' }),
      cand('Arroz Roa 500 g', 2900, { marca: 'Roa' }),
    ])
    expect(xs[0].nombre).toBe('Arroz Diana 1000 g')
    expect(xs[0].seguro).toBe(true)
    expect(xs[0].precioUnidad).toBe(5200)
    expect(xs.filter((x) => x.seguro)).toHaveLength(1)
    expect(xs.find((x) => x.nombre.startsWith('Arroz con pollo'))?.seguro).toBe(false)
    expect(xs.find((x) => x.nombre.includes('integral'))?.seguro).toBe(false)
  })

  it('leche (ml): descarta la leche en polvo (g) y el arequipe', () => {
    const xs = ordenarCandidatos('Leche entera', 'ml', [
      cand('Leche en polvo entera 380 g', 18000),
      cand('Arequipe 250 g', 6000),
      cand('Leche entera Alquería bolsa 1100 ml', 4300, { marca: 'Alquería' }),
    ])
    expect(xs.map((x) => x.nombre)).toEqual(['Leche entera Alquería bolsa 1100 ml'])
    expect(xs[0].seguro).toBe(true)
  })

  it('variantes inofensivas no quitan lo seguro; las que cambian el producto sí', () => {
    expect(ordenarCandidatos('Leche', 'ml', [cand('Leche entera larga vida 1000 ml', 4000)])[0].seguro).toBe(true)
    expect(ordenarCandidatos('Huevos', 'unidad', [cand('Huevo rojo AA x 30 und', 16000)])[0].seguro).toBe(true)
    expect(ordenarCandidatos('Leche', 'ml', [cand('Leche deslactosada 1000 ml', 4500)])[0].seguro).toBe(false)
  })

  it('un producto que solo empieza igual nunca es seguro (Papa ≠ Papaya, Maíz ≠ Maizena, Pan ≠ Pandebono)', () => {
    const papa = ordenarCandidatos('Papa', 'g', [cand('Papaya 1 kg', 4000), cand('Papa pastusa 1 kg', 3000)])
    expect(papa.find((x) => x.nombre === 'Papaya 1 kg')?.seguro).toBe(false)
    expect(papa[0].nombre).toBe('Papa pastusa 1 kg')
    expect(ordenarCandidatos('Maíz', 'g', [cand('Maizena 380 g', 5000)])[0]?.seguro ?? false).toBe(false)
    expect(ordenarCandidatos('Pan', 'unidad', [cand('Pandebono x 6 und', 6000)])[0]?.seguro ?? false).toBe(false)
    expect(ordenarCandidatos('Papa', 'g', [cand('Papa criolla 1 kg', 3000), cand('Papa 2 kg', 5000)]).find((x) => x.seguro)?.nombre).toBe('Papa 2 kg')
  })

  it('sin precio, agotado o sin tamaño no es seguro', () => {
    expect(ordenarCandidatos('Arroz', 'g', [cand('Arroz Diana 1000 g', null)])[0].seguro).toBe(false)
    expect(ordenarCandidatos('Arroz', 'g', [cand('Arroz Diana 1000 g', 5000, { disponible: false })])[0].seguro).toBe(false)
    expect(ordenarCandidatos('Arroz', 'g', [cand('Arroz Diana', 5000)])).toHaveLength(0)
  })

  it('si falta una palabra del producto no es seguro', () => {
    const xs = ordenarCandidatos('Queso costeño', 'g', [cand('Queso mozzarella 400 g', 12000)])
    expect(xs[0].seguro).toBe(false)
  })

  it('reconoce plurales y tildes', () => {
    const xs = ordenarCandidatos('Lentejas', 'g', [cand('Lenteja La Muñeca 500 g', 3900, { marca: 'La Muñeca' })])
    expect(xs[0].seguro).toBe(true)
  })

  it('máximo 4 opciones y sin repetir SKU', () => {
    const base = cand('Arroz Diana 1000 g', 5200)
    const xs = ordenarCandidatos('Arroz', 'g', [base, base, ...[1, 2, 3, 4, 5].map((i) => cand(`Arroz marca${i} 500 g`, 3000 + i))])
    expect(xs).toHaveLength(4)
    expect(new Set(xs.map((x) => x.skuId)).size).toBe(4)
  })

  it('con marca preferida, solo esa marca es segura y va primero', () => {
    const cands = [
      cand('Arroz Diana 1000 g', 5200, { marca: 'Diana' }),
      cand('Arroz Roa 1000 g', 4800, { marca: 'Roa' }),
      cand('Arroz Florhuila 500 g', 2600, { marca: 'Florhuila' }),
    ]
    const roa = ordenarCandidatos('Arroz', 'g', cands, 4, 'Roa')
    expect(roa[0].nombre).toBe('Arroz Roa 1000 g')
    expect(roa.filter((x) => x.seguro).map((x) => x.nombre)).toEqual(['Arroz Roa 1000 g'])
    // Si la tienda no tiene tu marca, ninguna otra se vincula sola.
    expect(ordenarCandidatos('Arroz', 'g', cands, 4, 'Supremo').some((x) => x.seguro)).toBe(false)
  })

  it('la marca cuenta aunque venga solo en el nombre, o escrita en el nombre del producto', () => {
    expect(esDeMarca({ nombre: 'Leche entera Alquería 1100 ml', marca: '' }, 'alqueria')).toBe(true)
    expect(esDeMarca({ nombre: 'Leche entera 1100 ml', marca: 'Colanta' }, 'Alquería')).toBe(false)
    expect(esDeMarca({ nombre: 'Lo que sea', marca: '' }, '')).toBe(true)
    const xs = ordenarCandidatos('Arroz Diana', 'g', [cand('Arroz Diana 1000 g', 5200, { marca: 'Diana' })], 4, 'Diana')
    expect(xs[0].seguro).toBe(true)
  })

  it('la marca se compara por palabras seguidas y solo con la marca de la tienda si la trae', () => {
    expect(esDeMarca({ nombre: 'Arroz del mejor campo 1 kg', marca: '' }, 'Del Campo')).toBe(false)
    expect(esDeMarca({ nombre: 'Arroz Del Campo 1 kg', marca: '' }, 'Del Campo')).toBe(true)
    expect(esDeMarca({ nombre: 'Sal fina 500 g', marca: 'Refisal' }, 'Fina')).toBe(false)
    expect(esDeMarca({ nombre: 'Sal 500 g', marca: 'La Fina' }, 'Fina')).toBe(true)
    expect(() => esDeMarca({ nombre: 'x', marca: undefined }, 'Diana')).not.toThrow()
  })

  it('si el producto se llama igual que la marca igual encuentra opciones', () => {
    const xs = ordenarCandidatos('Diana', 'g', [cand('Arroz Diana 500 g', 2600, { marca: 'Diana' })], 4, 'Diana')
    expect(xs).toHaveLength(1)
  })
})
