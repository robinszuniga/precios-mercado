import { useState } from 'react'
import type { Categoria, Producto } from '@shared/esquema.ts'
import { etiquetaVisible, type UnidadBase } from '@shared/unidades.ts'
import { crearCategoria, guardar, nuevoProducto } from '../datos/escritura.ts'
import { Boton, Campo, Casilla, leerNumero, Selector } from './ui.tsx'

const UNIDADES: { v: UnidadBase; texto: string }[] = [
  { v: 'g', texto: 'Peso (se compara por kg)' },
  { v: 'ml', texto: 'Volumen (se compara por litro)' },
  { v: 'unidad', texto: 'Unidades (huevos, rollos…)' },
]

export function FormProducto({
  inicial, nombreInicial = '', categorias, onListo,
}: { inicial?: Producto; nombreInicial?: string; categorias: Categoria[]; onListo: (p: Producto) => void }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? nombreInicial)
  const [categoriaId, setCategoriaId] = useState(inicial?.categoria_id ?? categorias[0]?.categoria_id ?? '')
  const [categoriaNueva, setCategoriaNueva] = useState(categorias.length ? '' : 'General')
  const [unidad, setUnidad] = useState<UnidadBase>(inicial?.unidad_base ?? 'g')
  const [recurrente, setRecurrente] = useState(inicial?.recurrente ?? true)
  const [cantidad, setCantidad] = useState(String(inicial?.cantidad_habitual ?? 1).replace('.', ','))
  const [guardando, setGuardando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setGuardando(true)
    try {
      let cat = categoriaId
      if (categoriaId === '__nueva' || !categoriaId) cat = (await crearCategoria(categoriaNueva || 'General')).categoria_id
      const base = inicial ?? nuevoProducto({ nombre })
      const [p] = await guardar<Producto>('Productos', {
        ...base,
        nombre: nombre.trim(),
        categoria_id: cat,
        unidad_base: unidad,
        recurrente,
        cantidad_habitual: leerNumero(cantidad) ?? 1,
      })
      onListo(p)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Arroz, aceite, huevos…" autoFocus required />
      <Selector etiqueta="Pasillo / categoría" value={categoriaId || '__nueva'} onChange={(e) => setCategoriaId(e.target.value)}>
        {categorias.map((c) => <option key={c.categoria_id} value={c.categoria_id}>{c.nombre}</option>)}
        <option value="__nueva">+ Nueva categoría…</option>
      </Selector>
      {(categoriaId === '__nueva' || !categoriaId) && (
        <Campo etiqueta="Nombre de la categoría" value={categoriaNueva} onChange={(e) => setCategoriaNueva(e.target.value)} placeholder="Granos, Lácteos, Aseo…" />
      )}
      <Selector etiqueta="Cómo se compara" value={unidad} onChange={(e) => setUnidad(e.target.value as UnidadBase)} disabled={!!inicial}>
        {UNIDADES.map((u) => <option key={u.v} value={u.v}>{u.texto}</option>)}
      </Selector>
      <Campo
        etiqueta={`Cantidad habitual (${etiquetaVisible(unidad)})`}
        inputMode="decimal"
        value={cantidad}
        onChange={(e) => setCantidad(e.target.value)}
        ayuda="Lo que sueles comprar en cada mercado. Sirve para el plan y el presupuesto."
      />
      <Casilla etiqueta="Recurrente: entra solo en cada lista nueva" checked={recurrente} onChange={setRecurrente} />
      <Boton type="submit" className="w-full" disabled={guardando}>{inicial ? 'Guardar cambios' : 'Crear producto'}</Boton>
    </form>
  )
}
