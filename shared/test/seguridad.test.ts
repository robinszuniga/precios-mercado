import { describe, expect, it } from 'vitest'
import { MAX_TEXTO, validarFila } from '../src/seguridad.ts'
import { conservarOpcionales } from '../src/sync.ts'

const producto = { producto_id: 'p1', nombre: 'Arroz', categoria_id: 'g', unidad_base: 'g', recurrente: true, cantidad_habitual: 1, notas: '', activo: true, updated_at: '2026-09-30T10:00:00.000-05:00' }

describe('columnas opcionales (clientes y scripts viejos)', () => {
  it('un cliente viejo que no manda la marca no la borra: la columna no entra en la fila', () => {
    const v = validarFila('Productos', producto)
    expect(v.ok && 'marca' in v.fila).toBe(false)
    const w = validarFila('Productos', { ...producto, marca: 'Diana' })
    expect(w.ok && w.fila.marca).toBe('Diana')
    // Vaciarla a propósito sí se respeta.
    const x = validarFila('Productos', { ...producto, marca: '' })
    expect(x.ok && x.fila.marca).toBe('')
  })

  it('los textos se cortan en 2.000 caracteres (una celda enorme haría fallar toda la escritura)', () => {
    const v = validarFila('Productos', { ...producto, nombre: 'x'.repeat(50_000) })
    expect(v.ok && String(v.fila.nombre).length).toBe(MAX_TEXTO)
  })

  it('al traer del servidor se conserva la marca local si el servidor (script viejo) la devuelve vacía o sin la clave', () => {
    const local = { ...producto, marca: 'Diana' }
    expect(conservarOpcionales('Productos', local, { ...producto })).toMatchObject({ reenviar: true, fila: { marca: 'Diana' } })
    expect(conservarOpcionales('Productos', local, { ...producto, marca: '' })).toMatchObject({ reenviar: true, fila: { marca: 'Diana' } })
    // Si el servidor trae valor, o es una edición más nueva que vació la marca, gana el servidor.
    expect(conservarOpcionales('Productos', local, { ...producto, marca: 'Roa' })).toMatchObject({ reenviar: false, fila: { marca: 'Roa' } })
    expect(conservarOpcionales('Productos', local, { ...producto, marca: '', updated_at: '2026-09-30T11:00:00.000-05:00' })).toMatchObject({ reenviar: false, fila: { marca: '' } })
    expect(conservarOpcionales('Compras', { updated_at: 'x' }, { updated_at: 'x' }).reenviar).toBe(false)
  })
})
