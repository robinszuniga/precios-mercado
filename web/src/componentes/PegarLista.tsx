import { useId, useRef, useState } from 'react'
import type { Producto } from '@shared/esquema.ts'
import { emparejar, leerLista } from '@shared/importarLista.ts'
import { etiquetaVisible, type UnidadBase } from '@shared/unidades.ts'
import { db } from '../datos/db.ts'
import { crearDesdeLista } from '../datos/escritura.ts'
import { useTiendasHoy } from '../datos/tiendasHoy.ts'
import { avisar, Boton, BotonIcono, Casilla, Hoja, leerNumero } from './ui.tsx'
import { buscarPreciosSolo } from './VincularTodos.tsx'

type Fila = {
  clave: number
  nombre: string
  cantidad: string
  unidad_base: UnidadBase
  pasillo: string
  aviso: string
  existente: Producto | null
}

const EJEMPLO = `Granos:
Arroz 5 kg
Fríjol 1 lb
Lácteos:
Leche 6 L
Huevos 30`

const texto = (n: number) => String(n).replace('.', ',')

/** Un renglón de la vista previa: nombre, cantidad y unidad editables. */
function FilaLista({ f, onCambio, onQuitar }: { f: Fila; onCambio: (f: Fila) => void; onQuitar: () => void }) {
  const id = useId()
  const cantidadMala = leerNumero(f.cantidad) == null || !(leerNumero(f.cantidad)! > 0)
  return (
    <li className="space-y-1 py-2">
      <div className="flex items-center gap-1">
        <label htmlFor={`${id}-n`} className="sr-only">Nombre</label>
        <input
          id={`${id}-n`}
          value={f.nombre}
          onChange={(e) => onCambio({ ...f, nombre: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-2 font-medium"
        />
        <BotonIcono etiqueta={`Quitar ${f.nombre}`} className="text-xl text-stone-600" onClick={onQuitar}>×</BotonIcono>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-c`} className="sr-only">Cantidad de {f.nombre}</label>
        <input
          id={`${id}-c`}
          inputMode="decimal"
          value={f.cantidad}
          onChange={(e) => onCambio({ ...f, cantidad: e.target.value })}
          aria-invalid={cantidadMala}
          className={`w-20 rounded-lg border bg-white px-2 py-2 text-right tabular-nums ${cantidadMala ? 'border-peligro' : 'border-stone-300'}`}
        />
        <label htmlFor={`${id}-u`} className="sr-only">Unidad de {f.nombre}</label>
        <select
          id={`${id}-u`}
          value={f.unidad_base}
          disabled={!!f.existente}
          onChange={(e) => onCambio({ ...f, unidad_base: e.target.value as UnidadBase, aviso: '' })}
          className="rounded-lg border border-stone-300 bg-white px-2 py-2 disabled:bg-stone-100"
        >
          {(['g', 'ml', 'unidad'] as const).map((u) => <option key={u} value={u}>{etiquetaVisible(u)}</option>)}
        </select>
        {f.existente && <span className="text-xs font-medium text-teal-800">Ya lo tienes: se actualiza</span>}
      </div>
      {f.aviso && <p className="text-xs font-medium text-alerta">{f.aviso}</p>}
    </li>
  )
}

/** Pegar el listado (WhatsApp, Notas, Excel) → revisar → guardar como productos ★ y meterlos en la compra de hoy. */
export function PegarLista({ onListo }: { onListo: () => void }) {
  const [tiendasHoy] = useTiendasHoy()
  const [crudo, setCrudo] = useState('')
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [recurrentes, setRecurrentes] = useState(true)
  const [aLaCompra, setALaCompra] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const archivo = useRef<HTMLInputElement>(null)
  const idTexto = useId()
  const puedePegar = typeof navigator !== 'undefined' && !!navigator.clipboard?.readText

  async function pegar() {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) setCrudo(t)
      else avisar('No hay nada copiado. Copia tu lista primero.')
    } catch {
      avisar('Mantén presionado el cuadro y elige “Pegar”.')
    }
  }

  async function revisar() {
    const productos = await db.productos.toArray()
    const xs = emparejar(leerLista(crudo), productos)
    setFilas(xs.map((x, i) => ({
      clave: i,
      nombre: x.nombre,
      cantidad: texto(x.cantidad),
      // Un producto que ya existe conserva su unidad (cambiarla dañaría sus precios).
      unidad_base: x.existente?.unidad_base ?? x.unidad_base,
      pasillo: x.pasillo,
      aviso: x.existente && x.existente.unidad_base !== x.unidad_base
        ? `Tu producto se mide en ${etiquetaVisible(x.existente.unidad_base)}: revisa la cantidad.`
        : x.aviso,
      existente: x.existente,
    })))
  }

  async function guardarTodo() {
    if (!filas) return
    setGuardando(true)
    const r = await crearDesdeLista(
      filas.map((f) => ({ nombre: f.nombre, cantidad: leerNumero(f.cantidad)!, unidad_base: f.unidad_base, pasillo: f.pasillo, existente: f.existente })),
      { recurrentes, aLaCompra, tiendasHoy },
    )
    setGuardando(false)
    const partes = [r.creados && `${r.creados} nuevos`, r.actualizados && `${r.actualizados} actualizados`].filter(Boolean).join(' y ')
    avisar(`Listo: ${partes}${aLaCompra ? ', ya están en la compra' : ''}. Buscando sus precios en internet…`)
    onListo()
    void buscarPreciosSolo(true)
  }

  if (filas) {
    const validas = filas.every((f) => f.nombre.trim() && (leerNumero(f.cantidad) ?? 0) > 0)
    const grupos = [...new Set(filas.map((f) => f.pasillo))]
    const porRevisar = filas.filter((f) => f.aviso).length
    const cambiar = (f: Fila) => setFilas(filas.map((x) => (x.clave === f.clave ? f : x)))
    return (
      <div className="space-y-3">
        <p className="text-sm text-stone-700">
          Encontré <strong>{filas.length}</strong> productos
          {filas.some((f) => f.existente) && <> ({filas.filter((f) => f.existente).length} ya los tenías)</>}.
          {porRevisar > 0 && <> Revisa los <span className="font-semibold text-alerta">{porRevisar} marcados</span>.</>}
          {' '}Las cantidades van en kg, L o unidades.
        </p>
        {filas.length === 0 && <p className="text-stone-700">No encontré productos. Vuelve y revisa el texto.</p>}
        {grupos.map((g) => (
          <section key={g || 'sin'}>
            <h3 className="text-sm font-semibold tracking-wide text-stone-600 uppercase">{g || 'Sin pasillo'}</h3>
            <ul className="divide-y divide-stone-100">
              {filas.filter((f) => f.pasillo === g).map((f) => (
                <FilaLista key={f.clave} f={f} onCambio={cambiar} onQuitar={() => setFilas(filas.filter((x) => x.clave !== f.clave))} />
              ))}
            </ul>
          </section>
        ))}
        <div className="rounded-xl bg-stone-100 px-3 py-1">
          <Casilla etiqueta="Marcarlos con ★ (entran solos en cada compra)" checked={recurrentes} onChange={setRecurrentes} />
          <Casilla etiqueta="Agregarlos también a la compra de hoy" checked={aLaCompra} onChange={setALaCompra} />
        </div>
        <div className="flex gap-2 pb-2">
          <Boton variante="secundario" className="flex-1" onClick={() => setFilas(null)}>Atrás</Boton>
          <Boton className="flex-[2]" disabled={!validas || filas.length === 0 || guardando} onClick={() => void guardarTodo()}>
            {guardando ? 'Guardando…' : `Guardar ${filas.length} producto${filas.length === 1 ? '' : 's'}`}
          </Boton>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-700">
        En WhatsApp o Notas, mantén presionada tu lista y toca <strong>Copiar</strong>. Luego pégala aquí.
        Un producto por renglón con su cantidad (“Arroz 5 kg”). Los títulos como “Lácteos:” se vuelven pasillos.
      </p>
      {puedePegar && <Boton variante="secundario" className="w-full" onClick={() => void pegar()}>Pegar lo que copiaste</Boton>}
      <div>
        <label htmlFor={idTexto} className="mb-1 block text-sm text-stone-700">Tu lista</label>
        <textarea
          id={idTexto}
          value={crudo}
          onChange={(e) => setCrudo(e.target.value)}
          rows={9}
          placeholder={EJEMPLO}
          className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 outline-none focus:border-marca focus:ring-2 focus:ring-marca/30"
        />
      </div>
      <input
        ref={archivo}
        type="file"
        accept=".txt,.csv,.tsv,text/plain,text/csv"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) setCrudo(await f.text())
          e.target.value = ''
        }}
      />
      <div className="flex gap-2 pb-2">
        <Boton variante="fantasma" onClick={() => archivo.current?.click()}>Abrir archivo</Boton>
        <Boton className="flex-1" disabled={!crudo.trim()} onClick={() => void revisar()}>Revisar</Boton>
      </div>
    </div>
  )
}

/** Botón que abre la hoja de "Pegar mi lista". */
export function BotonPegarLista({ variante = 'secundario', className = '', texto: etiqueta = 'Pegar mi lista' }: {
  variante?: 'primario' | 'secundario' | 'fantasma'; className?: string; texto?: string
}) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton variante={variante} className={className} onClick={() => setAbierta(true)}>{etiqueta}</Boton>
      <Hoja abierta={abierta} titulo="Pegar mi lista" onCerrar={() => setAbierta(false)} protegida>
        <PegarLista onListo={() => setAbierta(false)} />
      </Hoja>
    </>
  )
}
