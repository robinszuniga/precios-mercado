import type { Tienda } from './tiendas.ts'
import type { UnidadBase } from './unidades.ts'

export const VERSION_API = 1
export const VERSION_ESQUEMA = 1

/** t = texto (la hoja la guarda con formato @), n = número, b = booleano. */
export type TipoCol = 't' | 'n' | 'b'

export interface DefTabla {
  /** Columna que identifica la fila. */
  id: string
  cols: Record<string, TipoCol>
  /** La PWA puede escribirla con `upsert` (gana la versión con updated_at mayor). */
  cliente: boolean
  /** Viaja en `pull`. */
  sincroniza: boolean
}

export const TABLAS = {
  Config: {
    id: 'clave',
    cols: { clave: 't', valor: 't', updated_at: 't', _srv: 't' },
    cliente: true,
    sincroniza: true,
  },
  Categorias: {
    id: 'categoria_id',
    cols: { categoria_id: 't', nombre: 't', orden: 'n', updated_at: 't', _srv: 't', borrado: 'b' },
    cliente: true,
    sincroniza: true,
  },
  Productos: {
    id: 'producto_id',
    cols: {
      producto_id: 't', nombre: 't', categoria_id: 't', unidad_base: 't', recurrente: 'b',
      cantidad_habitual: 'n', notas: 't', activo: 'b', updated_at: 't', _srv: 't', marca: 't', borrado: 'b',
    },
    cliente: true,
    sincroniza: true,
  },
  Presentaciones: {
    id: 'presentacion_id',
    cols: {
      presentacion_id: 't', producto_id: 't', tienda: 't', nombre_en_tienda: 't', marca: 't', contenido: 'n',
      granel: 'b', sku_id: 't', ean: 't', vtex_product_id: 't', url: 't', auto: 'b', activo: 'b',
      ultimo_error: 't', updated_at: 't', _srv: 't',
    },
    cliente: true,
    sincroniza: true,
  },
  Precios: {
    id: 'precio_id',
    cols: {
      precio_id: 't', presentacion_id: 't', tienda: 't', origen: 't', fuente: 't', precio: 'n',
      precio_lista: 'n', disponible: 'b', region: 't', fecha_observado: 't', compra_id: 't',
    },
    cliente: false,
    sincroniza: false,
  },
  Precios_actuales: {
    id: 'clave',
    cols: {
      clave: 't', presentacion_id: 't', tienda: 't', origen: 't', fuente: 't', precio: 'n', precio_lista: 'n',
      disponible: 'b', region: 't', fecha_observado: 't', fecha_verificado: 't', _srv: 't',
    },
    cliente: false,
    sincroniza: true,
  },
  Compras: {
    id: 'compra_id',
    cols: {
      compra_id: 't', estado: 't', fecha_inicio: 't', fecha_cierre: 't', presupuesto: 'n', tiendas_hoy: 't',
      total_final: 'n', tienda_referencia: 't', total_referencia: 'n', items_comparados: 'n', items_total: 'n',
      ahorro: 'n', notas: 't', updated_at: 't', _srv: 't', borrado: 'b',
    },
    cliente: true,
    sincroniza: true,
  },
  Compras_detalle: {
    id: 'detalle_id',
    cols: {
      detalle_id: 't', compra_id: 't', producto_id: 't', nombre_libre: 't', necesidad: 'n', presentacion_id: 't',
      tienda: 't', cantidad: 'n', precio_unitario: 'n', subtotal: 'n', estado: 't', orden: 'n',
      precio_confirmado: 'b', updated_at: 't', _srv: 't', borrado: 'b',
    },
    cliente: true,
    sincroniza: true,
  },
  Compras_resumen: {
    id: 'clave',
    cols: {
      clave: 't', compra_id: 't', tienda: 't', total_hipotetico: 'n', items_con_precio: 'n', items_total: 'n',
      completo: 'b', created_at: 't', _srv: 't',
    },
    cliente: false,
    sincroniza: true,
  },
  Log: {
    id: 'fecha',
    cols: { fecha: 't', tipo: 't', nivel: 't', mensaje: 't', datos: 't', duracion_ms: 'n' },
    cliente: false,
    sincroniza: false,
  },
} as const satisfies Record<string, DefTabla>

export type NombreTabla = keyof typeof TABLAS

/**
 * Columnas que se agregaron después de la primera versión. Un cliente o un script más viejo no las conoce:
 * si no vienen en la fila, se conserva lo que ya había (no se borran con un vacío).
 */
export const COLUMNAS_OPCIONALES: Partial<Record<NombreTabla, readonly string[]>> = { Productos: ['marca', 'borrado'] }
export const NOMBRES_TABLAS = Object.keys(TABLAS) as NombreTabla[]
export const TABLAS_CLIENTE = NOMBRES_TABLAS.filter((t) => TABLAS[t].cliente)
export const TABLAS_SYNC = NOMBRES_TABLAS.filter((t) => TABLAS[t].sincroniza)

