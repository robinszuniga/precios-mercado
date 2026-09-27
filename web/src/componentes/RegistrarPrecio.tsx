import { useState } from 'react'
import { parseContenido } from '@shared/contenido.ts'
import type { Presentacion, Producto } from '@shared/esquema.ts'
import { INFO_TIENDAS, TIENDAS, type Tienda } from '@shared/tiendas.ts'
import { etiquetaVisible, factorVisible } from '@shared/unidades.ts'
import { guardar, nuevaPresentacion, registrarPrecioManual } from '../datos/escritura.ts'
import { Boton, Campo, Casilla, leerNumero, Selector } from './ui.tsx'

export function describirPresentacion(p: Presentacion, producto: Producto): string {
  const nombre = p.marca || p.nombre_en_tienda || 'Sin marca'
  if (p.granel) return `${nombre} (granel, por ${etiquetaVisible(producto.unidad_base)})`
  if (!p.contenido) return `${nombre} (tamaño ?)`
  const f = factorVisible(producto.unidad_base)
  const tam = producto.unidad_base === 'unidad' ? `${p.contenido} und` : p.contenido >= f ? `${p.contenido / f} ${etiquetaVisible(producto.unidad_base)}` : `${p.contenido} ${producto.unidad_base}`
  return `${nombre} ${tam}`
}

/** Precio visto en la tienda (manual). Si la presentación no existe, se crea con marca y tamaño. */
export function RegistrarPrecio({
  producto, presentaciones, tiendaInicial, presentacionInicial, onListo,
}: { producto: Producto; presentaciones: Presentacion[]; tiendaInicial?: Tienda; presentacionInicial?: string; onListo: () => void }) {
  const [tienda, setTienda] = useState<Tienda>(tiendaInicial ?? 'D1')
  const deTienda = presentaciones.filter((p) => p.activo && p.tienda === tienda)
  const [presId, setPresId] = useState(presentacionInicial ?? deTienda[0]?.presentacion_id ?? '__nueva')
  const [marca, setMarca] = useState('')
  const [tamano, setTamano] = useState('')
  const [granel, setGranel] = useState(false)
  const [precio, setPrecio] = useState('')
  const c = parseContenido(tamano)
  const tamanoOk = granel || (!!c && c.unidad === producto.unidad_base)
  const valor = leerNumero(precio)
  const nueva = presId === '__nueva' || !deTienda.some((p) => p.presentacion_id === presId)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!valor || valor <= 0) return
    let p = deTienda.find((x) => x.presentacion_id === presId)
    if (nueva) {
      ;[p] = await guardar<Presentacion>('Presentaciones', nuevaPresentacion({
        producto_id: producto.producto_id,
        tienda,
        marca: marca.trim(),
        nombre_en_tienda: [marca.trim(), tamano.trim()].filter(Boolean).join(' '),
        granel,
        contenido: granel ? factorVisible(producto.unidad_base) : c && c.unidad === producto.unidad_base ? c.valor : null,
      }))
    }
    await registrarPrecioManual(p!, valor)
    onListo()
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Selector etiqueta="Tienda" value={tienda} onChange={(e) => { setTienda(e.target.value as Tienda); setPresId('__nueva') }}>
        {TIENDAS.map((t) => <option key={t} value={t}>{INFO_TIENDAS[t].nombre}</option>)}
      </Selector>
      <Selector etiqueta="Presentación" value={nueva ? '__nueva' : presId} onChange={(e) => setPresId(e.target.value)}>
        {deTienda.map((p) => <option key={p.presentacion_id} value={p.presentacion_id}>{describirPresentacion(p, producto)}</option>)}
        <option value="__nueva">+ Otra marca o tamaño…</option>
      </Selector>
      {nueva && (
        <>
          <Campo etiqueta="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Diana, marca propia…" />
          <Casilla etiqueta={`A granel (precio por ${etiquetaVisible(producto.unidad_base)})`} checked={granel} onChange={setGranel} />
          {!granel && (
            <Campo
              etiqueta="Tamaño"
              value={tamano}
              onChange={(e) => setTamano(e.target.value)}
              placeholder={producto.unidad_base === 'g' ? '500 g, 1 kg' : producto.unidad_base === 'ml' ? '1 L, 900 ml' : '30 und'}
              ayuda={tamano && !tamanoOk ? 'No entiendo ese tamaño para este producto; se guarda sin comparar por unidad.' : undefined}
            />
          )}
        </>
      )}
      <Campo
        etiqueta={granel ? `Precio por ${etiquetaVisible(producto.unidad_base)}` : 'Precio del paquete'}
        inputMode="numeric"
        value={precio}
        onChange={(e) => setPrecio(e.target.value)}
        placeholder="4.500"
        required
        autoFocus={!nueva}
      />
      <Boton type="submit" className="w-full" disabled={!valor}>Guardar precio</Boton>
    </form>
  )
}
