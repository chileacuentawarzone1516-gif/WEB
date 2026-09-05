# La Batalla Auto Import

Sitio web de venta y exhibición de vehículos — SPA estática desplegada en Netlify con inventario en Firestore.

**Producción:** https://labatallaautoimport.netlify.app

> **Netlify — Base directory.** `netlify.toml` vive dentro de
> `LaBatallaAutoImport-StarblexFrontend-Reemplazo/`, no en la raíz del
> repositorio. El sitio de Netlify debe tener **Base directory** apuntando a
> esa carpeta; si no, Netlify no encuentra `netlify.toml` y se pierden los
> redirects SPA, los headers de seguridad, la CSP y la Edge Function.

## Estructura

```
├── index.html                 SPA principal (catálogo, fichas, modales)
├── app.js                     Lógica: Firestore, CRUD admin, SEO dinámico, favoritos, galería
├── calculadora.js             Calculadora de financiamiento (modal + FAB)
├── cotizacion-pdf.js          Maquetación de la cotización en PDF — módulo ES, carga bajo demanda
├── pdf-core.js                Motor de PDF propio, sin dependencias — lo usa cotizacion-pdf.js
├── invite-modal.js            Invitación opcional de registro al contactar por WhatsApp
├── logo-labatalla.png         Logo oficial — modal de invitación y membrete del PDF
├── vehicles-demo.js           Datos de ejemplo — solo se descarga si Firebase falla
├── styles.css                 Estilos propios (complementa Tailwind)
├── ficha-vehiculo.css         Especificaciones y características de la ficha de vehículo
├── tailwind.css                Tailwind compilado (no editar a mano)
├── 404.html                   Página de error de Netlify
├── empresa/                   Páginas institucionales (HTML estático, una por sección)
│   ├── por-que-elegirnos.html
│   ├── quienes-somos.html
│   ├── mision-vision.html
│   └── nuestros-valores.html
├── politica-privacidad.html   Página legal
├── terminos-y-condiciones.html Página legal
├── pagina-estatica.css        Estilos compartidos por /empresa/* y las páginas legales
├── site.webmanifest           Web App Manifest (PWA / pantalla de inicio)
├── robots.txt / sitemap.xml   SEO — el sitemap se regenera automáticamente
├── favicon-16.png / favicon-32.png / apple-touch-icon.png / icon192.png / icon512.png
│                               Iconos de marca (símbolo, sin texto — favicon.png ya no se usa)
├── logo-hero.png               Logo completo (con texto), badge en la esquina superior del hero
├── netlify.toml                Redirects SPA, Edge Functions, headers de cache y seguridad
├── firebase.json               Apunta a firestore.rules para deploy de reglas
├── firestore.rules             Reglas de seguridad (lectura pública, escritura solo admin)
│                               ⚠️ Los archivos internos (firestore.rules, firebase.json,
│                               firestore_rules_test.js, cloudinary-sign-worker.js, *.md) NO
│                               se sirven: netlify.toml los devuelve 404 con force = true.
├── scripts/
│   └── generar-sitemap.js      Genera sitemap.xml desde la API REST de Firestore
├── netlify/edge-functions/
│   └── vehicle-og.js           Meta tags OG para bots sociales + 404 real por vehículo
└── .github/workflows/
    └── actualizar-sitemap.yml  Cron diario que regenera y commitea el sitemap
```

## Reglas de sincronización crítica

- El `slug` se genera UNA vez al crear el vehículo y es inmutable. `slugify()` existe en **app.js**, **scripts/generar-sitemap.js** y **netlify/edge-functions/vehicle-og.js**. Si cambias uno, cambia los tres.
- La autorización ya no usa un UID fijo: `canManageVehicles()`/`canManageUsers()` en firestore.rules deben coincidir con `ROLE_PERMISSIONS` en roles.js — mismos roles (`customer`/`sales`/`editor`/`admin`) y mismos campos (`role`, `status`) en ambos lados.
- Si agregas un dominio externo nuevo (CDN, API), añádelo a la CSP en `netlify.toml` o el navegador lo bloqueará.
- **Barra de navegación en modo administración:** `updateAdminUI()` (app.js)
  pone/quita la clase `.nav--admin` en el `<nav>` del catálogo según
  `canManageVehicles()`. Los estilos responsive de esa barra viven en
  `styles.css` y dependen de tres ganchos del HTML: `.nav-bar` (la fila),
  `.nav-cats` (las categorías) y `.nav-actions` (Mi Cuenta + insignia +
  Publicar). Si renombras o mueves alguno de esos contenedores, actualiza
  también el bloque "MODO ADMINISTRADOR — CORRECCIÓN RESPONSIVE" de
  `styles.css`, o en un teléfono el botón "Publicar" vuelve a salirse de
  la pantalla (era el síntoma original). La clase es solo presentación:
  la autorización real sigue siendo `firestore.rules`.