export type Origen = 'online' | 'tienda'
export type Fuente = 'auto' | 'manual' | 'compra'
/** RIOHACHA: precio con la región de Riohacha. DEFAULT: la tienda no atiende la región y el precio es el nacional. */
export type Region = 'RIOHACHA' | 'DEFAULT' | ''
export type EstadoCompra = 'borrador' | 'en_curso' | 'cerrada' | 'cancelada'
export type EstadoDetalle = 'pendiente' | 'en_carrito' | 'no_encontrado'

export interface Sincronizable {
  updated_at: string
  _srv?: string
}

export interface FilaConfig extends Sincronizable { clave: string; valor: string }

export interface Categoria extends Sincronizable {
  categoria_id: string
  nombre: string
  orden: number
  borrado: boolean
}

export interface Producto extends Sincronizable {
  producto_id: string
  nombre: string
  categoria_id: string
  unidad_base: UnidadBase
  recurrente: boolean
  /** En kg, L o unidades según unidad_base. */
  cantidad_habitual: number
  notas: string
  activo: boolean
  /** Marca que sueles comprar ("Diana"). Vacía = cualquiera. Las filas viejas no la traen. */
  marca?: string
  /**
   * Eliminado para siempre. Queda solo esta marca (sin nombre ni datos) para que ningún celular ni el Sheet lo vuelvan
   * a traer; sus marcas, tamaños y precios se borran. Distinto de archivado (`activo: false`), que se puede restaurar.
   */
  borrado?: boolean
}

/** Un producto eliminado (o una fila vacía que dejó un script viejo al eliminarlo): no se muestra en ninguna parte. */
export function productoEliminado(p: { borrado?: boolean; nombre?: string | null }): boolean {
  return !!p.borrado || !String(p.nombre ?? '').trim()
}

export interface Presentacion extends Sincronizable {
  presentacion_id: string
  producto_id: string
  tienda: Tienda
  nombre_en_tienda: string
  marca: string
  /** Contenido neto en la unidad_base del producto (g, ml o unidades). Granel por kg: 1000. */
  contenido: number | null
  granel: boolean
  sku_id: string
  ean: string
  vtex_product_id: string
  url: string
  auto: boolean
  activo: boolean
  ultimo_error: string
}

export interface PrecioHistorico {
  precio_id: string
  presentacion_id: string
  tienda: Tienda
  origen: Origen
  fuente: Fuente
  precio: number | null
  precio_lista: number | null
  disponible: boolean
  region: Region
  fecha_observado: string
  compra_id: string
}

export interface PrecioActual {
  clave: string
  presentacion_id: string
  tienda: Tienda
  origen: Origen
  fuente: Fuente
  precio: number | null
  precio_lista: number | null
  disponible: boolean
  region: Region
  fecha_observado: string
  fecha_verificado: string
  _srv?: string
}

/** Lo que llega a `upsert` en la tabla virtual Observaciones. */
export interface Observacion {
  obs_id: string
  presentacion_id: string
  tienda: Tienda
  origen: Origen
  fuente: Fuente
  precio: number | null
  precio_lista: number | null
  disponible: boolean
  region: Region
  fecha_observado: string
  compra_id: string
}

export interface Compra extends Sincronizable {
  compra_id: string
  estado: EstadoCompra
  fecha_inicio: string
  fecha_cierre: string
  presupuesto: number | null
  /** Códigos separados por coma. */
  tiendas_hoy: string
  total_final: number | null
  tienda_referencia: string
  total_referencia: number | null
  items_comparados: number | null
  items_total: number | null
  ahorro: number | null
  notas: string
  borrado: boolean
}

export interface Detalle extends Sincronizable {
  detalle_id: string
  compra_id: string
  /** Vacío si es un ítem libre (no está en el catálogo). */
  producto_id: string
  nombre_libre: string
  /** Lo que se necesita, en kg, L o unidades según el producto. */
  necesidad: number | null
  presentacion_id: string
  /** Vacío mientras la recomendación decide; con valor, el usuario la fijó o ya compró. */
  tienda: Tienda | ''
  /** Paquetes (o kg/L si es granel). */
  cantidad: number | null
  /** Precio por paquete (o por kg/L si es granel). */
  precio_unitario: number | null
  subtotal: number | null
  estado: EstadoDetalle
  orden: number
  /**
   * El precio lo vio el usuario en la tienda (lo escribió, lo cambió o el sugerido ya era de tienda).
   * Solo estos se guardan como precio de tienda al cerrar: un sugerido online aceptado sin mirar no.
   */
  precio_confirmado?: boolean
  borrado: boolean
}

export interface ResumenTienda {
  clave: string
  compra_id: string
  tienda: Tienda
  total_hipotetico: number
  items_con_precio: number
  items_total: number
  completo: boolean
  created_at: string
  _srv?: string
}

export function claveActual(presentacion_id: string, origen: Origen): string {
  return `${presentacion_id}|${origen}`
}

export function claveResumen(compra_id: string, tienda: Tienda): string {
  return `${compra_id}|${tienda}`
}
