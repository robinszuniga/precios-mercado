import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import type { RegionGuardada } from '@shared/config.ts'
import { INFO_TIENDAS, TIENDAS_VTEX, type TiendaVtex } from '@shared/tiendas.ts'
import { Boton, Campo, Tarjeta, Titulo } from '../componentes/ui.tsx'
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

function SeccionConexion() {
  const guardada = useMeta<Conexion>('conexion', { url: '', token: '' })
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [resultado, setResultado] = useState('')
  const [probando, setProbando] = useState(false)
  useEffect(() => { setUrl(guardada.url); setToken(guardada.token) }, [guardada.url, guardada.token])

  async function probar() {
    setProbando(true)
    const c = { url: url.trim(), token: token.trim() }
    await guardarMeta('conexion', c)
    const p = await ping(c.url)
    if (p.tipo !== 'ok' || p.data.app !== 'precios-mercado') {
      setResultado(p.tipo === 'desconocido' ? `No responde (${p.motivo}). Revisa la URL /exec y que el acceso sea "Cualquier persona".` : 'Esa URL no es el backend de esta app.')
    } else {
      const d = await llamar<{ pestanasFaltantes: string[] }>(c, 'diag')
      if (d.tipo === 'ok') {
        setResultado(d.data.pestanasFaltantes.length ? `Conectado, pero faltan pestañas: ${d.data.pestanasFaltantes.join(', ')}. Ejecuta inicializarHoja.` : '✔ Conectado. Descargando tus datos…')
        await guardarMeta('estadoSync', { enCurso: false, ultimoOk: null, error: null })
        await sincronizar({ completo: true })
      } else setResultado(d.tipo === 'error' ? d.mensaje : d.motivo)
    }
    setProbando(false)
  }

  return (
    <Tarjeta className="space-y-3">
      <h2 className="font-semibold">Conexión con tu Google Sheet</h2>
      <Campo etiqueta="URL de la aplicación web (/exec)" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://script.google.com/macros/s/…/exec" inputMode="url" autoComplete="off" />
      <Campo etiqueta="Token" value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" ayuda="Sale en el registro al ejecutar inicializarHoja. Se guarda solo en este celular." />
      <Boton className="w-full" onClick={probar} disabled={probando || !url || !token}>{probando ? 'Probando…' : 'Guardar y probar'}</Boton>
      {resultado && <p className="text-sm" role="status">{resultado}</p>}
    </Tarjeta>
  )
}

function SeccionSync() {
  const sync = useMeta<EstadoSync>('estadoSync', { enCurso: false, ultimoOk: null, error: null })
  const pendientes = useLiveQuery(() => db.outbox.toArray(), []) ?? []
  const rechazados = useLiveQuery(() => db.rechazados.toArray(), []) ?? []
  return (
    <Tarjeta className="space-y-2 text-sm">
      <h2 className="text-base font-semibold">Sincronización</h2>
      <p>Última: {hora(sync.ultimoOk)} {sync.enCurso && '· sincronizando…'}</p>
      {sync.error && <p className="text-peligro">{sync.error}</p>}
      <p>{pendientes.length} envíos pendientes{pendientes[0]?.error && ` · último problema: ${pendientes[0].error}`}</p>
      {rechazados.length > 0 && (
        <details>
          <summary className="cursor-pointer text-peligro">{rechazados.length} cambios rechazados por el servidor</summary>
          <ul className="mt-1 space-y-1 text-xs">{rechazados.slice(-20).map((r) => <li key={r.id}>{r.tabla} {r.filaId}: {r.mensaje}</li>)}</ul>
          <Boton variante="fantasma" onClick={() => void db.rechazados.clear()}>Borrar la lista</Boton>
        </details>
      )}
      <div className="flex gap-2">
        <Boton variante="secundario" className="flex-1" onClick={() => void sincronizar()}>Sincronizar ahora</Boton>
        <Boton variante="secundario" className="flex-1" onClick={() => void sincronizar({ completo: true })}>Bajar todo</Boton>
      </div>
    </Tarjeta>
  )
}

function SeccionConfig() {
  const cat = useCatalogo()
  if (!cat) return null
  const c = cat.cfg
  const campo = (clave: string, etiqueta: string, valor: number, ayuda?: string) => (
    <Campo
      key={`${clave}-${valor}`}
      etiqueta={etiqueta}
      defaultValue={String(valor).replace('.', ',')}
      inputMode="decimal"
      ayuda={ayuda}
      onBlur={(e) => {
        const n = Number(e.target.value.replace(/\./g, '').replace(',', '.'))
        if (Number.isFinite(n) && n !== valor) void guardarConfig(clave, String(n))
      }}
    />
  )
  return (
    <Tarjeta className="space-y-3">
      <h2 className="font-semibold">Reglas</h2>
      {campo('vigencia_tienda_amarillo_dias', 'Precio de tienda al día (días)', c.vigencias.tiendaAmarillo, 'Después se muestra en amarillo.')}
      {campo('vigencia_tienda_max_dias', 'Precio de tienda vencido (días)', c.vigencias.tiendaMax, 'Después ya no cuenta para recomendar.')}
      {campo('vigencia_auto_dias', 'Precio online vale (días)', c.vigencias.auto)}
      {campo('alerta_presupuesto', 'Alerta de presupuesto (0,85 = 85 %)', c.alertaPresupuesto)}
      {campo('ahorro_minimo_tienda', 'Costo de ir a otra tienda ($)', c.ahorroMinimoTienda, 'El plan solo propone otra tienda si ahorras más que esto.')}
    </Tarjeta>
  )
}

