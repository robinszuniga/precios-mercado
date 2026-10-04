# Precios de Mercado

App personal (PWA) para comparar el mercado entre **Éxito, Olímpica, D1 y Ara en Riohacha**, llevar el
presupuesto en vivo mientras compras y saber dónde conviene cada producto.

> **Multiusuario en preparación:** el sitio publicado aún es la versión personal antigua y usa Apps Script. El código local
> ya guarda los datos por cuenta en Supabase y consulta VTEX mediante una función autenticada del servidor. En esa versión
> cada persona podrá buscar precios sin crear una hoja ni copiar un token. Falta desplegar la función, configurar Google OAuth
> y publicar la app; las actualizaciones de precios programadas también quedan pendientes.

- Compara por **precio por kg, litro o unidad**: un paquete de 500 g de D1 se compara justo con uno de 1 kg de Éxito.
- **El precio que ves en la tienda manda.** El precio online (Éxito, Olímpica y D1 si atiende Riohacha) es de apoyo y lleva
  un distintivo: `online` si es de Riohacha, `online·nac` si la tienda solo publica el precio nacional. La etiqueta
  también muestra cuándo se verificó por última vez.
- Funciona **sin señal** dentro del súper: todo se guarda en el celular y se sincroniza con la nube al volver la señal.
- El **plan** solo propone ir a otra tienda si el ahorro paga el viaje (por defecto $3.000 por tienda extra).
- Al cerrar la compra, lo que pagaste queda como precio de tienda y se guarda el resumen: cuánto gastaste y cuánto
  habrías gastado comprando todo en una sola tienda.

## Cómo está hecho

| Parte | Qué es |
|---|---|
| `web/` | La app: React + Vite + Tailwind, instalable, con IndexedDB (Dexie) y cola de envíos. Se publica en GitHub Pages. |
| `apps-script/` | Backend heredado de la versión personal: guarda los datos en un Sheet y consulta las tiendas. La versión multiusuario usa Supabase y la función `supabase/functions/vtex/`. |
| `shared/` | La lógica (precio por unidad, qué precio vale, plan, presupuesto, resumen, conector VTEX). Es la misma en la app, el backend y las pruebas. |
| `tools/smoke-vtex.ts` | Prueba real de las APIs de Éxito, Olímpica y D1, incluida la región de Riohacha. |

## Instalación de la versión personal antigua

Estas instrucciones son para quienes ya usan la versión publicada anterior. La futura versión multiusuario no pedirá que cada
persona configure Apps Script ni una hoja. No reutilices una misma hoja/token para varias cuentas.

## Puesta en marcha de la versión personal (Apps Script)

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

**Cargador v2** (opcional; el v1 sigue funcionando). Se pega igual que el primero y agrega:
la huella sha256 del `Code.js` (no se instala un código que no coincida con la de `version.json`), nunca baja de
versión sola, solo sigue redirecciones a GitHub y reintenta a los 10 minutos si algo falló (el v1 espera 6 horas).
Se sabe cuál tienes en *Ajustes → Script de Google* o en el registro de `actualizarme`.

**Volver a una versión anterior.** El cargador nunca baja de número: para deshacer una versión, se corrige el código
en el repositorio y se publica una versión *mayor* (gas-v6 con lo de gas-v4). Si el script quedó inservible, pega el
`Code.js` de un release bueno en `Código.gs` (como en la primera instalación).

> El cargador ejecuta lo que se publique en los releases de este repositorio: quien pueda publicar aquí puede cambiar
> el código que corre con tu cuenta de Google. Por eso conviene: verificación en dos pasos con llave de acceso en
> GitHub, activar *Settings → Releases → Enable release immutability* y no renombrar tu usuario de GitHub (otro podría
> registrar el nombre viejo). El flujo que publica el script compila sin permiso de escritura y solo un segundo
> trabajo, que no ejecuta código del proyecto, crea el release.

### 2. La app en el celular

1. Abre `https://robinszuniga.github.io/precios-mercado/` en el celular.
2. **Instálala primero**:
   - Android (Chrome): menú ⋮ → **Instalar app**.
   - iPhone (Safari): **Compartir → Agregar a inicio**.
3. Abre la app instalada → **Ajustes** → pega la URL `/exec` y el token → **Guardar y probar**.

En iPhone la app instalada no comparte datos con Safari: por eso se configura desde la app instalada.

## Preparar cuentas de usuario (versión multiusuario)

La persona administradora aplica las migraciones `supabase/migrations/`, despliega `supabase/functions/vtex/` y habilita
Google en Authentication → Sign In / Providers. La función solo acepta sesiones válidas, limita consultas por cuenta y
llama a los catálogos públicos de VTEX; no admite direcciones arbitrarias. En Google Cloud registra el cliente OAuth web
y copia el callback de Supabase. En Supabase define la URL permitida de la app. Configura `VITE_SUPABASE_URL` y
`VITE_SUPABASE_ANON_KEY` como variables de GitHub Actions. La clave publicable está diseñada para el navegador; nunca
incluyas una `service_role` ni el secreto OAuth en el frontend, el repositorio o este chat.

El código de acceso bloquea la app si falta la configuración. Antes de invitar usuarios, hay que aplicar la segunda
migración de límites, desplegar y probar la función, configurar Google OAuth y publicar el sitio. El código local ya no
pide la URL/token de Apps Script; la actualización manual de precios sustituye por ahora la tarea diaria antigua.

En **Ajustes → Este celular** puedes descargar un respaldo o importar uno. La importación combina los datos con los
de ese celular: si una fila tiene la misma clave, gana la del archivo; las demás se conservan. La conexión y el token
de Google no se incluyen ni se cambian. La importación solo restaura datos en el celular; no los envía automáticamente
al Sheet. Al iniciar sesión, la sincronización de la cuenta restaura los datos privados desde Supabase.

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
3. **Compra**: pon el presupuesto, elige **¿En qué tienda estás?** (la tuya queda abierta y las demás plegadas) y marca
   lo que echas al carrito: el círculo lo marca de una si el precio ya lo viste en la tienda hace menos de una semana
   (si es más viejo, abre la hoja para confirmarlo); el producto se queda tachado un segundo y otro toque lo desmarca.
   Abajo, siempre a la vista: 📷 anotar precios, **+ Agregar** (un producto tuyo o “algo que no está en mis productos”)
   y **Terminar**. Solo los precios que confirmaste quedan como precio de tienda.
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

## Accesibilidad y letra grande

- Lo más chico de la app es de 13 px; con la letra grande del sistema (hasta 150 %) los botones no se salen de la
  pantalla, los nombres de los productos conservan ancho y la barra de abajo entra completa.
- Con una hoja abierta (anotar precio, agregar, etc.) lo de atrás queda inerte: el lector de pantalla y el teclado solo
  ven la hoja. Los avisos con “Deshacer” siguen a mano.
- Si lo último que enviaste lleva más de 15 segundos sin salir (señal “fantasma”: hay conexión pero no responde Google),
  aparece “N por enviar · sin respuesta de Google”.

