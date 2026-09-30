import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, guardarMeta } from './db.ts'
import { guardar, nuevoProducto } from './escritura.ts'
import { sincronizar } from './sync.ts'

/** Servidor con un script viejo: guarda las filas con updated_at igual o mayor, pero no conoce la columna `marca`. */
function servidorViejo() {
  const filas = new Map<string, Record<string, unknown>>()
  let reloj = 0
  const llamadas: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
    const c = JSON.parse(String(init?.body))
    llamadas.push(c.a)
    let data: unknown = { resultados: [] }
    if (c.a === 'upsert') {
      const resultados = []
      for (const { tabla, fila } of c.cambios as { tabla: string; fila: Record<string, unknown> }[]) {
        if (tabla !== 'Productos') { resultados.push({ id: String(fila.producto_id ?? fila.clave), r: 'aplicado' }); continue }
        const { marca: _descartada, ...sinMarca } = fila
        const previa = filas.get(String(fila.producto_id))
        if (previa && String(previa.updated_at) > String(fila.updated_at)) { resultados.push({ id: String(fila.producto_id), r: 'antiguo', tabla, fila: previa }); continue }
        filas.set(String(fila.producto_id), { ...sinMarca, _srv: ++reloj })
        resultados.push({ id: String(fila.producto_id), r: 'aplicado' })
      }
      data = { resultados }
    } else if (c.a === 'pull') {
      const desde = Number(c.desde ?? 0)
      data = { tablas: { Productos: [...filas.values()].filter((f) => Number(f._srv) > desde) }, cursor: String(reloj) }
    }
    return new Response(JSON.stringify({ ok: true, data, error: null, v: 1, srv: '2026-09-30T12:00:00.000-05:00' }))
  }))
  return { filas, llamadas }
}

beforeEach(async () => {
  vi.useRealTimers()
  await Promise.all(db.tables.map((t) => t.clear()))
  await guardarMeta('conexion', { url: 'https://script.google.com/macros/s/x/exec', token: 't' })
})

describe('script viejo que descarta la marca: la sincronización se calma', () => {
  it('la marca se reenvía una vez y después no hay más envíos ni cambios de updated_at en cada sincronización', async () => {
    const s = servidorViejo()
    const [p] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', marca: 'Diana' }))
    const marcas: string[] = []
    const enviosPorRonda: number[] = []
    const versiones: string[] = []
    for (let ronda = 0; ronda < 5; ronda++) {
      const antes = s.llamadas.filter((a) => a === 'upsert').length
      await sincronizar()
      enviosPorRonda.push(s.llamadas.filter((a) => a === 'upsert').length - antes)
      marcas.push(String((await db.productos.get(p.producto_id))?.marca))
      versiones.push(String((await db.productos.get(p.producto_id))?.updated_at))
    }
    // La marca nunca se pierde en el celular…
    expect(marcas.every((m) => m === 'Diana')).toBe(true)
    // …y las rondas 3 a 5 ya no mandan nada ni mueven el updated_at (si no, cada sincronización repite el ciclo para siempre).
    expect(enviosPorRonda.slice(2)).toEqual([0, 0, 0])
    expect(new Set(versiones.slice(2)).size).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })
})
