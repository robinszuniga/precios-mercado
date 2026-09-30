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
4. Copia el contenido de `Cargador.js` en `Código.gs` (borra lo que traía) y el de `appsscript.json` en
   `appsscript.json`. Los dos están en el [último release](https://github.com/robinszuniga/precios-mercado/releases/latest)
   (o en `apps-script/dist/` tras `npm ci && npm run build:gas`). El cargador baja solo el resto del código.
5. Arriba, elige la función **`inicializarHoja`** y dale **Ejecutar**. Autoriza los permisos
   (si dice “Google no ha verificado esta app”: *Configuración avanzada → Ir a … (no seguro)*: es tu propio script).
   Crea las pestañas, la configuración, el trigger diario y el **token**, que aparece en el *Registro de ejecución*. Cópialo.
6. Ejecuta **`probarTiendas`**. El registro dice si Google puede consultar cada tienda y si cada una tiene precio para
   Riohacha. D1 queda automático solo si atiende Riohacha.
7. **Implementar → Nueva implementación → Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona** (no “cualquier persona con cuenta de Google”)
   Copia la URL que termina en `/exec`.

### Actualizaciones del script (automáticas)

En Apps Script solo va el **cargador** (`Cargador.js`, unas 170 líneas). Él baja el `Code.js` de la última versión
publicada en [Releases](https://github.com/robinszuniga/precios-mercado/releases) (etiquetas `gas-vN`; nunca un cambio
a medias), lo guarda en las propiedades del script y lo ejecuta. Revisa si hay versión nueva cada mañana, cada 6 horas
al usar la app y con **Ajustes → Script de Google → Actualizar ahora**. No hace falta la API de Apps Script ni volver a
implementar: la URL `/exec` y el token no cambian. Si GitHub no responde, sigue con la versión guardada.

**Si pegaste antes el `Code.js` completo**, cámbialo por el cargador una sola vez:

1. En Apps Script abre `Código.gs`, borra todo y pega el `Cargador.js` del
   [último release](https://github.com/robinszuniga/precios-mercado/releases/latest). Guarda (💾).
2. Pega también su `appsscript.json` (ya no pide permisos para modificar el proyecto).
3. Arriba elige **`actualizarme`** → **Ejecutar**. Acepta los permisos si los pide. El registro dice
   “✔ Instalada la versión gas-vN”.
4. **Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar** (la URL no cambia).

Una versión que pida permisos nuevos no se instala sola: *Ajustes → Script de Google* lo avisa.

> El cargador ejecuta lo que se publique en los releases de este repositorio: quien pueda publicar aquí puede cambiar
> el código que corre con tu cuenta de Google. Protege tu cuenta de GitHub (2FA).

### 2. La app en el celular

1. Abre `https://robinszuniga.github.io/precios-mercado/` en el celular.
2. **Instálala primero**:
   - Android (Chrome): menú ⋮ → **Instalar app**.
   - iPhone (Safari): **Compartir → Agregar a inicio**.
3. Abre la app instalada → **Ajustes** → pega la URL `/exec` y el token → **Guardar y probar**.

En iPhone la app instalada no comparte datos con Safari: por eso se configura desde la app instalada.

## Pasar tu lista

Si ya tienes tu listado en WhatsApp o Notas, no hace falta crear producto por producto:

1. En WhatsApp o Notas, mantén presionada la lista y toca **Copiar**.
2. En la app: **Productos → Pegar mi lista** (o *Pegar lista* arriba a la derecha, o *Ajustes → Pasar mi lista*).
3. Toca **Pegar lo que copiaste** (o mantén presionado el cuadro → Pegar) y luego **Revisar**.
4. Revisa cantidades y unidades (lo marcado en naranja es lo que la app tuvo que adivinar) y toca **Guardar**.

Entiende renglones como `Arroz 5 kg`, `5 kg de arroz`, `Leche x6 L`, `Huevos 30`, `½ libra de queso`,
`1 cubeta de huevos`, `Pasta 4 x 250 g`, con viñetas, numeración, emojis o la hora de WhatsApp. Los títulos
(`Lácteos:`, `*Aseo*`, `CARNES`) se vuelven pasillos. También sirve copiar columnas de Excel o Google Sheets
(producto, cantidad, unidad, pasillo) o abrir un `.txt`/`.csv`. Una libra = 500 g.

Los productos quedan con ★ y entran a la compra de hoy con esa cantidad (las dos casillas se pueden desmarcar).
Si un producto ya existe, se actualiza su cantidad en vez de duplicarlo. Si tu lista es una foto, sácale el texto con
Google Lens (*Copiar texto*) o, en iPhone, manteniendo el dedo sobre el texto de la foto, y pégalo igual.

## Precios de internet, solos

Con la copia en Google activa, la app busca sola en Olímpica y Éxito los productos que todavía no tienen precio de
internet: al abrir la app (una vez al día) y justo después de pegar tu lista.

- Si la coincidencia es **segura** (tiene todas las palabras de tu producto, ninguna que lo cambie —"integral",
  "en polvo", "con pollo"—, tamaño comparable, precio y disponible), lo vincula sin preguntar. Si en la otra tienda
  está el mismo código de barras, lo agrega también.
- Los **dudosos** quedan en *Productos → "N productos sin precio de internet" → Buscar precios*, con la opción más
  parecida ya elegida: confirmas, cambias o marcas "Ninguno".
- Si tu producto lleva la marca en el nombre ("Arroz Diana"), solo se acepta esa marca como segura.
- Después, los precios se actualizan solos cada día a las 6 a. m. D1 y Ara se anotan en la tienda.

## Uso

1. **Productos**: pega tu lista, crea tus productos (★ = entra solo en cada compra) o empieza con la lista típica. En cada producto:
   - **Anotar precio**: lo que ves en la tienda (marca, tamaño y precio). Avisa si el precio parece mal escrito.
   - **Buscar online**: busca en Éxito, Olímpica o D1, eliges el producto exacto y con su código de barras la app lo busca en las demás.
2. **Plan**: marca las tiendas que visitas hoy y mira dónde comprar cada cosa y por qué. Toca un producto para cambiar
   la cantidad de esta vez, fijar la tienda o quitarlo.
3. **Compra**: pon el presupuesto, marca lo que echas al carrito (el círculo lo marca de una si el precio ya lo viste
   en la tienda) y cierra la compra. Solo los precios que confirmaste quedan como precio de tienda.
4. **Historial**: cómo cambian los precios de cada producto, el resumen de cada compra y lo gastado en el mes.

Además:

- **Marca preferida**: en *Editar* de un producto escribe la marca que compras (Diana, Alquería…). Los precios de
  internet se buscan de esa marca y solo esa se vincula sola; si una tienda no la tiene, se queda con lo que había.
- **Enviar la lista por WhatsApp** (en *Plan*): arma el mensaje por tienda con cantidades y precios, para ti o para
  quien vaya a comprar.
- **Novedades** (arriba en *Productos*): lo que bajó o subió 5 % o más en los últimos días (del trabajo diario) y lo
  que sueles comprar cada tanto y ya te toca, con "+ Agregar". Se calcula en el celular a partir de tus compras cerradas.
- **Anotar precios en la tienda** (en *Plan* y *Compra*): eliges la tienda, escaneas el código de barras con la
  cámara y escribes el precio. Un código que ya conoces en otra tienda (la marca es la misma en Olímpica y en D1)
  se reconoce con su tamaño; uno nuevo lo busca en internet, eliges a cuál de tus productos corresponde y de paso
  queda su precio online. Chrome de Android trae lector propio; en iPhone se baja una vez un lector de 1 MB desde
  la misma app. Sin cámara, se escribe el número de debajo de las barras.

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
