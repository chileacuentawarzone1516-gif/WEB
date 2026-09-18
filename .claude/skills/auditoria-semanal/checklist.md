# Checklist de auditoría por área

Lista de comprobación concreta para este proyecto. El método está en
`SKILL.md`; esto es el "qué mirar". No es genérico: cada punto existe
porque este sitio tiene esa superficie.

---

## Semana 1 — Seguridad y autorización

### `firestore.rules` (607 líneas, 8 bloques `match`)

Colecciones a auditar: `vehicles/{id}`, `users/{uid}`,
`users/{uid}/favorites`, `users/{uid}/history`, `users/{uid}/quotes`,
`users/{uid}/preferences`, `config/{docId}`, y el `match /{document=**}`
final.

- [ ] El `match /{document=**}` final sigue denegando todo. Es la red de
      seguridad: cualquier colección nueva nace cerrada.
- [ ] `canManageVehicles()` / `canManageUsers()` coinciden con
      `ROLE_PERMISSIONS` de `roles.js`. Un rol que pueda más en las Rules
      que en la UI es una escalada de privilegios silenciosa.
- [ ] Ningún camino permite que un usuario se auto-asigne `role: admin` o
      `status: active`. Comprobar específicamente el `update` de
      `users/{uid}`: ¿puede el propio usuario tocar `role` o `status`?
- [ ] `create` y `update` tienen validaciones **equivalentes**. El hueco
      clásico: `create` valida el esquema y `update` no, así que se crea
      un documento válido y luego se muta a cualquier cosa.
- [ ] `soloCamposPermitidos()` sigue cubriendo todos los campos que
      escribe `app.js`. Si el formulario de publicación añadió un campo y
      la función no lo lista, la publicación falla contra las Rules
      reales — ese bug exacto ya ocurrió (ver `RELEASE_NOTES.md`).
- [ ] `createdAtInmutable()` no se puede sortear enviando el campo
      ausente.
- [ ] `isWhitelistedAdminEmail()`: ¿de dónde sale el correo? Si viene de
      `request.auth.token.email`, comprobar que el proveedor lo verifica.
- [ ] Sub-colecciones de `users/{uid}`: el `uid` del path debe coincidir
      con `request.auth.uid` en lectura **y** escritura. Un usuario no
      puede leer las cotizaciones de otro.
- [ ] `config/{docId}`: lectura pública está bien (la tasa la necesita el
      cliente); escritura solo admin.
- [ ] Reglas que dependan de `get()` / `exists()`: cada una cuesta una
      lectura facturada por evaluación. Contar cuántas hay en el camino
      caliente (`vehicles` read).

### Autenticación y sesión

- [ ] `auth.js`: los errores de Firebase Auth no se muestran crudos al
      usuario (filtran si un correo existe → enumeración de cuentas).
- [ ] Un usuario con `status: disabled` no puede operar: comprobar que la
      UI **y** las Rules lo bloquean, no solo la UI.
- [ ] El estado de sesión no se cachea en `localStorage` de forma que
      sobreviva a un cierre de sesión.
- [ ] App Check: sigue declarado en `index.html` y el README recuerda que
      debe estar en modo *Enforcement* en la consola.

### Frontera servidor

- [ ] `netlify/functions/enviar-cotizacion.js`: el destinatario se lee de
      `COTIZACION_EMAIL_TO`, **nunca** del cuerpo de la petición (si no,
      es un relay de spam firmado con el dominio del negocio).
- [ ] Esa función valida y acota el tamaño de lo que recibe antes de
      adjuntarlo a un correo.
- [ ] `netlify/edge-functions/vehicle-og.js`: el `slug` que llega por URL
      se sanea antes de interpolarlo en el HTML de las meta tags
      (inyección en `og:title` / `og:description`).
- [ ] `cloudinary-sign-worker.js`: la firma se emite solo a usuarios
      autorizados, y `allowed_formats` sigue siendo deuda conocida
      declarada (no un olvido nuevo).

### CSP y cabeceras

- [ ] Cada dominio de la CSP sigue usándose. Uno que sobra es superficie
      de ataque gratis.
- [ ] `script-src` sin `'unsafe-inline'` ni `'unsafe-eval'` (lo vigila
      `tools/verificar.sh`, pero revisar si algo lo "necesita" de nuevo).
- [ ] `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`
      siguen ahí.
- [ ] Ningún `innerHTML` recibe texto de Firestore sin escapar. Buscar:
      `grep -n 'innerHTML' *.js` y revisar el origen de cada valor. Los
      datos de un vehículo los escribe un admin, pero un admin
      comprometido no debe poder inyectar script en la vista pública.

---

## Semana 2 — Rendimiento y Core Web Vitals

- [ ] **LCP:** el `<link rel="preload">` del hero apunta a la imagen que
      se muestra de verdad en el primer slide. Si el carrusel cambió de
      orden, el preload está calentando la imagen equivocada.
- [ ] Las imágenes del hero siguen siendo URLs de Pexels (tarea pendiente
      del propietario: migrar a Cloudinary). Verificar que al menos van
      con `w=` acotado y `fetchpriority="high"` solo en la primera.
- [ ] **CLS:** toda imagen del catálogo y de la ficha tiene `width`/
      `height` o `aspect-ratio` en CSS. Sin eso, cada foto que carga
      empuja el contenido.
