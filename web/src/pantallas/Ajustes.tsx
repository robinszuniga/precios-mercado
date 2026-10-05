import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { RegionGuardada } from '@shared/config.ts'
import { formatoNumero } from '@shared/dinero.ts'
import { TABLAS, type NombreTabla } from '@shared/esquema.ts'
import { validarFila } from '@shared/seguridad.ts'
import { INFO_TIENDAS, TIENDAS_VTEX, type TiendaVtex } from '@shared/tiendas.ts'
import { BotonPegarLista } from '../componentes/PegarLista.tsx'
import { avisar, Boton, Campo, Cargando, ErrorTexto, leerNumero, NombreTienda, Tarjeta, Titulo } from '../componentes/ui.tsx'
import { llamarVtex } from '../datos/apiVtex.ts'
import { useCatalogo, useMeta } from '../datos/consultas.ts'
import { db, exigirCuenta, generacionActual, guardarMeta } from '../datos/db.ts'
import { guardar, guardarConfig } from '../datos/escritura.ts'
import { sincronizar, sincronizarPronto, type EstadoSync } from '../datos/sync.ts'

function hora(ms: number | null) {
  if (!ms) return 'nunca'
  const d = new Date(ms)
  return `${d.toLocaleDateString('es-CO')} ${d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-sm font-semibold tracking-wide text-stone-600 uppercase">{titulo}</h2>
      {children}
    </section>
  )
}

function Reglas() {
  const cat = useCatalogo()
  if (!cat) return null
  const c = cat.cfg
  const campo = (clave: string, etiqueta: string, valor: number, opciones: { ayuda?: string; escala?: number; sufijo?: string; cero?: boolean } = {}) => {
    const escala = opciones.escala ?? 1
    const mostrado = valor * escala
    return (
      <Campo
        key={`${clave}-${valor}`}
        etiqueta={etiqueta}
        defaultValue={formatoNumero(mostrado)}
        inputMode="decimal"
        ayuda={opciones.ayuda}
        onBlur={(e) => {
          // Borrar el campo para reescribirlo no guarda 0 (vencería todos los precios); "1.5" es uno y medio.
          const n = leerNumero(e.target.value)
          if (n == null || n < 0 || (n === 0 && !opciones.cero)) {
            e.target.value = formatoNumero(mostrado)
            return
          }
          if (n !== mostrado) {
            void guardarConfig(clave, String(n / escala))
            avisar('Guardado ✓')
          }
        }}
      />
    )
  }
  return (
    <Tarjeta className="space-y-3">
      {campo('ahorro_minimo_tienda', 'Cuánto te cuesta ir a otra tienda ($)', c.ahorroMinimoTienda, { ayuda: 'El plan solo te manda a otra tienda si ahorras más que esto (pasaje, tiempo).', cero: true })}
      {campo('alerta_presupuesto', 'Avisarme al llegar al … % del presupuesto', c.alertaPresupuesto, { escala: 100 })}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-sm text-marca">Cuándo un precio se considera viejo</summary>
        <div className="space-y-3 pt-1">
          {campo('vigencia_tienda_amarillo_dias', 'Precio de tienda al día (días)', c.vigencias.tiendaAmarillo, { ayuda: 'Después se muestra “en tienda · N d” en amarillo.' })}
          {campo('vigencia_tienda_max_dias', 'Precio de tienda vencido (días)', c.vigencias.tiendaMax, { ayuda: 'Después ya no cuenta para recomendar.' })}
          {campo('vigencia_auto_dias', 'Precio de internet vale (días)', c.vigencias.auto)}
        </div>
      </details>
    </Tarjeta>
  )
}

function Pasillos() {
  const cat = useCatalogo()
  if (!cat || cat.categorias.length === 0) return null
  const mover = async (i: number, delta: number) => {
    const xs = [...cat.categorias]
    const j = i + delta
    if (j < 0 || j >= xs.length) return
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
    await guardar('Categorias', xs.map((c, k) => ({ ...c, orden: k + 1 })))
  }
  return (
    <Tarjeta>
      <h3 className="font-semibold">Orden de los pasillos</h3>
      <p className="mb-1 text-sm text-stone-600">En el orden en que recorres el súper. Así se ordena la compra.</p>
      <ul className="divide-y divide-stone-100">
        {cat.categorias.map((c, i) => (
          <li key={c.categoria_id} className="flex items-center justify-between">
            <span>{c.nombre}</span>
            <span className="flex">
              <button type="button" aria-label={`Subir ${c.nombre}`} disabled={i === 0} className="grid size-11 place-items-center text-lg disabled:text-stone-300" onClick={() => void mover(i, -1)}>↑</button>
              <button type="button" aria-label={`Bajar ${c.nombre}`} disabled={i === cat.categorias.length - 1} className="grid size-11 place-items-center text-lg disabled:text-stone-300" onClick={() => void mover(i, 1)}>↓</button>
            </span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

function Archivados() {
  const archivados = useLiveQuery(async () => (await db.productos.toArray()).filter((p) => !p.activo), []) ?? []
  if (!archivados.length) return null
  return (
    <Tarjeta>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Productos archivados ({archivados.length})</summary>
        <ul className="divide-y divide-stone-100">
          {archivados.map((p) => (
            <li key={p.producto_id} className="flex items-center justify-between">
              <span>{p.nombre}</span>
              <Boton variante="fantasma" onClick={async () => { await guardar('Productos', { ...p, activo: true }); avisar(`${p.nombre} restaurado`) }}>Restaurar</Boton>
            </li>
          ))}
        </ul>
      </details>
    </Tarjeta>
  )
}

function ServicioVtex() {
  return (
    <Tarjeta className="space-y-2 text-sm">
      <h3 className="font-semibold">Precios de internet</h3>
      <p className="text-stone-700">Buscamos los productos en los catálogos online de Éxito y Olímpica; D1 se incluye cuando publica precios para tu región. No necesitas crear una hoja de Google ni copiar una clave. Los precios dependen de la tienda y pueden cambiar; si una tienda no publica el precio, puedes anotarlo aquí.</p>
    </Tarjeta>
  )
}
function Regiones() {
  const cat = useCatalogo()
  const [msg, setMsg] = useState('')
  if (!cat) return null
  async function probar(t: TiendaVtex) {
    setMsg(`Consultando ${INFO_TIENDAS[t].nombre}…`)
    const r = await llamarVtex<{ region: RegionGuardada | null; autoD1: boolean }>('probarRegion', { tienda: t })
    if (r.tipo === 'ok' && r.data.region) {
      await guardarConfig(`region.${t}`, JSON.stringify(r.data.region))
      if (t === 'D1') await guardarConfig('tienda_auto.D1', r.data.autoD1 ? 'si' : 'no')
      setMsg(`${INFO_TIENDAS[t].nombre}: ${r.data.region.localizada ? 'atiende Riohacha' : 'precio nacional'}`)
    } else setMsg(r.tipo === 'error' ? r.mensaje : 'Sin respuesta. Inténtalo de nuevo con conexión.')
  }
  return (
    <Tarjeta className="space-y-1 text-sm">
      {TIENDAS_VTEX.map((t) => {
        const g = cat.cfg.regiones[t]
        return (
          <div key={t} className="flex items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-x-1.5">
              <NombreTienda tienda={t} tam={18} />
              <span className="text-stone-700">{!g ? '· sin probar' : g.localizada ? '· precio de Riohacha' : t === 'D1' ? '· no atiende Riohacha: lo anotas tú' : '· precio nacional'}</span>
            </span>
            <Boton variante="fantasma" onClick={() => void probar(t)}>Probar</Boton>
          </div>
        )
      })}
      <div className="flex items-center gap-1.5 py-2"><NombreTienda tienda="ARA" tam={18} /><span className="text-stone-700">· no vende online: lo anotas tú</span></div>
      {msg && <p role="status">{msg}</p>}
    </Tarjeta>
  )
}

function Dispositivo() {
  const [persistente, setPersistente] = useState<boolean | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultadoRespaldo, setResultadoRespaldo] = useState<{ ok: boolean; texto: string } | null>(null)
  const entradaRespaldo = useRef<HTMLInputElement>(null)
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersistente) }, [])
  async function respaldo() {
    const datos: Record<string, unknown> = {}
    for (const t of TABLAS_RESPALDO) {
      datos[t] = await db.table(t).toArray()
    }
    const blob = new Blob([JSON.stringify({ app: 'precios-mercado', fecha: new Date().toISOString(), datos }, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `precios-mercado-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    // Safari (iPhone) todavía está leyendo el archivo justo después del clic: se libera un rato después.
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
    await guardarMeta('ultimoRespaldo', Date.now())
    avisar('Respaldo descargado')
  }

  async function importar(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    // Permite volver a elegir el mismo archivo si se corrige o falla la importación.
    e.target.value = ''
    if (!archivo) return
    // El respaldo se importa a la cuenta que estaba abierta al elegirlo: si cambia antes de escribir, se cancela.
    const cuenta = generacionActual()
    setImportando(true)
    setResultadoRespaldo(null)
    try {
      if (archivo.size > 25 * 1024 * 1024) throw new Error('El archivo supera el límite de 25 MB.')
      const copia: unknown = JSON.parse(await archivo.text())
      exigirCuenta(cuenta)
      if (!esRegistro(copia) || copia.app !== 'precios-mercado' || !esRegistro(copia.datos)) {
        throw new Error('El archivo no parece un respaldo de Precios de Mercado.')
      }

      const datosCopia = copia.datos
      const tablas = TABLAS_RESPALDO.filter((nombre) => nombre in datosCopia)
      if (!tablas.length) throw new Error('El respaldo no contiene datos que esta versión pueda importar.')

      const filas = new Map<string, Record<string, unknown>[]>()
      let total = 0
      for (const nombre of tablas) {
        const valor = copia.datos[nombre]
        if (!Array.isArray(valor)) throw new Error(`La tabla “${nombre}” no tiene un formato válido.`)
        const tabla = db.table(nombre)
        const clave = tabla.schema.primKey.name
        const lista = valor.map((fila) => {
          const valida = validarFila(ESQUEMA_RESPALDO[nombre], fila, false)
          if (!esRegistro(fila)) throw new Error(`Fila inválida en “${nombre}”: debe ser un objeto.`)
          const opcionales = COLUMNAS_RESPALDO_OPCIONALES[nombre]
          const faltante = Object.keys(TABLAS[ESQUEMA_RESPALDO[nombre]].cols)
            .find((col) => col !== '_srv' && !opcionesTiene(opcionales, col) && !(col in fila))
          if (fila[clave] == null || !['string', 'number'].includes(typeof fila[clave]) || faltante || !valida.ok) {
            const detalle = faltante ? `falta la columna ${faltante}` : valida.ok ? 'clave inválida' : valida.error
            throw new Error(`Fila inválida en “${nombre}”: ${detalle}.`)
          }
          return fila
        })
        filas.set(nombre, lista)
        total += lista.length
      }
      if (total === 0) throw new Error('El respaldo está vacío.')

      const confirmacion = window.confirm(
        `Se combinarán ${total} registros con los datos de esta cuenta. Si una fila tiene la misma clave, la del archivo la reemplazará; las demás se conservan. Al confirmar, los datos se sincronizarán con tu cuenta. ¿Continuar?`,
      )
      if (!confirmacion) return

      exigirCuenta(cuenta)
      const tablasLocales = tablas.map((nombre) => db.table(nombre))
      await db.transaction('rw', [...tablasLocales, db.outbox], async () => {
        for (const nombre of tablas) await db.table(nombre).bulkPut(filas.get(nombre)!)
        for (const nombre of tablas) {
          const cambios = filas.get(nombre)!.map((fila) => ({ tabla: ESQUEMA_RESPALDO[nombre], fila }))
          for (let i = 0; i < cambios.length; i += 100) {
            await db.outbox.add({ tipo: 'upsert', payload: { cambios: cambios.slice(i, i + 100) }, intentos: 0, proximo: 0, creado: Date.now() })
          }
        }
      })
      sincronizarPronto()
      setResultadoRespaldo({ ok: true, texto: `Listo: se importaron ${total} registros. Se sincronizarán con tu cuenta.` })
    } catch (error) {
      setResultadoRespaldo({ ok: false, texto: error instanceof Error ? error.message : 'No se pudo leer el respaldo.' })
    } finally {
      setImportando(false)
    }
  }

  return (
    <Tarjeta className="space-y-2 text-sm">
      <p>{persistente ? '✔ El celular protege estos datos.' : persistente === false ? 'El celular podría borrar estos datos si le falta espacio. Instala la app para protegerlos.' : ''}</p>
      <Boton variante="secundario" className="w-full" onClick={() => void respaldo()}>Descargar respaldo (archivo)</Boton>
      <input ref={entradaRespaldo} className="hidden" type="file" accept="application/json,.json" onChange={(e) => void importar(e)} />
      <Boton variante="secundario" className="w-full" onClick={() => entradaRespaldo.current?.click()} disabled={importando}>
        {importando ? 'Importando…' : 'Importar respaldo (archivo)'}
      </Boton>
      <p className="text-stone-600">
        Combina los datos de la copia con los de esta cuenta. Las filas importadas también se sincronizan con tu nube.
      </p>
      {resultadoRespaldo && (resultadoRespaldo.ok
        ? <p role="status" className="font-medium text-ok">{resultadoRespaldo.texto}</p>
        : <ErrorTexto>{resultadoRespaldo.texto}</ErrorTexto>)}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-marca">Instalar la app en el celular</summary>
        <ul className="list-disc space-y-1 pl-5 text-stone-700">
          <li><strong>Android (Chrome):</strong> menú ⋮ → Instalar app.</li>
          <li><strong>iPhone (Safari):</strong> botón Compartir (cuadrito con flecha) → “Añadir a pantalla de inicio”.</li>
          <li>Instala primero y configura desde la app instalada: en iPhone no comparte datos con Safari.</li>
        </ul>
      </details>
    </Tarjeta>
  )
}

