import { describe, expect, it } from 'vitest'
import { lineasVisibles, lineaVisible } from './lineas.ts'
import { nuevoDetalle } from './escritura.ts'

const vivos = new Set(['arroz'])
const existe = (id: string) => vivos.has(id)
const linea = (extra: Partial<ReturnType<typeof nuevoDetalle>>) => nuevoDetalle('c1', { producto_id: 'sal', ...extra })

describe('qué línea de compra se muestra cuando su producto se eliminó', () => {
  it('un producto vivo, o una línea libre, se muestra tal cual', () => {
    const a = linea({ producto_id: 'arroz' })
    const libre = linea({ producto_id: '', nombre_libre: 'Chicles' })
    expect(lineaVisible(a, existe)).toBe(a)
    expect(lineaVisible(libre, existe)).toBe(libre)
  })

  it('en el carrito: ya se compró, se muestra como texto (con su nombre si se conoce) y conserva el precio', () => {
    const sin = lineaVisible(linea({ estado: 'en_carrito', cantidad: 1, precio_unitario: 4600, subtotal: 4600 }), existe)
    expect(sin).toMatchObject({ producto_id: '', nombre_libre: 'Producto eliminado', subtotal: 4600 })
    expect(lineaVisible(linea({ estado: 'en_carrito', nombre_libre: 'Sal' }), existe)).toMatchObject({ producto_id: '', nombre_libre: 'Sal' })
  })

  it('pendiente o «no lo encontré»: no hay nada que comprar, no aparece', () => {
    expect(lineaVisible(linea({ estado: 'pendiente' }), existe)).toBeNull()
    expect(lineaVisible(linea({ estado: 'no_encontrado' }), existe)).toBeNull()
  })

  it('lo que la persona quitó (borrado) nunca reaparece, esté o no su producto', () => {
    expect(lineaVisible(linea({ estado: 'en_carrito', borrado: true }), existe)).toBeNull()
    expect(lineaVisible(linea({ producto_id: 'arroz', borrado: true }), existe)).toBeNull()
  })

  it('el mismo conjunto de líneas da el mismo resultado en cualquier orden (no depende de la historia de cada celular)', () => {
    const lineas = [linea({ detalle_id: 'a', estado: 'en_carrito' }), linea({ detalle_id: 'b', estado: 'pendiente' }), linea({ detalle_id: 'c', producto_id: 'arroz' })]
    const una = lineasVisibles(lineas, existe).map((d) => d.detalle_id)
    const otra = lineasVisibles([...lineas].reverse(), existe).map((d) => d.detalle_id).reverse()
    expect(una).toEqual(['a', 'c'])
    expect(otra).toEqual(una)
  })
})
