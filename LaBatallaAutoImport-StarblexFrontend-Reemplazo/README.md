# La Batalla Auto Import

Sitio web de venta y exhibición de vehículos — SPA estática desplegada en Netlify con inventario en Firestore.

**Producción:** https://labatallaautoimport.netlify.app

## Estructura

```
├── index.html                 SPA principal (catálogo, fichas, empresa, modales)
├── app.js                     Lógica: Firestore, CRUD admin, SEO dinámico, favoritos, galería
├── calculadora.js             Calculadora de financiamiento (modal + FAB)
├── invite-modal.js            Invitación opcional de registro al contactar por WhatsApp
├── starblex-chat.js           Interfaz de Starblex IA 1.0 (FAB + panel de chat)
├── logo-labatalla.png         Logo oficial, usado en el modal de invitación
├── vehicles-demo.js           Datos de ejemplo — solo se descarga si Firebase falla
├── styles.css                 Estilos propios (complementa Tailwind)
├── tailwind.css                Tailwind compilado (no editar a mano)
├── 404.html                   Página de error de Netlify
├── politica-privacidad.html   Página legal
├── terminos-y-condiciones.html Página legal
├── site.webmanifest           Web App Manifest (PWA / pantalla de inicio)
├── robots.txt / sitemap.xml   SEO — el sitemap se regenera automáticamente
├── favicon-16.png / favicon-32.png / apple-touch-icon.png / icon192.png / icon512.png
│                               Iconos de marca (símbolo, sin texto — favicon.png ya no se usa)
├── logo-hero.png               Logo completo (con texto), badge en la esquina superior del hero
├── netlify.toml                Redirects SPA, Edge Functions, headers de cache y seguridad
├── firebase.json               Apunta a firestore.rules para deploy de reglas
├── firestore.rules             Reglas de seguridad (lectura pública, escritura solo admin)
├── scripts/
│   └── generar-sitemap.js      Genera sitemap.xml desde la API REST de Firestore
├── netlify/edge-functions/
│   ├── vehicle-og.js           Meta tags OG para bots sociales + 404 real por vehículo
│   └── starblex.js             Backend de Starblex IA 1.0 — única pieza con la API key de Gemini
└── .github/workflows/
    └── actualizar-sitemap.yml  Cron diario que regenera y commitea el sitemap
```

⚠️ **Nota sobre un archivo huérfano**: existe también un `/starblex.js` en la **raíz** del repositorio (fuera de `netlify/edge-functions/`). Está confirmado que no tiene ninguna referencia real en `netlify.toml`, workflows ni el resto del código — es un duplicado sin uso, pendiente de limpieza manual (`ORPHANED — PENDING MANUAL CLEANUP`). La implementación real y activa es exclusivamente `netlify/edge-functions/starblex.js`.

## Reglas de sincronización crítica

- El `slug` se genera UNA vez al crear el vehículo y es inmutable. `slugify()` existe en **app.js**, **scripts/generar-sitemap.js** y **netlify/edge-functions/vehicle-og.js**. Si cambias uno, cambia los tres.
- La autorización ya no usa un UID fijo: `canManageVehicles()`/`canManageUsers()` en firestore.rules deben coincidir con `ROLE_PERMISSIONS` en roles.js — mismos roles (`customer`/`sales`/`editor`/`admin`) y mismos campos (`role`, `status`) en ambos lados.
- Si agregas un dominio externo nuevo (CDN, API), añádelo a la CSP en `netlify.toml` o el navegador lo bloqueará.
- **Subpáginas de Empresa (`/empresa/*`):** cada sección de `EMPRESA_SECTIONS` (app.js) tiene su propio `title`/`description` en `EMPRESA_META` y su `canonical` se reescribe en tiempo real vía `setPageMeta()`. Si agregas una sección nueva al menú `#nav-empresa-menu`, súmala también a `EMPRESA_SECTIONS` y `EMPRESA_META`, o heredará el título genérico "Empresa". El `<h1>` del hero también cambia de texto al entrar a Empresa (`EMPRESA_HERO_H1`) y se restaura al slide del carrusel realmente activo al salir — si agregas una sección nueva, súmala también a ese mapa.
- **FAQ de Empresa:** las preguntas de `#preguntas-frecuentes` (index.html) y el array `FAQ_ENTRIES` (app.js, usado para el schema `FAQPage`) deben mantenerse idénticos. El schema se inyecta/retira dinámicamente en `showEmpresaPage()`/`hideEmpresaPage()` para no exponerlo en páginas donde el contenido no existe (home, fichas de vehículo).
- Cada vez que edites `app.js`, `calculadora.js`, `dashboard.js`, `styles.css`, `invite-modal.js` o `starblex-chat.js`, incrementa el `?v=` de ese archivo en `index.html` (evita servir JS/CSS cacheado desacoplado del HTML nuevo). No hace falta subir el número de los archivos que no tocaste.

