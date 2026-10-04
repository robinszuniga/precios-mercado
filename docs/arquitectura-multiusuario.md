# Arquitectura para varios usuarios

## Experiencia que queremos

1. La persona abre la app y entra con su cuenta. No crea un Google Sheet, no publica Apps Script y no copia tokens.
2. La app guarda su lista, compras, precios e historial en una base de datos en la nube y conserva una copia local para usarla sin señal.
3. Si quiere sus datos en una hoja de cálculo, descarga un archivo compatible con Google Sheets. Más adelante podemos ofrecer “Crear mi copia en Google Sheets” como opción; no será un requisito para usar la app.
4. La app puede importar la información de la instalación personal actual para que el cambio no obligue a volver a empezar.

## Propuesta técnica

- **Supabase Auth + PostgreSQL** para cuentas y datos de usuario. La app está construida alrededor de tablas relacionales y sincronización incremental, así que Postgres encaja mejor que guardar listas grandes como documentos.
- Cada registro privado tendrá `user_id` ligado a `auth.users`. Las políticas de Row Level Security limitarán cada lectura y escritura a `auth.uid()`; las escrituras no confiarán en un `user_id` enviado por el navegador.
- La app usará la clave pública del proyecto con la sesión del usuario. Una clave `service_role` o equivalente que omita RLS vivirá solo en tareas del servidor; nunca en GitHub Pages, el bundle web ni el dispositivo.
- Los datos locales de IndexedDB se separarán por cuenta. Cerrar sesión limpiará la sesión y cambiar de cuenta no mostrará datos locales de la cuenta anterior.
- Las consultas de precios pasan por `supabase/functions/vtex/`, con JWT verificado, acciones y tiendas permitidas, límites por usuario/globales y llamadas solo a los hosts configurados en `shared/src/tiendas.ts`. Las búsquedas usan endpoints públicos de VTEX; cada persona no necesita token de Apps Script.
- La actualización manual de precios de presentaciones vinculadas ya pasa por la función de VTEX y sincroniza los resultados bajo RLS. La actualización diaria programada de la versión personal anterior todavía no está migrada.

El código local incluye inicio de sesión Google, IndexedDB separada por id de cuenta, sincronización privada por RLS y consultas de tiendas desde la función VTEX. El proyecto cloud existe, pero su panel todavía no muestra tablas ni migraciones aplicadas, y Google OAuth está desactivado. Falta configurar OAuth, aplicar ambas migraciones, desplegar la función, configurar variables de despliegue y revisar el flujo con dos cuentas. El sitio publicado sigue siendo la versión anterior hasta que se despliegue el cambio.

## Google Sheets

La base de datos de la app será la copia automática y principal. Así evitamos que cada persona haga la configuración avanzada de Apps Script y que un token común dé acceso a los datos de todos.

Para una primera versión sencilla, ofreceremos exportar los datos a CSV (y luego Excel) para abrirlos en Google Sheets. Si los usuarios piden una hoja sincronizada, la app podrá crear un archivo propio en su Drive tras una autorización separada. Usaríamos el alcance limitado `drive.file`, recomendado por Google para los archivos que crea o utiliza la app; no pediremos acceso a todo el Drive. Esa autorización requiere configuración y verificación del producto una sola vez por quien publica la app, no configuración técnica de cada usuario.

La instalación actual de Apps Script seguirá siendo compatible durante la migración. No se reutilizará una misma URL/token/Sheet como almacén de varias cuentas.

## Orden de trabajo

1. Crear un proyecto cloud y configurar Google como proveedor de acceso una sola vez para la app.
2. Revisar la migración SQL con el esquema real y aplicar las políticas RLS.
3. Aplicar la migración, habilitar Google y guardar las variables públicas de despliegue.
4. Probar login, salida, cambio de cuenta, cola offline e importación/restauración con dos cuentas.
5. Desplegar la función VTEX y probar búsquedas/actualizaciones con límites y sin registrar secretos.
6. Exportar a CSV para abrir los datos propios en Sheets.
7. Invitar a un grupo pequeño y publicar solo tras revisar el aislamiento y recuperación.

## Decisiones de seguridad

- Denegar por defecto: usuarios anónimos no leen ni escriben datos privados.
- Activar RLS y conceder solo los permisos necesarios en cada tabla; una política sin permisos SQL correctos no basta.
- El servidor deriva el propietario de la sesión validada; nunca autoriza por un ID enviado por el cliente.
- Aplicar límites por cuenta a consultas online y tareas costosas. Proteger tareas programadas con secretos del servidor.
- No registrar tokens, precios asociados a una cuenta, ni cuerpos completos de sincronización en logs operativos.
- Probar cada política con más de una cuenta antes de aceptar usuarios reales.

## Referencias

- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Alcances OAuth de Google Sheets](https://developers.google.com/workspace/sheets/api/scopes)
- [Precios de Supabase](https://supabase.com/pricing)
