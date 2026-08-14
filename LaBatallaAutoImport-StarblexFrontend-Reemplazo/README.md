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
├── tailwind.css               Tailwind compilado (no editar a mano)
├── 404.html                   Página de error de Netlify
├── politica-privacidad.html   Página legal
├── terminos-y-condiciones.html Página legal
├── site.webmanifest           Web App Manifest (PWA / pantalla de inicio)
├── robots.txt / sitemap.xml   SEO — el sitemap se regenera automáticamente
├── favicon.png / preview.jpg  Assets de marca y Open Graph por defecto
├── netlify.toml               Redirects SPA, Edge Functions, headers de cache y seguridad
├── firebase.json              Apunta a firestore.rules para deploy de reglas
├── firestore.rules            Reglas de seguridad (lectura pública, escritura solo admin)
├── scripts/
│   └── generar-sitemap.js     Genera sitemap.xml desde la API REST de Firestore
├── netlify/edge-functions/
│   ├── vehicle-og.js          Meta tags OG para bots sociales + 404 real por vehículo
│   └── starblex.js            Backend de Starblex IA 1.0 — única pieza con la API key de Anthropic
└── .github/workflows/
    └── actualizar-sitemap.yml Cron diario que regenera y commitea el sitemap
```

## Reglas de sincronización crítica

- El `slug` se genera UNA vez al crear el vehículo y es inmutable. `slugify()` existe en **app.js**, **scripts/generar-sitemap.js** y **netlify/edge-functions/vehicle-og.js**. Si cambias uno, cambia los tres.
- La autorización ya no usa un UID fijo: `canManageVehicles()`/`canManageUsers()` en firestore.rules deben coincidir con `ROLE_PERMISSIONS` en roles.js — mismos roles (`customer`/`sales`/`editor`/`admin`) y mismos campos (`role`, `status`) en ambos lados.
- Si agregas un dominio externo nuevo (CDN, API), añádelo a la CSP en `netlify.toml` o el navegador lo bloqueará.
- **Subpáginas de Empresa (`/empresa/*`):** cada sección de `EMPRESA_SECTIONS` (app.js) tiene su propio `title`/`description` en `EMPRESA_META` y su `canonical` se reescribe en tiempo real vía `setPageMeta()`. Si agregas una sección nueva al menú `#nav-empresa-menu`, súmala también a `EMPRESA_SECTIONS` y `EMPRESA_META`, o heredará el título genérico "Empresa".
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

Asistente automotriz en español, integrado como botón flotante (reemplaza al
antiguo FAB de WhatsApp) y accesible desde cualquier pantalla del sitio.

### Arquitectura

```
Navegador (starblex-chat.js)
    ↓  POST /api/starblex { message, history, vehicleId }
Netlify Edge Function (netlify/edge-functions/starblex.js)
    ↓
Firestore REST API — inventario real, lectura pública (allow read: if true)
    ↓
Anthropic API — claude-haiku-4-5-20251001
    ↓
{ reply } — JSON limpio, sin datos internos
```

El navegador **nunca** es la fuente de verdad del inventario: como mucho puede
indicar `vehicleId` (el vehículo que se está viendo); el backend resuelve los
datos reales contra Firestore por su cuenta. La API key de Anthropic vive
exclusivamente como variable de entorno de la Edge Function — nunca en HTML,
JS público, `localStorage` ni `sessionStorage`.

### Variables de entorno (configurar en Netlify → Environment variables, scope "Edge functions")

```text
ANTHROPIC_API_KEY      # secreto — nunca poner el valor real en este repo
ALLOWED_ORIGINS        # ej: https://labatallaautoimport.netlify.app (whitelist de CORS)
FIREBASE_PROJECT_ID    # no es secreto — ya es público en app.js
FIREBASE_WEB_API_KEY   # opcional, tampoco es secreto
```

### Estado de producción

**Código listo / producción aún no activa.** `GET /api/starblex` sigue
devolviendo `404` en `https://labatallaautoimport.netlify.app` — significa que
la Edge Function todavía no está registrada en el deploy real de Netlify
(archivo no subido al repo conectado, o deploy no disparado después de
subirlo). No es un problema de código: el mismo archivo, ejecutado localmente,
responde `405` a `GET` como corresponde. Verificar en el dashboard de Netlify
(pestaña Edge Functions) que `starblex` aparezca activa antes de dar por buena
esta integración.

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
- Sin router híbrido Haiku/Sonnet: todo pasa por Haiku 4.5 en esta versión.
- Sin rate limiting persistente por IP/usuario — el backend limita tamaño de
  mensaje, historial y tokens de salida, pero no frecuencia de uso a lo largo
  del tiempo.
- La precisión depende de que el inventario en Firestore tenga los campos
  bien llenos (año, transmisión, etc.) — no hay garantía de "100% de
  precisión" en ningún caso; el system prompt instruye a decir "no tengo
  información suficiente" en vez de inventar datos.