- **Bloqueo del scroll de fondo de los modales:** un único contador
  (`lockBodyScroll()`/`unlockBodyScroll()` en app.js, expuesto como
  `window.LB_SCROLL_LOCK`) lo comparten el lightbox, el modal de
  publicar/editar, el de eliminar y el de la calculadora
  (`calculadora.js`). Todo modal nuevo debe usarlo en vez de tocar
  `document.body.style.overflow` a mano: si un modal desbloquea por su
  cuenta mientras otro sigue abierto, el fondo vuelve a desplazarse
  debajo.
- **Subpáginas de Empresa (`/empresa/*`):** son documentos HTML propios
  (`empresa/*.html`), no vistas de la SPA. Cada una lleva su `title`,
  `description`, `canonical`, `og:*`, `twitter:*` y JSON-LD escritos en el
  HTML, así que no dependen de que el rastreador ejecute JavaScript. Para
  añadir una sección nueva: crea el archivo, enlázalo en el menú
  `#nav-empresa-menu` y en el pie de `index.html`, añade la reescritura en
  `netlify.toml`, súmalo a `scripts/generar-sitemap.js` y a la subnavegación
  de las cuatro páginas existentes.
- **FAQ de Empresa:** el bloque de preguntas y su schema `FAQPage` viven
  juntos en `empresa/por-que-elegirnos.html`; si editas una pregunta, edita
  también su entrada en el JSON-LD de esa misma página (y en ninguna otra:
  el schema solo debe existir donde el contenido existe).
- Cada vez que edites `app.js`, `calculadora.js`, `dashboard.js`, `styles.css`, `ficha-vehiculo.css` o `invite-modal.js`, incrementa el `?v=` de ese archivo en `index.html` (evita servir JS/CSS cacheado desacoplado del HTML nuevo). No hace falta subir el número de los archivos que no tocaste.

## Tareas pendientes del propietario (una sola vez)

0. **Desplegar las Reglas de Firestore:** esta versión añade
   `match /config/{docId}` (tasa USD→RD$). Sin desplegarlas, `app.js` sigue
   recibiendo `permission-denied` al leer `config/finanzas` y la tasa se queda
   en el valor de respaldo del código (59), aunque la cambies en Firestore:

   ```bash
   firebase deploy --only firestore:rules
   ```

1. **Hero → Cloudinary:** sube 5 fotos reales a Cloudinary (carpeta `labatalla/`) y
   reemplaza las 5 URLs de Pexels marcadas con el bloque `HERO — MIGRAR A CLOUDINARY`
   en `index.html`. Actualiza TAMBIÉN el `<link rel="preload">` del `<head>`
   (marcado con el mismo aviso) con la URL de la primera imagen.
2. **Backfill de slugs:** tras el primer deploy, inicia sesión con una cuenta
   con `role: admin` o `role: editor` (ver ítem de bootstrap abajo). app.js
   persistirá automáticamente el slug de los vehículos antiguos (verás el
   mensaje en la consola). Desde ese momento la Edge Function resuelve todo con
   1 lectura de Firestore por visita.
3. **Publicar las reglas actualizadas:** `firebase deploy --only firestore:rules`
   (incluyen validación estricta de `year` y formato de `slug`).
4. **Verificar en la consola de Firebase** que App Check está en modo *Enforcement*
   (no solo monitor) para Firestore.
5. **Bootstrap del primer administrador (una sola vez, manual):** registra una
   cuenta normal desde "Mi Cuenta" en el sitio (nace con `role: customer`), y
   luego en la consola de Firebase → Firestore → `users/{ese uid}` → edita a
   mano `role: "admin"`, `status: "active"`. A partir de ahí, ese admin ya
   puede gestionar el `role`/`status` de cualquier otro usuario desde
   Firestore — no existe (ni debe existir) una forma de auto-asignarse
   `admin` desde la app.

   ⚠️ Una vez promovido el primer administrador, verifica que pueda iniciar
   sesión correctamente **antes** de eliminar cualquier referencia antigua a
   `ADMIN_UID` o de desplegar las nuevas Rules en producción. Si algo falla en
   este paso, todavía tienes el esquema viejo como respaldo para recuperar
   acceso — una vez retirado, no.

## Versionado de caché

`index.html` referencia `roles.js`, `app.js`, `auth.js`, `auth-ui.js`,
`calculadora.js`, `dashboard.js`, `invite-modal.js`,
`styles.css`, `ficha-vehiculo.css`, `dashboard.css` y `tailwind.css` con
`?v=AAAAMMDD`. `cotizacion-pdf.js` y `pdf-core.js` no van en el `<head>`: su
`?v=` está en el `import()` dinámico de `calculadora.js`. Cada vez que
modifiques alguno de esos archivos, incrementa el valor de **ese archivo
específico** en `index.html` — no hace falta subir los de archivos que no
tocaste, pero tampoco olvides el que sí cambió: un `?v=` desactualizado deja
navegadores sirviendo JS/CSS viejo contra el HTML nuevo indefinidamente.