## Tareas pendientes del propietario (una sola vez)

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
6. **Confirmar `/api/starblex` en producción real:** `GET /api/starblex` debe
   devolver `405` (no `404`), y un `POST` con un mensaje simple debe devolver
   `{ reply: "..." }` con una respuesta real de Gemini. Ver "Estado de
   producción" más abajo.
7. **Limpieza opcional:** eliminar el `/starblex.js` huérfano de la raíz (ver
   nota en "Estructura" arriba) — confirmado sin referencias, pero no
   bloqueante para el funcionamiento del sitio.

## Versionado de caché

`index.html` referencia `roles.js`, `app.js`, `auth.js`, `auth-ui.js`,
`calculadora.js`, `dashboard.js`, `invite-modal.js`, `starblex-chat.js`,
`styles.css`, `dashboard.css` y `tailwind.css` con `?v=AAAAMMDD`. Cada vez que
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

# Starblex IA 1.0

Asistente automotriz en español, integrado como botón flotante y accesible
desde cualquier pantalla del sitio. Incluye contexto del vehículo en pantalla,
historial de conversación, tarjeta visual del vehículo (imagen, nombre,
precio, botones "Ver vehículo"/"Financiar", miniaturas si hay varias fotos),
mensajes proactivos (bienvenida rotativa en Home, saludo con el vehículo real
al entrar a una ficha, aviso si el vehículo cambia dentro de la misma
conversación) y sugerencias por categoría (Motor y rendimiento, Precio y
financiamiento, Consumo, Problemas comunes, Comparar).

### Arquitectura

```
Navegador (starblex-chat.js)
    ↓  POST /api/starblex { message, history, vehicleId }
Netlify Edge Function (netlify/edge-functions/starblex.js)
    ↓
Firestore REST API — inventario real, lectura pública (allow read: if true)
    ↓
Gemini 3.6 Flash (Google AI, Developer API — no Vertex AI)
    ↓
{ reply } — JSON limpio, sin datos internos
```

El navegador **nunca** es la fuente de verdad del inventario: como mucho puede
indicar `vehicleId` (el vehículo que se está viendo). El backend resuelve
inventario general con un tope de 60 vehículos (`MAX_INVENTORY_ITEMS`,
cacheado 60s) para preguntas tipo "qué tienen disponible" — en ese listado de
fondo, `features` se recorta a 3 elementos por vehículo (optimización de
tamaño del prompt, ~17% menos tokens); el vehículo en pantalla se resuelve
aparte, con una lectura directa por ID (caché propia de 60s) que **no
depende de estar entre esos primeros 60**, y conserva su lista completa de
características. Historial limitado a 6 turnos / 800 caracteres cada uno;
mensaje del usuario limitado a 800 caracteres; timeout al proveedor de 20s.
La API key de Gemini vive exclusivamente como variable de entorno de la Edge
Function — nunca en HTML, JS público, `localStorage` ni `sessionStorage`.

### Manejo de errores

Cada fallo del backend incluye un campo `reason` interno (nunca mostrado al
usuario) que distingue la causa real: `missing_api_key`, `rate_limited`,
`provider_error`, `empty_response`, `timeout`. El frontend reintenta
automáticamente **una sola vez**, solo para `timeout` o fallo de red — nunca
para `rate_limited` (reintentar de inmediato empeora un límite de tasa) ni
para errores de configuración.

