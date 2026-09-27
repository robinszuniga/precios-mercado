import { describe, expect, it } from 'vitest'
import { TABLAS } from '../../shared/src/esquema.ts'
import { HojaRepo } from '../src/gas/hojaRepo.ts'

/** Hoja falsa con los límites de Google: escribir fuera de sus filas o columnas lanza error, como en Apps Script. */
class HojaFalsa {
  celdas: unknown[][] = []
  formatos = new Map<string, string>()
  maxFilas: number
  maxCols: number
  constructor(maxFilas: number, maxCols: number) {
    this.maxFilas = maxFilas
    this.maxCols = maxCols
  }
  getMaxRows() { return this.maxFilas }
  getMaxColumns() { return this.maxCols }
  insertRowsAfter(_despues: number, n: number) { this.maxFilas += n }
  insertColumnsAfter(_despues: number, n: number) { this.maxCols += n }
  deleteRows(desde: number, n: number) { this.celdas.splice(desde - 1, n); this.maxFilas -= n }
  getDataRange() {
    const alto = this.celdas.length
    const ancho = Math.max(0, ...this.celdas.map((r) => r.length))
    return { getValues: () => this.celdas.map((r) => Array.from({ length: ancho }, (_, i) => r[i] ?? '')).slice(0, alto) }
  }
  getRange(fila: number, col: number, filas = 1, cols = 1) {
    if (fila + filas - 1 > this.maxFilas || col + cols - 1 > this.maxCols) {
      throw new Error('The coordinates of the range are outside the dimensions of the sheet.')
    }
    const rango = {
      setValues: (vs: unknown[][]) => {
        vs.forEach((v, i) => {
          const r = (this.celdas[fila - 1 + i] ??= [])
          v.forEach((x, j) => { r[col - 1 + j] = x })
        })
        for (let i = 0; i < fila - 1; i++) this.celdas[i] ??= []
        return rango
      },
      setNumberFormat: (f: string) => { for (let j = 0; j < cols; j++) this.formatos.set(`${fila}:${col + j}`, f); return rango },
      setFontWeight: () => rango,
    }
    return rango
  }
}

function libro(hojas: Record<string, HojaFalsa>) {
  return { getSheetByName: (n: string) => hojas[n] ?? null } as unknown as GoogleAppsScript.Spreadsheet.Spreadsheet
}

const producto = (id: string) => ({ producto_id: id, nombre: `P ${id}`, categoria_id: '', unidad_base: 'g', recurrente: false, cantidad_habitual: 1, notas: '', activo: true, updated_at: '2026-09-27T10:00:00.000-05:00', _srv: '' })

describe('HojaRepo', () => {
  it('agrega sola una columna nueva del esquema y no pierde el dato', () => {
    const cols = Object.keys(TABLAS.Compras_detalle.cols).filter((c) => c !== 'precio_confirmado')
    const hoja = new HojaFalsa(1000, cols.length)
    hoja.celdas = [cols]
    const repo = new HojaRepo(libro({ Compras_detalle: hoja }))
    repo.guardar('Compras_detalle', [{ detalle_id: 'd1', compra_id: 'c1', precio_confirmado: true, updated_at: '2026-09-27T10:00:00.000-05:00' }])
    repo.refrescar()
    expect(hoja.celdas[0]).toContain('precio_confirmado')
    expect(repo.leer('Compras_detalle')[0]).toMatchObject({ detalle_id: 'd1', precio_confirmado: true })
  })

  it('cuando la hoja se llena agrega filas en vez de fallar', () => {
    const cols = Object.keys(TABLAS.Productos.cols)
    const hoja = new HojaFalsa(3, cols.length) // encabezado + 2 filas libres
    hoja.celdas = [cols]
    const repo = new HojaRepo(libro({ Productos: hoja }))
    repo.guardar('Productos', ['a', 'b', 'c', 'd', 'e'].map(producto))
    repo.agregar('Productos', [producto('f')])
    repo.refrescar()
    expect(repo.leer('Productos').map((p) => p.producto_id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(hoja.maxFilas).toBeGreaterThanOrEqual(7)
    // Las filas nuevas quedan con formato de texto en las columnas de texto (ids que parecen números no se deforman).
    expect(hoja.formatos.get(`4:${cols.indexOf('producto_id') + 1}`)).toBe('@')
  })
})
