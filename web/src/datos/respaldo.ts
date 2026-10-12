import { COLUMNAS_OPCIONALES, TABLAS, type NombreTabla } from '@shared/esquema.ts'
import { validarFila } from '@shared/seguridad.ts'
import type { BaseLocal } from './db.ts'

/** Tablas que entran en el archivo de respaldo, y a qué pestaña del esquema corresponde cada una. */
export const TABLAS_RESPALDO = ['config', 'categorias', 'productos', 'presentaciones', 'preciosActuales', 'compras', 'detalle', 'resumen', 'historial'] as const
export type TablaRespaldo = typeof TABLAS_RESPALDO[number]

export const ESQUEMA_RESPALDO: Record<TablaRespaldo, NombreTabla> = {
  config: 'Config',
  categorias: 'Categorias',
  productos: 'Productos',
  presentaciones: 'Presentaciones',
  preciosActuales: 'Precios_actuales',
  compras: 'Compras',
  detalle: 'Compras_detalle',
  resumen: 'Compras_resumen',
  historial: 'Precios',
}

/**
 * Columnas que un respaldo puede no traer: las que se agregaron al esquema después (las mismas que el servidor acepta
 * ausentes) y las que una fila creada en este celular nunca llevó (por ejemplo `borrado`). Salen del esquema compartido, no
 * de una lista aparte, para que una columna nueva no vuelva inservibles los respaldos.
 */
export function columnasOpcionales(tabla: TablaRespaldo): readonly string[] {
  return [...(COLUMNAS_OPCIONALES[ESQUEMA_RESPALDO[tabla]] ?? []), ...(tabla === 'detalle' ? ['precio_confirmado'] : [])]
}

const esRegistro = (valor: unknown): valor is Record<string, unknown> => typeof valor === 'object' && valor !== null && !Array.isArray(valor)

/** El contenido del archivo de respaldo: todas las tablas de la cuenta tal como están en este celular. */
export async function armarRespaldo(base: BaseLocal): Promise<{ app: 'precios-mercado'; fecha: string; datos: Record<string, unknown[]> }> {
  const datos: Record<string, unknown[]> = {}
  for (const t of TABLAS_RESPALDO) datos[t] = await base.table(t).toArray()
  return { app: 'precios-mercado', fecha: new Date().toISOString(), datos }
}

/**
 * Comprueba un respaldo leído del archivo y devuelve las filas por tabla. Si una fila no sirve lanza un error que dice cuál:
 * no se importa nada a medias.
 */
export function leerRespaldo(copia: unknown, base: BaseLocal): { filas: Map<TablaRespaldo, Record<string, unknown>[]>; total: number } {
  if (!esRegistro(copia) || copia.app !== 'precios-mercado' || !esRegistro(copia.datos)) {
    throw new Error('El archivo no parece un respaldo de Precios de Mercado.')
  }
  const datos = copia.datos
  const tablas = TABLAS_RESPALDO.filter((nombre) => nombre in datos)
  if (!tablas.length) throw new Error('El respaldo no contiene datos que esta versión pueda importar.')

  const filas = new Map<TablaRespaldo, Record<string, unknown>[]>()
  let total = 0
  for (const nombre of tablas) {
    const valor = datos[nombre]
    if (!Array.isArray(valor)) throw new Error(`La tabla “${nombre}” no tiene un formato válido.`)
    const clave = base.table(nombre).schema.primKey.name
    const opcionales = columnasOpcionales(nombre)
    const lista = valor.map((fila) => {
      if (!esRegistro(fila)) throw new Error(`Fila inválida en “${nombre}”: debe ser un objeto.`)
      const valida = validarFila(ESQUEMA_RESPALDO[nombre], fila, false)
      const faltante = Object.keys(TABLAS[ESQUEMA_RESPALDO[nombre]].cols)
        .find((col) => col !== '_srv' && !opcionales.includes(col) && !(col in fila))
      if (fila[clave] == null || !['string', 'number'].includes(typeof fila[clave]) || faltante || !valida.ok) {
        const detalle = faltante ? `falta la columna ${faltante}` : valida.ok ? 'clave inválida' : valida.error
        throw new Error(`Fila inválida en “${nombre}”: ${detalle}.`)
      }
      return fila
    })
    filas.set(nombre, lista)
    total += lista.length
  }
  if (total === 0) throw new Error('El respaldo está vacío.')
  return { filas, total }
}
