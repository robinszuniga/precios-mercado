import { useEffect, useState } from 'react'
import { normalizar } from '@shared/contenido.ts'
import type { Categoria, Producto } from '@shared/esquema.ts'
import { etiquetaVisible, type UnidadBase } from '@shared/unidades.ts'
import { INFO_TIENDAS } from '@shared/tiendas.ts'
import { useMeta } from '../datos/consultas.ts'
import { guardarMeta } from '../datos/db.ts'
import { crearCategoria, guardar, nuevoProducto } from '../datos/escritura.ts'
import { vincularMarca } from '../datos/vincularLote.ts'
import { avisar, Boton, Campo, Casilla, leerNumero, Selector } from './ui.tsx'

const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs[0] ?? '')

/** Tras elegir marca: la busca en internet y dice dónde quedó (en segundo plano; el formulario ya se cerró). */
async function buscarSuMarca(p: Producto) {
  const r = await vincularMarca(p)
  if (r.tipo === 'fallo') { avisar(`Guardé la marca ${p.marca}; ahora no pude buscar su precio. ${r.motivo}`); return }
  const con = r.con.map((t) => INFO_TIENDAS[t].nombre)
  const sin = r.sin.map((t) => INFO_TIENDAS[t].nombre)
  avisar(con.length
    ? `${p.nombre}: ahora con precio de ${p.marca} en ${lista(con)}.${sin.length ? ` En ${lista(sin)} no la encontré.` : ''}`
    : `No encontré ${p.marca} en internet para ${p.nombre}. Sigue con el precio que tenía; en la tienda puedes anotarlo.`)
}

function FichaPasillo({ texto, activa, onClick }: { texto: string; activa: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={`min-h-11 max-w-full rounded-full border px-3 py-2 text-sm ${activa ? 'border-marca bg-marca-suave font-medium text-teal-900' : 'border-stone-300 bg-white text-stone-700'}`}
    >
      <span className="block truncate">{texto}</span>
    </button>
  )
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
  // El pasillo del último producto guardado en este celular: el siguiente lo trae puesto (se cambia con un toque).
  const ultimoPasillo = useMeta<string>('ultimoPasillo', '')
  const [eligio, setEligio] = useState(false)
  useEffect(() => {
    if (inicial || eligio || categoriaId) return
    const sugerido = categorias.find((c) => c.categoria_id === ultimoPasillo)?.categoria_id ?? (categorias.length === 1 ? categorias[0].categoria_id : '')
    if (sugerido) setCategoriaId(sugerido)
  }, [inicial, eligio, categoriaId, categorias, ultimoPasillo])
  const elegir = (id: string) => { setEligio(true); setCategoriaId(id) }
  // Los productos que llegaron de una lista pegada no tienen pasillo: editarles la marca no debe exigir uno.
  const sinPasilloAbierto = !!inicial && !inicial.categoria_id
  const faltaPasillo = !categoriaId && !sinPasilloAbierto

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim() || faltaPasillo) return
    setGuardando(true)
    try {
      let cat = categoriaId
      if (categoriaId === '__nueva') {
        // Un pasillo con el mismo nombre (sin importar mayúsculas ni tildes) se reutiliza: no se duplica en las fichas.
        const nombrePasillo = categoriaNueva.trim() || 'General'
        cat = categorias.find((c) => normalizar(c.nombre) === normalizar(nombrePasillo))?.categoria_id ?? (await crearCategoria(nombrePasillo)).categoria_id
      }
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
      if (cat) void guardarMeta('ultimoPasillo', cat)
      onListo(p)
      if (p.marca && p.marca !== (inicial?.marca ?? '')) void buscarSuMarca(p)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Arroz, aceite, huevos…" autoFocus required />
      <div role="group" aria-labelledby="etiqueta-pasillo">
        <span id="etiqueta-pasillo" className="mb-1 block text-sm text-stone-700">Pasillo {!sinPasilloAbierto && <span className="text-stone-600">(¿dónde lo encuentras en el súper?)</span>}</span>
        <div className="flex flex-wrap gap-2">
          {sinPasilloAbierto && <FichaPasillo texto="Sin pasillo" activa={categoriaId === ''} onClick={() => elegir('')} />}
          {categorias.map((c) => <FichaPasillo key={c.categoria_id} texto={c.nombre} activa={categoriaId === c.categoria_id} onClick={() => elegir(c.categoria_id)} />)}
          <FichaPasillo texto="+ Nuevo pasillo" activa={categoriaId === '__nueva'} onClick={() => elegir('__nueva')} />
        </div>
        {faltaPasillo && <p className="mt-1 text-xs text-stone-600">Toca uno para poder guardar.</p>}
      </div>
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