## Comandos

```bash
node scripts/generar-sitemap.js        # regenerar sitemap localmente
firebase deploy --only firestore:rules # publicar reglas de Firestore
```

El deploy a producción es automático: push a la rama principal → Netlify build.

---

# Invitación opcional de registro

Al intentar contactar por WhatsApp (tarjeta, ficha de vehículo, CTA final, o
calculadora de financiamiento — 5 puntos en total, todos interceptados por
`invite-modal.js`), un visitante sin sesión ve una invitación con 4 opciones:

- **Crear cuenta** → abre el modal de registro ya existente (no duplica Firebase Auth).
- **Iniciar sesión** → abre el modal de login ya existente.
- **Continuar sin registrarme** → ejecuta la acción original de WhatsApp, sin más fricción.
- **Cerrar (X / Escape / clic fuera)** → no ejecuta ninguna acción de WhatsApp.

No se muestra a usuarios con sesión iniciada, ni más de una vez por sesión de
navegador (`sessionStorage`), ni de nuevo a quien ya se registró alguna vez
desde ese navegador (`localStorage`, solo como señal de UX — nunca datos
sensibles).

---

# Hero — carrusel

6 slides con título/subtítulo propios (crossfade sincronizado), flechas
prev/next y dots — todos funcionales en desktop, tablet y móvil (dots
verificados con eventos táctiles reales; antes quedaban tapados por la
sección "Explorar por Marca" debido a un empate de `z-index`, ya corregido).
Autoplay cada 5.5s, se pausa con la pestaña oculta y respeta
`prefers-reduced-motion` (no avanza si el usuario tiene esa preferencia
activada — comportamiento intencional, no un bug). El `<h1>`/subtítulo del
hero corresponden siempre al slide realmente activo (nunca un valor fijo
hardcodeado).

# Páginas de Empresa

```text
/empresa/por-que-elegirnos
/empresa/quienes-somos
/empresa/mision-vision
/empresa/nuestros-valores
```

Cada sección es una página HTML independiente en `empresa/*.html`, servida
en su URL limpia mediante reescrituras 200 en `netlify.toml`. No cargan
Tailwind ni `app.js`: solo `pagina-estatica.css` (compartida con las páginas
legales) y los iconos de Lucide, así que se renderizan sin ejecutar lógica
de la SPA. Cada una lleva su propio `title`/`description`/`canonical`/`og:*`/
`twitter:*` y `BreadcrumbList`; el `FAQPage` vive en `por-que-elegirnos`.
Todas están en `sitemap.xml`, se enlazan entre sí (subnavegación superior +
bloque final) y desde el menú Empresa y el pie de `index.html`. Cualquier
ruta `/empresa/*` que no exista devuelve un 404 real.

# Seguridad — deuda conocida

- **`script-src 'unsafe-inline'` en el CSP** (`KNOWN SECURITY DEBT`):
  necesario hoy porque el proyecto usa handlers inline (`onclick`, `onerror`)
  en muchos lugares. Eliminarlo exige migrar todos a `addEventListener` —
  pendiente, no crítico por sí solo.
- **`allowed_formats` no restringido en la firma de Cloudinary**
  (`KNOWN LOW-RISK HARDENING ITEM`): un admin/editor autorizado podría subir
  SVG. Mitigado en la práctica porque el sitio solo renderiza imágenes vía
  `<img>` (SVG no ejecuta scripts ahí) y el CSP tiene `object-src 'none'`. El
  fix vive en `cloudinary-sign-worker.js`, que corre en Cloudflare Workers —
  fuera de este repositorio, pendiente de despliegue manual.

# Estado del proyecto

```
READY FOR DEPLOY
```

Auditado en navegador real (Chromium headless con la CSP de producción
aplicada): catálogo, ficha, publicación/edición/borrado con imágenes,
Auth, Dashboard, favoritos, cotizaciones, calculadora, Empresa, legales y
404 — 78 aserciones funcionales en verde, 0 violaciones de axe-core
(WCAG 2.1 A/AA), 0 violaciones de CSP y 48/48 viewports sin desbordamiento
horizontal. Las 15 pruebas de `firestore.rules` pasan contra el emulador
real de Firestore. Sin bugs críticos conocidos.

Pendiente de verificación manual en producción (bloqueado por la red del
entorno de desarrollo, que no alcanza gstatic/jsDelivr/Cloudinary):

- Subida real de una foto HEIC a Cloudinary
- Comportamiento real en iOS Safari (teclado virtual, safe-area)
- Vista previa social real (WhatsApp/Facebook) de `/` y `/empresa/*`
- Indexación real por buscadores
