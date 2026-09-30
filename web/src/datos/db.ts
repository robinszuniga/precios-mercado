import Dexie, { type EntityTable } from 'dexie'
import type {
  Categoria, Compra, Detalle, FilaConfig, NombreTabla, PrecioActual, PrecioHistorico, Presentacion, Producto, ResumenTienda,
} from '@shared/esquema.ts'
import type { CambioPrecio } from '@shared/novedades.ts'

export interface EntradaOutbox {
  seq?: number
  tipo: 'upsert' | 'cerrarCompra'
  payload: Record<string, unknown>
  intentos: number
  /** ms desde epoch: no reintentar antes. */
  proximo: number
  error?: string
  creado: number
}

export interface Rechazo {
  id?: number
  tabla: string
  filaId: string
  mensaje: string
  fecha: number
}

export interface Meta {
  clave: string
  valor: unknown
}

/** Copia local de todo: la app funciona sin señal y el Sheet es el respaldo. */
export class BaseLocal extends Dexie {
  config!: EntityTable<FilaConfig, 'clave'>
  categorias!: EntityTable<Categoria, 'categoria_id'>
  productos!: EntityTable<Producto, 'producto_id'>
  presentaciones!: EntityTable<Presentacion, 'presentacion_id'>
  preciosActuales!: EntityTable<PrecioActual, 'clave'>
  compras!: EntityTable<Compra, 'compra_id'>
  detalle!: EntityTable<Detalle, 'detalle_id'>
  resumen!: EntityTable<ResumenTienda, 'clave'>
  historial!: EntityTable<PrecioHistorico, 'precio_id'>
  outbox!: EntityTable<EntradaOutbox, 'seq'>
  rechazados!: EntityTable<Rechazo, 'id'>
  meta!: EntityTable<Meta, 'clave'>
  /** Cambios de precio que llegaron del servidor: para "Novedades". Solo en este celular. */
  cambios!: EntityTable<CambioPrecio, 'id'>

  constructor(nombre = 'precios-mercado') {
    super(nombre)
    this.version(1).stores({
      config: 'clave',
      categorias: 'categoria_id',
      productos: 'producto_id',
      presentaciones: 'presentacion_id, producto_id',
      preciosActuales: 'clave, presentacion_id',
      compras: 'compra_id, estado',
      detalle: 'detalle_id, compra_id',
      resumen: 'clave, compra_id',
      historial: 'precio_id, presentacion_id',
      outbox: '++seq',
      rechazados: '++id',
      meta: 'clave',
    })
    this.version(2).stores({ cambios: '++id, fecha' })
  }
}

export const db = new BaseLocal()

/** Pestaña del Sheet → tabla local. */
export const TABLA_LOCAL: Partial<Record<NombreTabla, keyof BaseLocal & string>> = {
  Config: 'config',
  Categorias: 'categorias',
  Productos: 'productos',
  Presentaciones: 'presentaciones',
  Precios_actuales: 'preciosActuales',
  Compras: 'compras',
  Compras_detalle: 'detalle',
  Compras_resumen: 'resumen',
}

export async function leerMeta<T>(clave: string, porDefecto: T): Promise<T> {
  const m = await db.meta.get(clave)
  return m ? (m.valor as T) : porDefecto
}

export async function guardarMeta(clave: string, valor: unknown) {
  await db.meta.put({ clave, valor })
}
