import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { productoEliminado } from '@shared/esquema.ts'
import { db } from '../datos/db.ts'
import { empezarDeCero } from '../datos/escritura.ts'
import { avisar, Boton, BotonConfirmar, Hoja } from './ui.tsx'

/**
 * Confirmación de «Empezar de cero»: borra todos los productos y pasillos para armar los propios. Dice cuántos son, qué se
 * conserva (el historial de compras) y que no se puede deshacer; «No, conservar» es la salida fácil.
 */
export function EmpezarDeCero({ abierta, onCerrar, onHecho }: { abierta: boolean; onCerrar: () => void; onHecho: () => void }) {
  const [trabajando, setTrabajando] = useState(false)
  const cuentas = useLiveQuery(async () => ({
    productos: (await db.productos.toArray()).filter((p) => !productoEliminado(p)).length,
    pasillos: (await db.categorias.toArray()).filter((c) => !c.borrado).length,
  }), [])
  const productos = cuentas?.productos ?? 0
  const pasillos = cuentas?.pasillos ?? 0
  // Mientras cuenta no se afirma nada: «ya estás de cero» y el botón de borrar solo aparecen con la cuenta hecha.
  const contando = cuentas === undefined
  // Mientras borra, la cuenta baja a 0: no se cambia a «ya estás de cero» antes de que la hoja se cierre sola.
  const nada = !trabajando && productos === 0 && pasillos === 0

  async function confirmar() {
    if (trabajando) return
    setTrabajando(true)
    try {
      await empezarDeCero()
      avisar('Listo, empiezas de cero. Pega tu lista o crea tus productos.')
      onHecho()
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <Hoja abierta={abierta} titulo="Empezar de cero" onCerrar={onCerrar}>
      <div className="space-y-3">
        {contando ? (
          <p role="status">Contando lo que hay…</p>
        ) : nada ? (
          <p>No hay productos ni pasillos que borrar: ya estás de cero.</p>
        ) : (
          <>
            <p>
              Vas a eliminar <strong>{productos} {productos === 1 ? 'producto' : 'productos'}</strong>
              {pasillos > 0 && <> y <strong>{pasillos} {pasillos === 1 ? 'pasillo' : 'pasillos'}</strong></>}, para armar los tuyos.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
              <li>Se borran también sus marcas, tamaños, precios e historial de precios, en todos tus celulares.</li>
              <li>Tus compras pasadas se quedan, con el nombre de cada producto como texto.</li>
              <li><strong>No se puede deshacer.</strong> Si solo quieres quitar algunos, usa «Seleccionar» en Productos.</li>
            </ul>
          </>
        )}
        {/* La salida segura va primero y con el foco, siempre en el mismo lugar (así el foco no se pierde cuando termina de
            contar); lo irreversible, debajo y con una pausa (ver BotonConfirmar). */}
        <Boton variante="secundario" className="w-full" data-autofocus onClick={onCerrar}>{contando || nada ? 'Cerrar' : 'No, conservar'}</Boton>
        {!contando && !nada && (
          <BotonConfirmar className="w-full" disabled={trabajando} onClick={() => void confirmar()}>
            {trabajando ? 'Borrando…' : 'Sí, borrar todo y empezar de cero'}
          </BotonConfirmar>
        )}
      </div>
    </Hoja>
  )
}
