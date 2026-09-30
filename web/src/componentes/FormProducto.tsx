import { useState } from 'react'
import type { Categoria, Producto } from '@shared/esquema.ts'
import { etiquetaVisible, type UnidadBase } from '@shared/unidades.ts'
import { INFO_TIENDAS } from '@shared/tiendas.ts'
import { crearCategoria, guardar, nuevoProducto } from '../datos/escritura.ts'
import { vincularMarca } from '../datos/vincularLote.ts'
import { avisar, Boton, Campo, Casilla, leerNumero, Selector } from './ui.tsx'

const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0] ?? '')

/** Tras elegir marca: la busca en internet y dice dónde quedó (en segundo plano; el formulario ya se cerró). */
async function buscarSuMarca(p: Producto) {
  const r = await vincularMarca(p)
  if (r.tipo === 'sin_google') { avisar(`Marca guardada. Sin la copia en Google no se buscan precios de internet: anota el precio en la tienda.`); return }
  if (r.tipo === 'fallo') { avisar(`Guardé la marca ${p.marca}; ahora no pude buscar su precio. ${r.motivo.startsWith('Tu script') ? r.motivo : 'Lo intento de nuevo solo en un rato.'}`); return }
  const con = r.con.map((t) => INFO_TIENDAS[t].nombre)
  const sin = r.sin.map((t) => INFO_TIENDAS[t].nombre)
  avisar(con.length
    ? `${p.nombre}: ahora con precio de ${p.marca} en ${lista(con)}.${sin.length ? ` En ${lista(sin)} no la encontré.` : ''}`
    : `No encontré ${p.marca} en internet para ${p.nombre}. Sigue con el precio que tenía; en la tienda puedes anotarlo.`)
}

const UNIDADES: { v: UnidadBase; texto: string }[] = [
  { v: 'g', texto: 'Peso (se compara por kg)' },
  { v: 'ml', texto: 'Volumen (se compara por litro)' },
  { v: 'unidad', texto: 'Unidades (huevos, rollos…)' },
]

export function FormProducto({
  inicial, nombreInicial = '', unidadInicial, categorias, onListo,
}: { inicial?: Producto; nombreInicial?: string; unidadInicial?: UnidadBase; categorias: Categoria[]; onListo: (p: Producto) => void }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? nombreInicial)
  const [categoriaId, setCategoriaId] = useState(inicial?.categoria_id ?? (categorias.length ? '' : '__nueva'))
  const [categoriaNueva, setCategoriaNueva] = useState(categorias.length ? '' : 'General')
  const [unidad, setUnidad] = useState<UnidadBase>(inicial?.unidad_base ?? unidadInicial ?? 'g')
  const [recurrente, setRecurrente] = useState(inicial?.recurrente ?? true)
  const [cantidad, setCantidad] = useState(String(inicial?.cantidad_habitual ?? 1).replace('.', ','))
  const [marca, setMarca] = useState(inicial?.marca ?? '')
  const [guardando, setGuardando] = useState(false)
  // Los productos que llegaron de una lista pegada no tienen pasillo: editarles la marca no debe exigir uno.
  const sinPasilloAbierto = !!inicial && !inicial.categoria_id
  const faltaPasillo = !categoriaId && !sinPasilloAbierto

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim() || faltaPasillo) return
    setGuardando(true)
    try {
      let cat = categoriaId
      if (categoriaId === '__nueva') cat = (await crearCategoria(categoriaNueva || 'General')).categoria_id
      const base = inicial ?? nuevoProducto({ nombre })
      const [p] = await guardar<Producto>('Productos', {
        ...base,
        nombre: nombre.trim(),
        categoria_id: cat,
        unidad_base: unidad,
        recurrente,
        cantidad_habitual: leerNumero(cantidad) ?? 1,
        marca: marca.trim(),
      })
      onListo(p)
      if (p.marca && p.marca !== (inicial?.marca ?? '')) void buscarSuMarca(p)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Arroz, aceite, huevos…" autoFocus required />
      <Selector etiqueta="Pasillo" value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} required={!sinPasilloAbierto}>
        <option value="" disabled={!sinPasilloAbierto}>{sinPasilloAbierto ? 'Sin pasillo' : 'Elige el pasillo…'}</option>
        {categorias.map((c) => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
        <option value="__nueva">+ Pasillo nuevo…</option>
      </Selector>
      {categoriaId === '__nueva' && (
        <Campo etiqueta="Nombre del pasillo" value={categoriaNueva} onChange={(e) => setCategoriaNueva(e.target.value)} placeholder="Granos, Lácteos, Aseo…" />
      )}
      <Selector etiqueta="Cómo se compara" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadBase)} disabled={!!inicial}>
        {UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.texto}</option>)}
      </Selector>
      {inicial && <p className="-mt-2 text-xs text-stone-600">No se puede cambiar: los precios ya guardados se comparan por {etiquetaVisible(unidad)}.</p>}
      <Campo
        etiqueta={`Cantidad habitual (${etiquetaVisible(unidad)})`}
        inputMode="decimal"
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        ayuda="Lo que sueles comprar en cada mercado. Sirve para el plan y el presupuesto."
      />
      <Campo
        etiqueta="Marca que sueles comprar (opcional)"
        value={marca}
        onChange={(e) => setMarca(e.target.value)}
        placeholder="Diana, Alquería, Zenú…"
        autoComplete="off"
        ayuda="Los precios de internet se buscan de esa marca. Vacío: la más barata que coincida."
      />
      <Casilla etiqueta="Recurrente: entra solo en cada lista nueva" checked={recurrente} onChange={setRecurrente} />
      <Boton type="submit" className="w-full" disabled={guardando || !nombre.trim() || faltaPasillo}>{inicial ? 'Guardar cambios' : 'Crear producto'}</Boton>
    </form>
  )
}
