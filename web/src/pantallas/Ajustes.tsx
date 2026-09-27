import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import type { RegionGuardada } from '@shared/config.ts'
import { formatoNumero } from '@shared/dinero.ts'
import { INFO_TIENDAS, TIENDAS_VTEX, type TiendaVtex } from '@shared/tiendas.ts'
import { BotonPegarLista } from '../componentes/PegarLista.tsx'
import { avisar, Boton, Campo, Cargando, ErrorTexto, NombreTienda, Tarjeta, Titulo } from '../componentes/ui.tsx'
import { llamar, ping, type Conexion } from '../datos/api.ts'
import { useCatalogo, useMeta } from '../datos/consultas.ts'
import { db, guardarMeta } from '../datos/db.ts'
import { guardar, guardarConfig } from '../datos/escritura.ts'
import { conexion, sincronizar, type EstadoSync } from '../datos/sync.ts'

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
  const campo = (clave: string, etiqueta: string, valor: number, opciones: { ayuda?: string; escala?: number; sufijo?: string } = {}) => {
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
          const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'))
          if (Number.isFinite(n) && n !== mostrado) {
            void guardarConfig(clave, String(n / escala))
            avisar('Guardado ✓')
          }
        }}
      />
    )
  }
  return (
    <Tarjeta className="space-y-3">
      {campo('ahorro_minimo_tienda', 'Cuánto te cuesta ir a otra tienda ($)', c.ahorroMinimoTienda, { ayuda: 'El plan solo te manda a otra tienda si ahorras más que esto (pasaje, tiempo).' })}
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

function CopiaGoogle() {
  const guardada = useMeta<Conexion>('conexion', { url: '', token: '' })
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  const pendientes = useLiveQuery(() => db.outbox.count(), []) ?? 0
  const proyectoConectado = useMeta<string>('proyectoConectado', '')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [probando, setProbando] = useState(false)
  useEffect(() => { setUrl(guardada.url); setToken(guardada.token) }, [guardada.url, guardada.token])
  const conectada = !!guardada.url && !!guardada.token

  async function probar() {
    setProbando(true)
    const c = { url: url.trim(), token: token.trim() }
    await guardarMeta('conexion', c)
    const p = await ping(c.url)
    const proyecto = p.tipo === 'ok' && p.data.proyecto ? ` …${p.data.proyecto}` : ''
    await guardarMeta('proyectoConectado', proyecto.trim())
    if (p.tipo !== 'ok' || p.data.app !== 'precios-mercado') {
      setResultado({ ok: false, texto: p.tipo === 'desconocido' ? 'No responde. Revisa que la dirección termine en /exec y que el acceso sea “Cualquier persona”.' : 'Esa dirección no es la de tu copia en Google.' })
    } else if (p.data.configurado === false) {
      setResultado({
        ok: false,
        texto: `Esa dirección es de un proyecto de Apps Script sin configurar (proyecto${proyecto}). Copia la URL del proyecto donde ejecutaste “inicializarHoja”: Implementar → Gestionar implementaciones. El registro de “inicializarHoja” dice el proyecto y su URL.`,
      })
    } else {
      const d = await llamar<{ pestanasFaltantes: string[] }>(c, 'diag')
      if (d.tipo === 'ok') {
        setResultado(d.data.pestanasFaltantes.length
          ? { ok: false, texto: `Conectado, pero al Sheet le faltan pestañas. En Apps Script ejecuta “inicializarHoja”.` }
          : { ok: true, texto: `✔ Conectado${proyecto ? ` al proyecto${proyecto}` : ''}. Copiando tus datos…` })
        await guardarMeta('estadoSync', { enCurso: false, ultimoOk: null, error: null })
        await sincronizar({ completo: true })
      } else setResultado({ ok: false, texto: d.tipo === 'error' && d.codigo === 'token_invalido' ? 'La clave no coincide. Cópiala otra vez del registro de “inicializarHoja”.' : d.tipo === 'error' ? d.mensaje : 'Sin respuesta. ¿Hay señal?' })
    }
    setProbando(false)
  }

  return (
    <Tarjeta className="space-y-3">
      {conectada ? (
        sync.error ? (
          <p className="text-sm font-medium text-peligro">✘ No se está guardando en Google: {sync.error}</p>
        ) : sync.ultimoOk ? (
          <p className="text-sm">
            <span className="font-semibold text-ok">✔ Copia activa{proyectoConectado ? ` (proyecto ${proyectoConectado})` : ''}.</span> Última vez: {hora(sync.ultimoOk)}
            {pendientes > 0 && ` · ${pendientes} cambios por enviar`}
          </p>
        ) : (
          <p className="text-sm text-stone-700">Todavía no se ha guardado nada en Google. Toca “Guardar y probar”.</p>
        )
      ) : (
        <p className="text-sm text-stone-700">
          Opcional. Guarda tus datos en un Google Sheet tuyo (por si pierdes el celular) y trae los precios de Éxito y Olímpica.
          Los pasos están en la guía: <a className="text-marca underline" href="https://github.com/robinszuniga/precios-mercado#puesta-en-marcha-una-sola-vez" target="_blank" rel="noreferrer">cómo crear la copia</a>.
        </p>
      )}
      <Campo etiqueta="Dirección de la aplicación web (termina en /exec)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" inputMode="url" autoComplete="off" />
      <Campo etiqueta="Clave (token)" value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" ayuda="Sale en el registro al ejecutar “inicializarHoja”. Solo se guarda en este celular." />
      <Boton className="w-full" onClick={probar} disabled={probando || !url || !token}>{probando ? 'Probando…' : 'Guardar y probar'}</Boton>
      {resultado && (resultado.ok ? <p role="status" className="text-sm font-medium text-ok">{resultado.texto}</p> : <ErrorTexto>{resultado.texto}</ErrorTexto>)}
      {conectada && <Boton variante="secundario" className="w-full" onClick={() => void sincronizar()}>Sincronizar ahora</Boton>}
    </Tarjeta>
  )
}

function Regiones() {
  const cat = useCatalogo()
  const conexionActiva = useMeta<Conexion>('conexion', { url: '', token: '' })
  const [msg, setMsg] = useState('')
  if (!cat) return null
  async function probar(t: TiendaVtex) {
    setMsg(`Consultando ${INFO_TIENDAS[t].nombre}…`)
    const r = await llamar<{ region: RegionGuardada | null }>(await conexion(), 'probarRegion', { tienda: t })
    setMsg(r.tipo === 'ok' ? `${INFO_TIENDAS[t].nombre}: ${r.data.region?.localizada ? 'atiende Riohacha' : 'no atiende Riohacha (precio nacional)'}` : r.tipo === 'error' ? r.mensaje : 'Sin respuesta')
    void sincronizar()
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
            {conexionActiva.url && <Boton variante="fantasma" onClick={() => void probar(t)}>Probar</Boton>}
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
  useEffect(() => { void navigator.storage?.persisted?.().then(setPersistente) }, [])
  async function respaldo() {
    const datos: Record<string, unknown> = {}
    for (const t of ['config', 'categorias', 'productos', 'presentaciones', 'preciosActuales', 'compras', 'detalle', 'resumen', 'historial', 'outbox']) {
      datos[t] = await db.table(t).toArray()
    }
    const blob = new Blob([JSON.stringify({ app: 'precios-mercado', fecha: new Date().toISOString(), datos }, null, 1)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `precios-mercado-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    await guardarMeta('ultimoRespaldo', Date.now())
    avisar('Respaldo descargado')
  }
  return (
    <Tarjeta className="space-y-2 text-sm">
      <p>{persistente ? '✔ El celular protege estos datos.' : persistente === false ? 'El celular podría borrar estos datos si le falta espacio. Instala la app para protegerlos.' : ''}</p>
      <Boton variante="secundario" className="w-full" onClick={() => void respaldo()}>Descargar respaldo (archivo)</Boton>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-marca">Instalar la app en el celular</summary>
        <ul className="list-disc space-y-1 pl-5 text-stone-700">
          <li><strong>Android (Chrome):</strong> menú ⋮ → Instalar app.</li>
          <li><strong>iPhone (Safari):</strong> botón Compartir → Agregar a inicio.</li>
          <li>Instala primero y configura desde la app instalada: en iPhone no comparte datos con Safari.</li>
        </ul>
      </details>
    </Tarjeta>
  )
}

function Avanzado() {
  const [d, setD] = useState<Record<string, unknown> | null>(null)
  const [msg, setMsg] = useState('')
  const rechazados = useLiveQuery(() => db.rechazados.toArray(), []) ?? []
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  async function cargar() {
    const r = await llamar<Record<string, unknown>>(await conexion(), 'diag')
    if (r.tipo === 'ok') setD(r.data)
    else setMsg(r.tipo === 'error' ? r.mensaje : r.motivo)
  }
  const log = (d?.log as { fecha: string; nivel: string; mensaje: string }[] | undefined) ?? []
  const job = d?.job as { estado: string; fin: string | null; errores: string[] } | null | undefined
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
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={() => void sincronizar({ completo: true })}>Bajar todo de nuevo</Boton>
          <Boton variante="secundario" className="flex-1" onClick={() => void cargar()}>Ver servidor</Boton>
        </div>
        {msg && <ErrorTexto>{msg}</ErrorTexto>}
        {d && (
          <>
            <p>Tareas programadas: {(d.triggers as string[]).join(', ') || 'ninguna'}</p>
            {job && <p>Última actualización de precios: {job.estado} {job.fin?.slice(0, 16).replace('T', ' ')} {job.errores.length ? `· ${job.errores.length} errores` : ''}</p>}
            {job?.errores.slice(-5).map((e, i) => <p key={i} className="text-xs text-peligro">{e}</p>)}
            <ul className="space-y-1 text-xs">{log.map((l, i) => <li key={i}>{l.fecha.slice(5, 16).replace('T', ' ')} [{l.nivel}] {l.mensaje}</li>)}</ul>
          </>
        )}
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
      <Seccion titulo="Copia en Google y precios de internet">
        <CopiaGoogle />
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