### Variables de entorno (configurar en Netlify → Environment variables, scope "Edge functions")

```text
GEMINI_API_KEY          # secreto — nunca poner el valor real en este repo
ALLOWED_ORIGINS         # ej: https://labatallaautoimport.netlify.app (whitelist de CORS)
FIREBASE_PROJECT_ID     # no es secreto — ya es público en app.js
FIREBASE_WEB_API_KEY    # opcional, tampoco es secreto
```

### Estado de producción

**Código auditado y aprobado localmente. Confirmación real en producción
todavía pendiente.** No se ha podido verificar desde el entorno de
desarrollo que `POST /api/starblex` responda con Gemini real (sin acceso de
red saliente a `netlify.app` ni a `generativelanguage.googleapis.com` desde
ese entorno). Antes de dar esta integración por 100% verificada, confirma
manualmente: `GET /api/starblex` debe devolver `405` (no `404`, que
indicaría que la Edge Function no está registrada en el deploy), y una
petición `POST` real con un mensaje simple debe devolver `{ reply: "..." }`.

### Invitación opcional de registro

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

### Limitaciones actuales

- Sin RAG: el modelo responde con el inventario real de Firestore más su
  conocimiento general de mecánica — no hay base de conocimiento técnica
  adicional todavía.
- Sin memoria persistente: la conversación vive en memoria del navegador y se
  pierde al recargar o cerrar la pestaña, a propósito.
- Modelo único: Gemini 3.6 Flash. Sin router híbrido de modelos en esta versión.
- Sin rate limiting persistente por IP/usuario — el backend limita tamaño de
  mensaje, historial y tokens de salida, pero no frecuencia de uso a lo largo
  del tiempo.
- La precisión depende de que el inventario en Firestore tenga los campos
  bien llenos (año, transmisión, etc.) — no hay garantía de "100% de
  precisión" en ningún caso; el system prompt instruye a decir "no tengo
  información suficiente" en vez de inventar datos.

---

# Hero — carrusel

6 slides con título/subtítulo propios (crossfade sincronizado), flechas
prev/next y dots — todos funcionales en desktop, tablet y móvil (dots
verificados con eventos táctiles reales; antes quedaban tapados por la
sección "Explorar por Marca" debido a un empate de `z-index`, ya corregido).
Autoplay cada 5.5s, se pausa con la pestaña oculta y respeta
`prefers-reduced-motion` (no avanza si el usuario tiene esa preferencia
activada — comportamiento intencional, no un bug). El `<h1>`/subtítulo del
hero corresponden siempre al slide realmente activo, incluida su
restauración correcta al volver desde las páginas de Empresa (nunca un
valor fijo hardcodeado).

# Páginas de Empresa

```text
/empresa/por-que-elegirnos
/empresa/quienes-somos
/empresa/mision-vision
/empresa/nuestros-valores
```

Rutas SPA reales (no anchors ni archivos `.html` separados — viven dentro de
`index.html`) — `history.pushState`, `title`/`description`/`canonical`/
`og:*`/`twitter:*` propios por página vía `setPageMeta()`, H1 contextual (ver
nota en "Reglas de sincronización crítica"), `FAQPage` structured data,
incluidas en `sitemap.xml`. Netlify sirve `index.html` (200) para cualquier
ruta bajo `/empresa/*` vía redirect en `netlify.toml`.

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
- **`/starblex.js`** en la raíz del proyecto: `ORPHANED — PENDING MANUAL
  CLEANUP` (ver nota en "Estructura" arriba).

# Estado del proyecto

```
READY FOR DEPLOY
```

Código auditado localmente de forma extensa (imágenes/HEIC, estabilidad y
velocidad de Starblex, responsive de 14 viewports, SEO, seguridad,
hero/carrusel) sin bugs críticos conocidos. Pendiente de verificación manual
en producción:

- Respuesta real de Gemini vía `/api/starblex`
- Subida real de una foto HEIC a Cloudinary
- Comportamiento real en iOS Safari (teclado virtual, safe-area)
- Reglas dinámicas de Firestore contra el Emulator real
- Vista previa social real (WhatsApp/Facebook) de `/` y `/empresa/*`
- Indexación real por buscadores
