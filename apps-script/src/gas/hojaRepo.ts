import { NOMBRES_TABLAS, TABLAS, type NombreTabla, type TipoCol } from '../../../shared/src/esquema.ts'
import { isoBogota } from '../../../shared/src/fechas.ts'
import type { Fila } from '../../../shared/src/seguridad.ts'
import type { Repo } from '../puertos.ts'

type Hoja = GoogleAppsScript.Spreadsheet.Sheet

interface Cargada {
  hoja: Hoja
  encabezados: string[]
  filas: Fila[]
  /** id → índice en filas. */
  indice: Map<string, number>
}

function tipoDe(tabla: NombreTabla, col: string): TipoCol | undefined {
  return (TABLAS[tabla].cols as Record<string, TipoCol>)[col]
}

function deCelda(v: unknown, tipo: TipoCol | undefined): unknown {
  if (tipo === 'b') return v === true || v === 'TRUE' || v === 'true'
  if (tipo === 'n') {
    if (v === '' || v == null) return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (v instanceof Date) return isoBogota(v.getTime())
  return v == null ? '' : String(v)
}

function aCelda(v: unknown, tipo: TipoCol | undefined): unknown {
  if (v == null) return tipo === 'b' ? false : ''
  if (tipo === 'b') return v === true
  if (tipo === 'n') return typeof v === 'number' && Number.isFinite(v) ? v : ''
  return typeof v === 'string' ? v : String(v)
}

/** El único archivo que toca SpreadsheetApp. Lee cada pestaña una vez por ejecución y escribe por lotes. */
export class HojaRepo implements Repo {
  private cargadas = new Map<NombreTabla, Cargada>()
  private ss: GoogleAppsScript.Spreadsheet.Spreadsheet
  constructor(ss: GoogleAppsScript.Spreadsheet.Spreadsheet) {
    this.ss = ss
  }

  private cargar(tabla: NombreTabla): Cargada {
    const ya = this.cargadas.get(tabla)
    if (ya) return ya
    const hoja = this.ss.getSheetByName(tabla)
    if (!hoja) throw new Error(`Falta la pestaña ${tabla}: ejecuta inicializarHoja`)
    const valores = hoja.getDataRange().getValues()
    const encabezados = (valores[0] ?? []).map((x) => String(x).trim())
    const idCol = TABLAS[tabla].id
    const filas: Fila[] = []
    const indice = new Map<string, number>()
    // Las filas en blanco se conservan (sin indexar) para que el índice coincida siempre con el número de fila.
    for (const r of valores.slice(1)) {
      const f: Fila = {}
      encabezados.forEach((h, i) => { if (h) f[h] = deCelda(r[i], tipoDe(tabla, h)) })
      const id = String(f[idCol] ?? '')
      if (id) indice.set(id, filas.length)
      filas.push(f)
    }
    const c = { hoja, encabezados, filas, indice }
    this.cargadas.set(tabla, c)
    return c
  }

  private aFilaHoja(tabla: NombreTabla, c: Cargada, f: Fila): unknown[] {
    return c.encabezados.map((h) => aCelda(f[h], tipoDe(tabla, h)))
  }

  leer(tabla: NombreTabla): Fila[] {
    const idCol = TABLAS[tabla].id
    return this.cargar(tabla).filas.filter((f) => f[idCol] !== '' && f[idCol] != null).map((f) => ({ ...f }))
  }

  guardar(tabla: NombreTabla, filas: readonly Fila[]): void {
    if (!filas.length) return
    const c = this.cargar(tabla)
    const idCol = TABLAS[tabla].id
    const cambiadas = new Set<number>()
    const nuevas: Fila[] = []
    for (const f of filas) {
      const id = String(f[idCol])
      const i = c.indice.get(id)
      if (i != null) {
        c.filas[i] = { ...c.filas[i], ...f }
        cambiadas.add(i)
      } else {
        c.indice.set(id, c.filas.length)
        c.filas.push({ ...f })
        nuevas.push(f)
      }
    }
    const ancho = c.encabezados.length
    if (cambiadas.size > 20) {
      // Muchas filas: reescribir el bloque completo sale más barato que una llamada por fila.
      const existentes = c.filas.length - nuevas.length
      c.hoja.getRange(2, 1, existentes, ancho).setValues(c.filas.slice(0, existentes).map((f) => this.aFilaHoja(tabla, c, f)))
    } else {
      for (const i of cambiadas) c.hoja.getRange(i + 2, 1, 1, ancho).setValues([this.aFilaHoja(tabla, c, c.filas[i])])
    }
    if (nuevas.length) {
      const desde = c.filas.length - nuevas.length + 2
      c.hoja.getRange(desde, 1, nuevas.length, ancho).setValues(nuevas.map((f) => this.aFilaHoja(tabla, c, f)))
    }
  }

  agregar(tabla: NombreTabla, filas: readonly Fila[]): void {
    if (!filas.length) return
    const c = this.cargar(tabla)
    const desde = c.filas.length + 2
    c.hoja.getRange(desde, 1, filas.length, c.encabezados.length).setValues(filas.map((f) => this.aFilaHoja(tabla, c, f)))
    const idCol = TABLAS[tabla].id
    for (const f of filas) {
      c.indice.set(String(f[idCol]), c.filas.length)
      c.filas.push({ ...f })
    }
  }

  recortar(tabla: NombreTabla, max: number): void {
    const c = this.cargar(tabla)
    const sobran = c.filas.length - max
    if (sobran <= 0) return
    c.hoja.deleteRows(2, sobran)
    this.cargadas.delete(tabla)
  }

  pestanasFaltantes(): string[] {
    return NOMBRES_TABLAS.filter((t) => !this.ss.getSheetByName(t))
  }
}

/** Crea las pestañas que falten, agrega columnas nuevas al final y pone las de texto con formato @. */
export function asegurarEsquema(ss: GoogleAppsScript.Spreadsheet.Spreadsheet): string[] {
  const hechos: string[] = []
  for (const tabla of NOMBRES_TABLAS) {
    let hoja = ss.getSheetByName(tabla)
    if (!hoja) {
      hoja = ss.insertSheet(tabla)
      hechos.push(`pestaña ${tabla} creada`)
    }
    const cols = Object.keys(TABLAS[tabla].cols)
    const ultima = hoja.getLastColumn()
    const actuales = ultima > 0 ? hoja.getRange(1, 1, 1, ultima).getValues()[0].map((x) => String(x).trim()) : []
    const faltan = cols.filter((c) => !actuales.includes(c))
    if (faltan.length) {
      hoja.getRange(1, actuales.length + 1, 1, faltan.length).setValues([faltan])
      hechos.push(`${tabla}: columnas ${faltan.join(', ')}`)
    }
    const encabezados = [...actuales, ...faltan]
    const filasMax = Math.max(hoja.getMaxRows(), 2)
    encabezados.forEach((h, i) => {
      if (tipoDe(tabla, h) === 't') hoja!.getRange(1, i + 1, filasMax, 1).setNumberFormat('@')
    })
    hoja.getRange(1, 1, 1, encabezados.length).setFontWeight('bold')
    hoja.setFrozenRows(1)
  }
  return hechos
}
