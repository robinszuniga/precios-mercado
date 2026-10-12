import { beforeEach, describe, expect, it } from 'vitest'
import { claveSede, sedesDeConfig, type Sede } from '@shared/mapa.ts'
import { db } from './db.ts'
import { agregarSede, agregarSedesEncontradas, quitarSede, restaurarSede } from './sedes.ts'

const osm = (id: string, lat: number, lng: number, nombre = id): Sede => ({ id, tienda: 'D1', nombre, lat, lng })
const guardadas = async () => sedesDeConfig(await db.config.toArray())

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

describe('sedes encontradas en OpenStreetMap', () => {
  it('una sede que quitaste no vuelve con la siguiente búsqueda (los ids de OpenStreetMap son siempre los mismos)', async () => {
    const calle15 = osm('osm:node1', 11.54, -72.9, 'D1 Calle 15')
    const otra = osm('osm:node2', 11.56, -72.92, 'D1 Centro')
    expect(await agregarSedesEncontradas([calle15, otra])).toBe(2)
    await quitarSede('osm:node1')
    expect((await guardadas()).map((s) => s.id)).toEqual(['osm:node2'])

    // Otra búsqueda trae las mismas dos y una nueva: solo la nueva entra.
    const nueva = osm('osm:node3', 11.6, -72.95, 'D1 Norte')
    expect(await agregarSedesEncontradas([calle15, otra, nueva])).toBe(1)
    expect((await guardadas()).map((s) => s.id).sort()).toEqual(['osm:node2', 'osm:node3'])
    // Y buscando otra vez, nada nuevo.
    expect(await agregarSedesEncontradas([calle15, otra, nueva])).toBe(0)
  })

  it('«Deshacer» la devuelve, y volver a agregarla a mano sigue siendo posible', async () => {
    const calle15 = osm('osm:node1', 11.54, -72.9, 'D1 Calle 15')
    await agregarSedesEncontradas([calle15])
    const quitada = (await quitarSede('osm:node1'))!
    expect(await guardadas()).toEqual([])
    await restaurarSede(quitada)
    expect((await guardadas()).map((s) => s.id)).toEqual(['osm:node1'])
    // Quitada de nuevo, una sede a mano en el mismo lugar es otra sede (otro id) y entra.
    await quitarSede('osm:node1')
    const manual = await agregarSede('D1', { lat: 11.54, lng: -72.9 })
    expect(manual?.id).toBeTruthy()
    expect((await guardadas()).map((s) => s.id)).toEqual([manual!.id])
  })
})

describe('la misma tienda traída dos veces por OpenStreetMap', () => {
  it('si quitaste el punto, el edificio de la misma tienda (otro id, a menos de 80 m) tampoco vuelve en la misma respuesta', async () => {
    const punto = osm('osm:node1', 11.54, -72.9, 'D1 Calle 15')
    const edificio = osm('osm:way9', 11.54003, -72.90002, 'D1 Calle 15')
    await agregarSedesEncontradas([punto])
    await quitarSede('osm:node1')
    expect(await agregarSedesEncontradas([punto, edificio])).toBe(0)
    expect(await guardadas()).toEqual([])
    // Una tienda de verdad distinta, más lejos, sí entra.
    expect(await agregarSedesEncontradas([punto, edificio, osm('osm:node5', 11.6, -72.95, 'D1 Norte')])).toBe(1)
  })
})

describe('agregar una sede a mano', () => {
  it('una longitud de otra «copia del mundo» se guarda con su valor real y la sede aparece', async () => {
    const sede = await agregarSede('EXITO', { lat: 11.5, lng: 287.09 })
    expect(sede?.lng).toBeCloseTo(-72.91, 6)
    const todas = await guardadas()
    expect(todas).toHaveLength(1)
    expect(todas[0].id).toBe(sede!.id)
    expect((await db.config.get(claveSede(sede!.id)))?.valor).toContain('-72.91')
  })

  it('un punto que no es una ubicación no escribe nada', async () => {
    await expect(agregarSede('EXITO', { lat: Number.NaN, lng: 0 })).rejects.toThrow(/válida/)
    expect(await db.config.count()).toBe(0)
  })
})
