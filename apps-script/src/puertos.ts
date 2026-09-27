import type { ResultadoActualizacion } from './actualizar.ts'
import type { NombreTabla } from '../../shared/src/esquema.ts'
import type { Fila } from '../../shared/src/seguridad.ts'

/** Todo lo que el backend necesita del mundo. En Apps Script lo implementa gas/*.ts; en los tests, fakes en memoria. */

export interface Repo {
  /** Filas de una pestaña, mapeadas por encabezado. */
  leer(tabla: NombreTabla): Fila[]
  /** Inserta o reemplaza por la columna id de la tabla. */
  guardar(tabla: NombreTabla, filas: readonly Fila[]): void
  /** Agrega al final (histórico, log). */
  agregar(tabla: NombreTabla, filas: readonly Fila[]): void
  /** Deja solo las últimas `max` filas. */
  recortar(tabla: NombreTabla, max: number): void
  pestanasFaltantes(): string[]
  /** Olvida lo ya leído: la próxima lectura va a la hoja (lo que otro proceso escribió mientras tanto). */
  refrescar(): void
}

export interface RespuestaHttp {
  status: number
  cuerpo: string
  setCookie: string[]
}

export interface PeticionHttp {
  url: string
  cabeceras?: Record<string, string>
}

export interface Http {
  /** En paralelo; nunca lanza por códigos HTTP (status 0 si no hubo respuesta). */
  todas(peticiones: readonly PeticionHttp[]): RespuestaHttp[]
}

export interface Lock {
  /** Ejecuta fn con el lock del script. Lanza Ocupado si no lo consigue a tiempo. */
  con<T>(ms: number, fn: () => T): T
}

export class Ocupado extends Error {
  constructor() {
    super('ocupado')
  }
}

export interface Cache {
  get(clave: string): string | null
  put(clave: string, valor: string, segundos: number): void
}

export interface Props {
  get(clave: string): string | null
  set(clave: string, valor: string): void
  borrar(clave: string): void
}

export interface Reloj {
  /** ISO -05:00. */
  ahora(): string
  ms(): number
  dormir(ms: number): void
}

export interface Triggers {
  /** Programa `continuarPrecios` para dentro de ms. */
  unaVez(ms: number): void
  borrarUnaVez(): void
  /** Instala `tareaDiaria` a la hora dada si no existe. */
  asegurarDiario(hora: number): void
  listar(): string[]
}

export interface Servicios {
  repo: Repo
  http: Http
  lock: Lock
  cache: Cache
  props: Props
  reloj: Reloj
  triggers: Triggers
  uuid(): string
  log(mensaje: string): void
  /** Últimos caracteres del id del proyecto de Apps Script: para saber a qué proyecto responde la URL /exec. */
  proyecto(): string
  /** Le pide al cargador que baje la última versión publicada del código (ver actualizar.ts). */
  actualizar(): ResultadoActualizacion
  /** Versión del cargador pegado en Apps Script; null si se pegó el código completo. */
  cargador(): number | null
}