- [ ] **INP:** el render del catálogo (`app.js`) no construye todas las
      tarjetas en un bucle síncrono largo sobre un inventario grande.
- [ ] `loading="lazy"` en todo lo que no está en la primera pantalla;
      `loading="eager"` solo arriba.
- [ ] Los 11 scripts `defer` siguen siendo necesarios y en el orden
      correcto. Candidatos a carga diferida por interacción:
      `calculadora.js`, `dashboard.js`, `media-upload.js` — nadie los
      necesita hasta que se abre ese flujo.
- [ ] `cotizacion-pdf.js` y `pdf-core.js` siguen entrando solo por
      `import()` dinámico.
- [ ] `tailwind.css` (18 KB) + `styles.css` (55 KB): ¿hay reglas muertas?
      No reescribir a mano; solo medir y reportar.
- [ ] Consultas a Firestore: `onSnapshot` sobre la colección completa de
      vehículos crece con el inventario. Evaluar `limit()` + paginación
      cuando el catálogo pase de unas decenas.
- [ ] Ninguna consulta lee un documento para descartarlo en el cliente
      (filtrar en la query, no después).
- [ ] `netlify.toml`: todo archivo servido tiene su regla de
      `Cache-Control`. Un archivo nuevo sin regla cae en la heurística
      por defecto.

---

## Semana 3 — SEO y accesibilidad

### SEO

- [ ] `index.html` y las 4 páginas de `empresa/` + 2 legales: `title`
      único, `description` única, `canonical` correcta, `og:*` y
      `twitter:*` completos.
- [ ] JSON-LD válido y coherente con lo que se ve: `AutoDealer` /
      `Vehicle` / `BreadcrumbList` / `FAQPage`. Los precios del JSON-LD
      deben respetar la regla de moneda (nunca `price` de un USD).
- [ ] Un solo `<h1>` por documento; jerarquía `h2`/`h3` sin saltos.
- [ ] `sitemap.xml`: las 4 páginas de empresa, las 2 legales, la home y
      las fichas de vehículo. `lastmod` real, no fijo.
- [ ] `robots.txt` no bloquea nada indexable y declara el sitemap.
- [ ] La Edge Function `vehicle-og` devuelve 404 real para un vehículo que
      no existe (no un 200 con la home dentro: eso es un soft 404).
- [ ] Toda ruta `/empresa/*` inexistente sigue dando 404 real.
- [ ] Sin contenido duplicado: el 301 de `/terminos-condiciones.html`
      sigue en pie.

### Accesibilidad (WCAG 2.1 AA)

- [ ] Cada modal (lightbox, publicar/editar, eliminar, calculadora,
      invitación, login/registro): foco atrapado dentro, `Escape` cierra,
      el foco vuelve al disparador, `aria-modal="true"` y `role="dialog"`.
- [ ] El contador de scroll compartido (`window.LB_SCROLL_LOCK`) lo usan
      **todos** los modales. Uno que toque `body.style.overflow` a mano
      rompe a los demás.
- [ ] Todo control tiene nombre accesible: `<select>` de moneda,
      botones de solo icono (flechas del carrusel, dots, cerrar),
      campos del formulario de publicación. Un `<select>` sin nombre ya
      fue un hallazgo crítico de axe en este proyecto.
- [ ] Navegación completa con teclado: catálogo → ficha → calculadora →
      enviar, sin ratón. Foco visible en cada paso.
- [ ] Contraste AA en texto sobre el hero y en los estados hover.
- [ ] `alt` descriptivo en las fotos de vehículo (marca, modelo, año),
      vacío en las decorativas.
- [ ] Errores de formulario asociados con `aria-describedby`, no solo
      color.
- [ ] `prefers-reduced-motion`: el carrusel ya lo respeta. Verificar que
      las transiciones nuevas también.

---

## Semana 4 — Calidad de código y UX

- [ ] Duplicación real: `media-model.js` es el único intérprete del campo
      `media` (la copia de `vehicle-og.js` es intencional, corre en Deno).
      Verificar que `app.js` y `dashboard.js` no reimplementaron nada de
      eso por su cuenta.
- [ ] `app.js` (3.395 líneas) — candidatos a extraer a módulo propio, con
      criterio: un módulo nuevo solo se justifica si tiene una
      responsabilidad clara y reduce el acoplamiento. Extraer por tamaño
      y nada más deja peor el proyecto.
- [ ] Toda dependencia entre scripts pasa por `LBBoot`. Buscar llamadas
      cruzadas sin compuerta: es el defecto C-1 histórico.
- [ ] Errores: nada de `catch {}` vacío ni `console.log` de depuración
      olvidado. Un fallo de red debe decirle al usuario qué pasó.
- [ ] Estados de la UI: cargando, vacío, error y éxito existen en cada
      flujo (catálogo vacío ya fue un hallazgo: no ofrecía salida).
- [ ] Responsive real a 320, 360, 390, 768, 1024, 1440 px: sin
      desbordamiento horizontal. Atención a la barra `.nav--admin`, que ya
      sacó el botón "Publicar" de la pantalla en móvil.
- [ ] `styles.css`: sin `!important` nuevos, sin z-index arbitrarios (el
      empate de z-index ya tapó los dots del carrusel).
- [ ] Documentación al día: `README.md` y `RELEASE_NOTES.md` deben
      describir el código que existe hoy. Una deuda ya pagada que sigue
      declarada como pendiente hace perder tiempo en cada auditoría
      siguiente.