const TABLAS_RESPALDO = ['config', 'categorias', 'productos', 'presentaciones', 'preciosActuales', 'compras', 'detalle', 'resumen', 'historial'] as const
type TablaRespaldo = typeof TABLAS_RESPALDO[number]

const ESQUEMA_RESPALDO: Record<TablaRespaldo, NombreTabla> = {
  config: 'Config',
  categorias: 'Categorias',
  productos: 'Productos',
  presentaciones: 'Presentaciones',
  preciosActuales: 'Precios_actuales',
  compras: 'Compras',
  detalle: 'Compras_detalle',
  resumen: 'Compras_resumen',
  historial: 'Precios',
}

const COLUMNAS_RESPALDO_OPCIONALES: Partial<Record<TablaRespaldo, readonly string[]>> = {
  productos: ['marca'],
  detalle: ['precio_confirmado'],
}

function opcionesTiene(opcionales: readonly string[] | undefined, columna: string): boolean {
  return opcionales?.includes(columna) ?? false
}

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function Avanzado() {
  const rechazados = useLiveQuery(() => db.rechazados.toArray(), []) ?? []
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  return (
    <details className="rounded-2xl bg-white p-3 text-sm ring-1 ring-stone-200">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Avanzado (diagnóstico)</summary>
      <div className="space-y-2 pt-2">
        {sync.error && <p className="text-peligro">Último error: {sync.error}</p>}
        {rechazados.length > 0 && (
          <div>
            <p className="text-peligro">{rechazados.length} cambios rechazados por el servidor</p>
            <ul className="mt-1 space-y-1 text-xs">{rechazados.slice(-20).map((r) => <li key={r.id}>{r.tabla} {r.filaId}: {r.mensaje}</li>)}</ul>
            <Boton variante="fantasma" onClick={() => void db.rechazados.clear()}>Borrar la lista</Boton>
          </div>
        )}
        <Boton variante="secundario" className="w-full" onClick={() => void sincronizar({ completo: true })}>Bajar mis datos de nuevo</Boton>
      </div>
    </details>
  )
}

export function Ajustes() {
  const cat = useCatalogo()
  if (!cat) return <Cargando />
  return (
    <section className="space-y-5">
      <Titulo>Ajustes</Titulo>
      <Seccion titulo="Mi mercado">
        <Tarjeta>
          <h3 className="font-semibold">Pasar mi lista</h3>
          <p className="mb-2 text-sm text-stone-600">Pega tu listado de WhatsApp, Notas o Excel y se crean los productos con su cantidad y pasillo.</p>
          <BotonPegarLista className="w-full" />
        </Tarjeta>
        <Reglas />
        <Pasillos />
        <Archivados />
      </Seccion>
      <Seccion titulo="Tus datos y precios de internet">
        <ServicioVtex />
        <Regiones />
      </Seccion>
      <Seccion titulo="Este celular">
        <Dispositivo />
      </Seccion>
      <Avanzado />
      <p className="text-center text-xs text-stone-600">Precios de Mercado · versión {__VERSION__}</p>
    </section>
  )
}
