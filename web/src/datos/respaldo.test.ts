import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db.ts'
import { agregarALaCompra, asegurarCompra, crearCategoria, eliminarProductos, guardar, nuevaPresentacion, nuevoProducto, registrarPrecioManual } from './escritura.ts'
import { armarRespaldo, leerRespaldo } from './respaldo.ts'

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
})

/** Pasa por JSON, como el archivo que se descarga y se vuelve a elegir. */
const comoArchivo = async () => JSON.parse(JSON.stringify(await armarRespaldo(db))) as unknown

async function sembrar() {
  const cat = await crearCategoria('Granos')
  const [arroz] = await guardar('Productos', nuevoProducto({ nombre: 'Arroz', categoria_id: cat.categoria_id }))
  const [pres] = await guardar('Presentaciones', nuevaPresentacion({ producto_id: arroz.producto_id, tienda: 'D1', contenido: 1000 }))
  await registrarPrecioManual(pres, 4500)
  await asegurarCompra(['D1'])
  await agregarALaCompra(arroz, ['D1'])
  return { arroz }
}

describe('respaldo: descargar y volver a importar', () => {
  it('lo que se descarga se puede importar: productos creados en este celular no traen «borrado» y no fallan', async () => {
    const { arroz } = await sembrar()
    // Un producto creado aquí no lleva la clave `borrado`: el respaldo la omite y la importación debe aceptarlo.
    expect(await db.productos.get(arroz.producto_id)).not.toHaveProperty('borrado')
    const { filas, total } = leerRespaldo(await comoArchivo(), db)
    expect(total).toBeGreaterThan(5)
    expect(filas.get('productos')).toHaveLength(1)
    expect(filas.get('detalle')).toHaveLength(1)
  })

  it('productos eliminados (con «borrado») y productos sin esa clave conviven en el mismo respaldo', async () => {
    const { arroz } = await sembrar()
    const [sal] = await guardar('Productos', nuevoProducto({ nombre: 'Sal' }))
    await eliminarProductos([sal.producto_id])
    expect(await db.productos.get(arroz.producto_id)).not.toHaveProperty('borrado')
    const { filas } = leerRespaldo(await comoArchivo(), db)
    expect(filas.get('productos')).toHaveLength(2)
  })

  it('un respaldo hecho antes de que existieran «marca», «borrado» y «precio_confirmado» también se importa', async () => {
    await sembrar()
    const copia = await comoArchivo() as { datos: Record<string, Record<string, unknown>[]> }
    for (const p of copia.datos.productos) { delete p.marca; delete p.borrado }
    for (const d of copia.datos.detalle) delete d.precio_confirmado
    const { total } = leerRespaldo(copia, db)
    expect(total).toBeGreaterThan(0)
  })

  it('una fila a la que le falta una columna obligatoria se rechaza y dice cuál', async () => {
    await sembrar()
    const copia = await comoArchivo() as { datos: Record<string, Record<string, unknown>[]> }
    delete copia.datos.productos[0].nombre
    expect(() => leerRespaldo(copia, db)).toThrow(/Fila inválida en “productos”: falta la columna nombre/)
  })

  it('un archivo que no es un respaldo, o está vacío, se rechaza', async () => {
    expect(() => leerRespaldo({ app: 'otra', datos: {} }, db)).toThrow(/no parece un respaldo/)
    expect(() => leerRespaldo({ app: 'precios-mercado', datos: { productos: [] } }, db)).toThrow(/vacío/)
    expect(() => leerRespaldo({ app: 'precios-mercado', datos: { productos: [7] } }, db)).toThrow(/debe ser un objeto/)
  })
})
