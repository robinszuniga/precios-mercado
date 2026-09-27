# Precios de Mercado

App personal (PWA) para comparar el mercado entre **Éxito, Olímpica, D1 y Ara en Riohacha**, llevar el
presupuesto en vivo mientras compras y saber dónde conviene cada producto.

- Compara por **precio por kg, litro o unidad**: un paquete de 500 g de D1 se compara justo con uno de 1 kg de Éxito.
- **El precio que ves en la tienda manda.** El precio online (Éxito, Olímpica y D1 si atiende Riohacha) es de apoyo y lleva
  un distintivo: `online` si es de Riohacha, `online·nac` si la tienda solo publica el precio nacional.
- Funciona **sin señal** dentro del súper: todo se guarda en el celular y se sincroniza con tu Google Sheet al volver la señal.
- El **plan** solo propone ir a otra tienda si el ahorro paga el viaje (por defecto $3.000 por tienda extra).
- Al cerrar la compra, lo que pagaste queda como precio de tienda y se guarda el resumen: cuánto gastaste y cuánto
  habrías gastado comprando todo en una sola tienda.

## Cómo está hecho

| Parte | Qué es |
|---|---|
| `web/` | La app: React + Vite + Tailwind, instalable, con IndexedDB (Dexie) y cola de envíos. Se publica en GitHub Pages. |
| `apps-script/` | El backend: Google Apps Script sobre tu Sheet. Guarda los datos y trae los precios online una vez al día (6 a. m.) o cuando tocas “Actualizar precios”. |
| `shared/` | La lógica (precio por unidad, qué precio vale, plan, presupuesto, resumen, conector VTEX). Es la misma en la app, el backend y las pruebas. |
| `tools/smoke-vtex.ts` | Prueba real de las APIs de Éxito, Olímpica y D1, incluida la región de Riohacha. |

## Puesta en marcha (una sola vez)

### 1. El Sheet y el backend

1. Crea un Google Sheet nuevo (por ejemplo “Precios Mercado”).
2. En el Sheet: **Extensiones → Apps Script**.
3. En el editor, **Configuración del proyecto** (engranaje) → marca **“Mostrar el archivo de manifiesto appsscript.json”**.
4. Copia el contenido de `apps-script/dist/Code.js` en `Código.gs` (borra lo que traía) y el de
   `apps-script/dist/appsscript.json` en `appsscript.json`. Para generarlos: `npm ci && npm run build:gas`
   (también están en los artefactos del CI).
5. Arriba, elige la función **`inicializarHoja`** y dale **Ejecutar**. Autoriza los permisos
   (si dice “Google no ha verificado esta app”: *Configuración avanzada → Ir a … (no seguro)*: es tu propio script).
   Crea las pestañas, la configuración, el trigger diario y el **token**, que aparece en el *Registro de ejecución*. Cópialo.
6. Ejecuta **`probarTiendas`**. El registro dice si Google puede consultar cada tienda y si cada una tiene precio para
   Riohacha. D1 queda automático solo si atiende Riohacha.
7. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona** (no “cualquier persona con cuenta de Google”)
   Copia la URL que termina en `/exec`.

> Para actualizar el backend después: pega el nuevo `Code.js` y ve a **Implementar → Gestionar implementaciones →
> ✏️ → Versión: Nueva versión**. Así la URL `/exec` no cambia. No crees una implementación nueva.

### 2. La app en el celular

1. Abre `https://robinszuniga.github.io/precios-mercado/` en el celular.
2. **Instálala primero**:
   - Android (Chrome): menú ⋮ → **Instalar app**.
   - iPhone (Safari): **Compartir → Agregar a inicio**.
3. Abre la app instalada → **Ajustes** → pega la URL `/exec` y el token → **Guardar y probar**.

En iPhone la app instalada no comparte datos con Safari: por eso se configura desde la app instalada.

## Uso

1. **Productos**: crea tus productos (★ = entra solo en cada compra) o empieza con la lista típica. En cada producto:
   - **Anotar precio**: lo que ves en la tienda (marca, tamaño y precio). Avisa si el precio parece mal escrito.
   - **Buscar online**: busca en Éxito, Olímpica o D1, eliges el producto exacto y con su código de barras la app lo busca en las demás.
2. **Plan**: marca las tiendas que visitas hoy y mira dónde comprar cada cosa y por qué. Toca un producto para cambiar
   la cantidad de esta vez, fijar la tienda o quitarlo.
3. **Compra**: pon el presupuesto, marca lo que echas al carrito (el círculo lo marca de una si el precio ya lo viste
   en la tienda) y cierra la compra. Solo los precios que confirmaste quedan como precio de tienda.
4. **Historial**: cómo cambian los precios de cada producto, el resumen de cada compra y lo gastado en el mes.

Las tiendas se muestran con su logo (el ícono que publica cada una en su página; no se copia al repo). Si no carga,
se ve su letra: É, O, D1, A.

La auditoría de experiencia de uso y las capturas antes y después de las mejoras están en `docs/ux/`.

## Desarrollo

```bash
npm ci
npm run dev          # app en http://localhost:5173/precios-mercado/
npm test             # pruebas (shared, apps-script, web)
npm run typecheck
npm run build        # web/dist y apps-script/dist/Code.js
npm run smoke        # prueba real contra las tiendas (necesita salida a exito.com, olimpica.com, d1.com.co)
```

El workflow **Smoke test VTEX** (Actions → Run workflow) hace la misma prueba desde los servidores de GitHub y guarda
las respuestas como fixtures.

### Si Google no puede consultar las tiendas

Si `probarTiendas` dice que Éxito/Olímpica bloquean a Google (403 o páginas de desafío), el plan B es que una GitHub
Action consulte los precios cada día y los escriba en el Sheet a través del mismo API (`upsert` de observaciones).
El conector ya está separado en `shared/src/vtex/` para eso.
