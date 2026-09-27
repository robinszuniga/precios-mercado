# Auditoría UX/UI (27-sep-2026)

Dos revisiones independientes sobre 21 capturas y el código: **uso real en el súper** (una mano, poca señal, prisa)
y **diseño visual y accesibilidad** (contraste WCAG, tamaños táctiles, daltonismo). Capturas: `antes/` y `despues/`.

## Qué se encontró y qué se hizo

### Errores reales
| Hallazgo | Cambio |
|---|---|
| Un precio sugerido de internet, aceptado sin mirar, quedaba como "precio de tienda" al cerrar la compra | Solo se guarda como precio de tienda lo que el usuario escribió o cambió, o lo que ya era de tienda y reciente. La hoja dice de dónde viene el sugerido |
| Cambiar de tienda en "Anotar precio" / "Al carrito" pasaba a "otra marca" y creaba presentaciones duplicadas | Se elige la presentación que ya existe en esa tienda; se recuerda la última tienda; se pide confirmar si falta el tamaño o si el precio se aleja más de 50 % del anterior |
| CSS fuera de capa anulaba utilidades de Tailwind v4: botones de las hojas pegados al borde y selector "auto" gigante | Reglas en `@layer base` y `@utility` |
| "Descartar esta compra" con un toque, pegado a "Sí, cerrar" | Enlace aparte con confirmación y Deshacer |
| Quitar presentación, archivar producto e ítem libre sin confirmar ni recuperar | Confirmación o Deshacer; archivados recuperables en Ajustes |

### Compra editable y ordenada
- Quitar productos de la compra y cambiar la cantidad de esta vez (en Plan y en Compra); ✓ en Productos quita con Deshacer.
- Presupuesto editable; la barra avisa en amarillo si con lo que falta te pasarías; "Te quedan" es lo más grande.
- Compra en el orden de los pasillos (con subtítulos); Plan y Compra comparten tiendas del día y su orden.
- Círculo de 44 px que marca de un toque cuando el precio ya es de tienda; avisos con Deshacer; Atrás cierra las hojas;
  la lista conserva el scroll al volver.

### Claridad y diseño
- Plan: total, ahorro y presupuesto arriba; cada producto dice por qué va a esa tienda ("$ 600 menos que en Olímpica");
  "Comprar en" con el precio de cada tienda en vez de "auto"; tiendas incompletas dicen qué les falta.
- Etiquetas en palabras: "en tienda", "online Riohacha", "precio nacional", "en tienda · 45 d"; leyenda explicativa.
- "Mis productos" con filtro "En esta compra"; primer uso en 3 pasos y "lista típica".
- Logos de cada tienda (con letra de respaldo), íconos SVG en la barra, contrastes ≥ 4,5:1, botones de 44 px,
  cifras alineadas, coma decimal ("1,1 L"), gráfico con fechas "3 ago" y sin textos en inglés.
- Ajustes ordenado para el usuario ("Mi mercado" primero, "Avanzado" plegado); historial con resumen del mes.

### Descartado
- "La app nunca pide almacenamiento persistente": falso, lo pide al arrancar.
- Modo oscuro: no por ahora (en el súper y al sol rinde más un claro de alto contraste); se fuerza modo claro para
  que el oscurecimiento automático de algunos navegadores no altere los colores.