function SeccionRegiones() {
  const cat = useCatalogo()
  const [msg, setMsg] = useState('')
  if (!cat) return null
  async function probar(t: TiendaVtex) {
    setMsg(`Consultando ${INFO_TIENDAS[t].nombre}…`)
    const r = await llamar<{ region: RegionGuardada | null }>(await conexion(), 'probarRegion', { tienda: t })
    setMsg(r.tipo === 'ok' ? `${INFO_TIENDAS[t].nombre}: ${r.data.region?.localizada ? 'atiende Riohacha' : 'no atiende Riohacha (precio nacional)'}` : r.tipo === 'error' ? r.mensaje : r.motivo)
    void sincronizar()
  }
  return (
    <Tarjeta className="space-y-2 text-sm">
      <h2 className="text-base font-semibold">Tiendas online y Riohacha</h2>
      {TIENDAS_VTEX.map((t) => {
        const g = cat.cfg.regiones[t]
        return (
          <div key={t} className="flex items-center justify-between gap-2">
            <span>
              {INFO_TIENDAS[t].nombre}:{' '}
              {!g ? 'sin probar' : g.localizada ? 'precio de Riohacha' : t === 'D1' ? 'no atiende Riohacha → manual' : 'precio nacional (online·nac)'}
            </span>
            <Boton variante="fantasma" onClick={() => void probar(t)}>Probar</Boton>
          </div>
        )
      })}
      {msg && <p role="status">{msg}</p>}
      <p className="text-xs text-stone-500">Ara no vende online: sus precios siempre se anotan a mano.</p>
    </Tarjeta>
  )
}

function SeccionDiagnostico() {
  const [d, setD] = useState<Record<string, unknown> | null>(null)
  const [msg, setMsg] = useState('')
  async function cargar() {
    const r = await llamar<Record<string, unknown>>(await conexion(), 'diag')
    if (r.tipo === 'ok') setD(r.data)
    else setMsg(r.tipo === 'error' ? r.mensaje : r.motivo)
  }
  const log = (d?.log as { fecha: string; nivel: string; mensaje: string }[] | undefined) ?? []
  const job = d?.job as { estado: string; fin: string | null; errores: string[] } | null | undefined
  return (
    <Tarjeta className="space-y-2 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Diagnóstico del servidor</h2>
        <Boton variante="fantasma" onClick={() => void cargar()}>Ver</Boton>
      </div>
      {msg && <p className="text-peligro">{msg}</p>}
      {d && (
        <>
          <p>Triggers: {(d.triggers as string[]).join(', ') || 'ninguno'}</p>
          {job && <p>Última actualización de precios: {job.estado} {job.fin?.slice(0, 16).replace('T', ' ')} {job.errores.length ? `· ${job.errores.length} errores` : ''}</p>}
          {job?.errores.slice(-5).map((e, i) => <p key={i} className="text-xs text-peligro">{e}</p>)}
          <details>
            <summary className="cursor-pointer">Registro reciente</summary>
            <ul className="mt-1 space-y-1 text-xs">{log.map((l, i) => <li key={i}>{l.fecha.slice(5, 16).replace('T', ' ')} [{l.nivel}] {l.mensaje}</li>)}</ul>
          </details>
        </>
      )}
    </Tarjeta>
  )
}

function SeccionPasillos() {
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
      <h2 className="mb-1 font-semibold">Orden de los pasillos</h2>
      <p className="mb-2 text-xs text-stone-500">En el orden en que recorres el súper.</p>
      <ul className="divide-y divide-stone-100">
        {cat.categorias.map((c, i) => (
          <li key={c.categoria_id} className="flex items-center justify-between py-1.5">
            <span>{c.nombre}</span>
            <span className="flex gap-1">
              <button type="button" aria-label={`Subir ${c.nombre}`} className="px-2 text-lg" onClick={() => void mover(i, -1)}>↑</button>
              <button type="button" aria-label={`Bajar ${c.nombre}`} className="px-2 text-lg" onClick={() => void mover(i, 1)}>↓</button>
            </span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

function SeccionDispositivo() {
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
  }
  return (
    <Tarjeta className="space-y-2 text-sm">
      <h2 className="text-base font-semibold">Este celular</h2>
      <p>Almacenamiento {persistente ? 'protegido ✔' : persistente === false ? 'puede borrarse si falta espacio (instala la app para protegerlo)' : '—'}</p>
      <Boton variante="secundario" className="w-full" onClick={() => void respaldo()}>Descargar respaldo (JSON)</Boton>
      <details>
        <summary className="cursor-pointer">Instalar en el celular</summary>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-stone-600">
          <li><strong>Android (Chrome):</strong> menú ⋮ → Instalar app.</li>
          <li><strong>iPhone (Safari):</strong> botón Compartir → Agregar a inicio.</li>
          <li>Instala primero y configura la conexión desde la app instalada: en iPhone no comparte datos con Safari.</li>
        </ul>
      </details>
    </Tarjeta>
  )
}

export function Ajustes() {
  return (
    <section className="space-y-3">
      <Titulo>Ajustes</Titulo>
      <SeccionConexion />
      <SeccionSync />
      <SeccionRegiones />
      <SeccionConfig />
      <SeccionPasillos />
      <SeccionDiagnostico />
      <SeccionDispositivo />
      <p className="text-center text-xs text-stone-400">Precios de Mercado · versión {__VERSION__}</p>
    </section>
  )
}
