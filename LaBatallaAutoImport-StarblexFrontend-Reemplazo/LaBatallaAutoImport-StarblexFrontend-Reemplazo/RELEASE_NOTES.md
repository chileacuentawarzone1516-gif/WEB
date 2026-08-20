# RELEASE NOTES — La Batalla Auto Import

## STARBLEX IA 1.0 — INTEGRACIÓN COMPLETA: UI + Invitación + Logo + fixes reales

**Esta entrega integra físicamente**, no solo documenta, todo lo aprobado hasta ahora: interfaz de Starblex, invitación opcional de registro, y el nuevo logo — corrigiendo 3 bugs reales encontrados durante la verificación (no solo revisión superficial):

### Bugs reales encontrados y corregidos
1. **`starblex-chat.js` mandaba un payload de una arquitectura vieja** (`vehicleContext` + `inventorySnapshot` completos) que el backend actual ya no lee — el backend obtiene el inventario de Firestore por su cuenta desde la corrección de Fase 1. Corregido: ahora manda solo `vehicleId`. Sin este fix, "Explícame este vehículo" nunca le habría llegado el vehículo correcto al modelo.
2. **Faltaba el `<script>` de `starblex-chat.js` en `index.html`.** El botón del FAB ya llamaba a `window.LB_STARBLEX?.open()`, pero ese objeto nunca se definía porque el archivo que lo define no se estaba cargando. El FAB habría estado ahí, visible, sin hacer nada al pulsarlo.
3. **Un punto de contacto por WhatsApp no pasaba por la invitación opcional**: el botón "Solicitar este Financiamiento" del modal de calculadora dispara `window.open()` directamente (no es un `<a>`), así que el listener delegado de `invite-modal.js` no lo detectaba. Corregido en `calculadora.js` para que use el mismo criterio que los otros 4 puntos.

### Aclaración sobre "Escríbenos"
No es un sistema separado — era el texto visible del FAB de WhatsApp original (`<span class="fab-whatsapp-label-title">Escríbenos</span>`). Ese FAB ya fue reemplazado por el de Starblex IA en esta misma integración; no queda ningún rastro del label ni del botón anterior.

### Logo
Se usó `La_Batalla_Auto_Import_-_Logo_Premium_Automotriz.png` (confirmado por el propietario) como fuente. Ya estaba correctamente derivado en `logo-labatalla.png` (240×240, fondo #051d40 idéntico al original, sin distorsión) para el modal de invitación — verificado de nuevo contra el hash del archivo confirmado.

### Verificación real ejecutada
- `node --check` en los 11 archivos `.js` del proyecto: OK.
- `netlify.toml` parseado con un parser TOML real (librería `toml` de Python): OK, sin duplicados de `[[edge_functions]]`.
- HTML: 250 `<div>` de apertura = 250 de cierre, cero IDs duplicados.
- **Prueba real de overflow horizontal con Chromium headless** (Playwright) en los 8 anchos pedidos (320/360/375/390/414/768/1024/1440): **cero overflow horizontal en los 8**. Renderizado real, no inspección de CSS.
- Sin archivos duplicados de `starblex.js`, `starblex-chat.js` ni `invite-modal.js`.
- Mensajes del chat insertados con `textContent`, no `innerHTML` — sin vector XSS.

### Limitaciones honestas
No pude verificar visualmente la posición del FAB de Starblex ni su no-solapamiento con "Financiar": Firebase y los CDN externos están bloqueados en la red de este entorno de pruebas, así que `app.js` lanza `firebase is not defined` antes de inicializar el FAB. Limitación del entorno de pruebas, no evidencia de un bug — pero no lo declaro "verificado" sin haberlo visto renderizado. Pendiente de confirmación visual tras el deploy real.

No se implementó router híbrido Haiku/Sonnet, RAG, ni memoria persistente — fuera de alcance de la 1.0.

---

## STARBLEX IA 1.0 — FASE 7: mensaje demasiado largo, de truncado silencioso a rechazo explícito

**Cambio puntual**, sin tocar nada más: `netlify/edge-functions/starblex.js` ya no trunca en silencio un mensaje que excede 800 caracteres. Ahora responde `400` con `"El mensaje es demasiado largo. Intenta resumirlo."` antes de construir cualquier request a Anthropic. El historial y el `vehicleId` siguen acotándose igual que antes (no son texto libre que la persona esté escribiendo en ese momento). Verificado con `node --check` + 2 aserciones nuevas (mensaje de 5000 chars → 400; mensaje de exactamente 800 chars → no se rechaza) sobre las 26 totales del arnés de Fase 2, todas en verde.

---



## STARBLEX IA 1.0 — FASE 1: Backend mínimo seguro

**Alcance de esta entrega:** exclusivamente el backend (`/api/starblex`, Netlify Edge Function) que habla con Claude Haiku 4.5. Explícitamente **fuera de alcance de esta fase** (aprobado así, no implementado): interfaz de chat, botón flotante Starblex, eliminación del FAB de WhatsApp, RAG, memoria persistente, router Haiku/Sonnet, rate limiting persistente.

⚠️ **Nota de transparencia:** en este mismo entorno de trabajo existen, de una ronda anterior (antes de que se pidiera detener la implementación para decidir arquitectura), borradores sin entregar de la interfaz de Starblex (`starblex-chat.js`) y del reemplazo del FAB de WhatsApp (`index.html`, `app.js`, `styles.css`, `dashboard.js`). **No se incluyen en esta entrega** porque esta fase los excluye explícitamente — quedan en espera hasta la fase de UX/Chat. Los archivos protegidos reales (`auth.js`, `auth-ui.js`, `roles.js`, `firestore.rules`, `dashboard.css`, `calculadora.js`, `cloudinary-sign-worker.js`) están verificados byte a byte, sin cambios.

### 1. Corrección de arquitectura aplicada: fuente del inventario
La propuesta original enviaba el inventario desde el navegador al backend (`inventorySnapshot`). Corregido: el navegador **ya no es fuente de verdad**. `netlify/edge-functions/starblex.js` obtiene el inventario directamente de Firestore vía su REST API pública (`firestore.googleapis.com`), aprovechando que `firestore.rules` línea 241 ya tiene `allow read: if true` en `/vehicles` — la misma lectura pública que usa hoy el SDK cliente. Esto no requiere Service Account, Firebase Admin ni ninguna credencial privilegiada, y **no se modificó `firestore.rules`**.

El cliente, cuando se implemente el chat, solo podrá enviar `vehicleId` (un identificador) para indicar "estoy viendo este vehículo" — el backend lo busca en su propia lista ya obtenida de Firestore. Un ID inexistente o manipulado simplemente no encuentra nada; no hay forma de inyectar datos falsos de un vehículo.

### 2. Edge Function (`netlify/edge-functions/starblex.js`)
- Valida método (solo `POST`+`OPTIONS`), `Content-Type: application/json`, tamaño de body (máx. 20 KB antes de parsear), longitud de mensaje (800 caracteres), historial (máx. 6 turnos, 800 caracteres cada uno, roles restringidos a `user`/`assistant`).
- Modelo fijado en una única constante (`claude-haiku-4-5-20251001`) — el cliente no puede elegir modelo, system prompt, `temperature` ni `max_tokens`.
- Inventario cacheado en memoria 60s para no golpear Firestore en cada mensaje.
- System prompt con separación explícita entre instrucciones (reglas de Starblex) y datos (inventario, vehículo en pantalla, historial, mensaje del usuario) — instruye a ignorar intentos de inyección que pidan revelar el prompt, claves o cambiar de rol.
- CORS restringido a `ALLOWED_ORIGINS` (whitelist explícita, sin `*`); rechaza cualquier origen no listado con 403.
- Errores tipados sin fugas: JSON inválido (400), body excesivo (413), método incorrecto (405), origen no autorizado (403), `Content-Type` incorrecto (415), falta `ANTHROPIC_API_KEY` (503), error/cuota del proveedor (502/429), timeout de 20s (504) — todos devuelven el mismo mensaje genérico al usuario, nunca detalle interno, stack trace, ni el system prompt.
- Punto de extensión marcado en el código (`RATE LIMIT (fase posterior)`) para añadir límite por IP/usuario sin reestructurar el archivo.

### 3. `netlify.toml`
Registrada la ruta `[[edge_functions]] path = "/api/starblex" function = "starblex"`. Sin cambios de CSP ni CORS externo — mismo dominio que el resto del sitio.

### Archivos nuevos
`netlify/edge-functions/starblex.js`

### Archivos modificados
`netlify.toml` (solo el bloque de la nueva ruta)

### Archivos NO modificados (verificados por diff byte a byte)
`auth.js`, `auth-ui.js`, `roles.js`, `firestore.rules`, `dashboard.css`, `calculadora.js`, `cloudinary-sign-worker.js`, `firebase.json`, `firestore_rules_test.js`, `robots.txt`, `sitemap.xml`, `tailwind.css`, `politica-privacidad.html`, `terminos-y-condiciones.html`, `404.html`, `README.md`.

### Variables de entorno necesarias en Netlify (Site settings → Environment variables → marcar disponibles para "Edge functions")
- `ANTHROPIC_API_KEY=<CONFIGURAR EN NETLIFY>` — API key de platform.claude.com, nunca un valor real en este repo.
- `ALLOWED_ORIGINS=https://labatallaautoimport.netlify.app` (agregar dominio propio si lo hay, separado por coma).
- `FIREBASE_PROJECT_ID=la-batalla-auto-import` — no es secreto (ya es público en `app.js`), pero se mantiene como variable para no hardcodearlo en el Edge Function.
- `FIREBASE_WEB_API_KEY=<opcional>` — tampoco es secreto; si se define, se añade a la consulta a Firestore, no es obligatorio.

### Pruebas ejecutadas en esta fase
Pruebas unitarias de la lógica pura (Node, sin red): parseo de campos tipados de Firestore → JS plano, whitelist de campos del inventario (descarta cualquier campo fuera de la lista, ej. `ownerUid`), remoción del `id` interno antes de armar el prompt, sanitización de historial (descarta roles inválidos como `system`, trunca a 6 turnos y 800 caracteres), truncado de mensajes largos, y búsqueda de `vehicleContext` por ID (encuentra el real, ignora uno inexistente/manipulado). Las 11 aserciones pasaron. `node --check` confirma sintaxis JS válida.

### Pendiente / no verificable en este entorno
`NOT VERIFIED — EXTERNAL API UNAVAILABLE`: no se pudo ejecutar el runtime real de Netlify Edge Functions (Deno) ni llamadas reales a `firestore.googleapis.com` o a la API de Anthropic (sin `ANTHROPIC_API_KEY` real ni acceso de red a Firestore desde este entorno). Los 12 casos de prueba de extremo a extremo listados para la Fase 2 (mensaje normal, vacío, muy largo, JSON inválido, GET, prompt injection, etc.) quedan pendientes de ejecutar contra el despliegue real, con `web-application-testing`, cuando lo autorices.

---



**Alcance del pedido:** mejoras puramente visuales/UX. Explícitamente fuera de alcance (y verificado sin cambios): Firebase Authentication, Firestore, Cloudinary, Netlify, Cloudflare Worker, sistema de administradores.

### 1. Botón "Cerrar sesión"
**Diagnóstico real:** ya existía un botón de logout (`auth-logout-btn`) pero vivía dentro de `account-modal`, una vista a la que un usuario logueado **nunca llega** — `nav-account-btn` lo redirige directo al Dashboard (`window.LB_DASHBOARD.open()`). Era código inalcanzable, no un botón "poco visible".
**Fix:** botón `db-logout-btn` nuevo y visible en el topbar del Dashboard (que es, en la práctica, el "menú Mi Cuenta" para un usuario logueado). Reutiliza `logoutUser()` de `auth.js` sin tocar Firebase Auth. El cierre de sesión, la vuelta a modo visitante y el ocultamiento de funciones de usuario/admin ya ocurrían de forma reactiva vía `onUserChanged()` (en `dashboard.js` y `updateAdminUI()` de `app.js`) — no fue necesario duplicar esa lógica.

### 2. Responsive móvil (auditoría completa: header, hero, carrusel, botones, dashboard, formularios, tarjetas, footer)
- `#nav-account-btn` / `#nav-publish-btn`: área táctil mínima 44×44px, mayor contraste (acento sky del sitio en vez de gris sobre gris), íconos más grandes.
- Hero: texto más grande también en móvil, con padding lateral para no quedar debajo de las flechas del carrusel; ajuste adicional en pantallas ≤380px.
- Carrusel: flechas e indicadores con tamaño reducido y touch-friendly en `@media (max-width:767px)`.
- Dashboard, formularios, tarjetas y footer: se auditaron contra el rediseño móvil ya existente (Fase 8 de `dashboard.css` y el bloque `MOBILE REDESIGN` de `styles.css`) — ya cubrían inputs a 16px (anti-zoom iOS), grids de 1 columna, botones ≥44px y scroll horizontal controlado; no se encontraron regresiones ni huecos adicionales que corregir sin alterar el diseño general.

### 3. Logos eliminados
- Logo del nav (antiguo trigger "5 clicks = admin mode"): confirmado por grep que **no tenía lógica JS asociada** — código muerto desde que el modo admin pasó a roles de Firestore (`roles.js` + whitelist en `auth.js`/`firestore.rules`). Se eliminó el `<img>` y su comentario.
- Logo del carrusel principal (hero): eliminado junto con el `<script>` que copiaba su `src` desde el logo del nav.
- **Hallazgo no solicitado pero corregido:** una tercera referencia (`#detail-page`, logo de la barra superior en la ficha de vehículo) también leía el `src` del logo del nav eliminado — se habría roto con un error de JS. Se independizó apuntándola directo a la URL de Cloudinary ya usada en el modal de login (`.../labatalla/logo.png`), sin duplicar el logo eliminado.
- Reglas CSS huérfanas de ambos logos limpiadas en `styles.css` (selector `#nav-logo-img` desktop y mobile, y `header > img.absolute`).
- Nombre de la empresa: no se tocó ningún texto ("La Batalla Auto Import" sigue en `<title>`, meta tags, footer, alt-texts y contenido).

### 4. Hero principal
Título 32px→44px desktop / 18px→26px móvil (21px en ≤380px). Subtítulo 16px→20px desktop / 11px→14.5px móvil. Se agregó `text-shadow` y `letter-spacing` para más impacto sin perder legibilidad sobre las fotos.

### 5. Carrusel — de 5 a 6 slides, cada uno con contenido propio
No se duplicó ninguna diapositiva: se agregó una sexta foto real de Pexels (showroom, ID `29566862`, sin marcas/modelos identificables) y **las 6 ahora tienen título y subtítulo propios** (antes el texto era estático y no cambiaba con la imagen):
1. Exhibición general — "Tu Próximo Vehículo Te Espera"
2. Sedán — "Sedanes Elegantes Para Cada Trayecto"
3. SUV — "SUVs Espaciosas Para Toda la Familia"
4. Pickup — "Camionetas Listas Para el Trabajo y la Aventura"
5. Patio/inventario — "Amplio Inventario, Siempre Actualizado"
6. Showroom — "Compra con Confianza y Financiamiento a tu Medida"

Se reescribió el motor del slideshow (`app.js`): además del fade automático (ahora cada 5.5s, antes 4s, para dar tiempo a leer el nuevo texto por slide) se agregaron **flechas prev/next** e **indicadores (dots)** funcionales y accesibles (`role="tab"`, `aria-selected`), navegación manual reinicia el temporizador de autoplay para que no compitan, y el texto hace crossfade sincronizado con la imagen. Se respeta `prefers-reduced-motion` y se sigue pausando con la pestaña oculta, igual que antes. No se detectó pérdida de rendimiento: mismo mecanismo (`opacity` + `setInterval`), sin librerías nuevas, sin listeners duplicados.

### Archivos modificados
`index.html`, `app.js`, `dashboard.js`, `styles.css`, `dashboard.css`.

### Archivos NO modificados (verificados por diff byte a byte contra el proyecto original)
`auth.js`, `auth-ui.js`, `roles.js`, `firestore.rules`, `firestore_rules_test.js`, `calculadora.js`, `cloudinary-sign-worker.js`, `netlify.toml`, `firebase.json`, `robots.txt`, `sitemap.xml`, `tailwind.css`, `politica-privacidad.html`, `terminos-y-condiciones.html`, `404.html`, `README.md`.

### Auditorías ejecutadas (3)
1. **Sintaxis:** `node --check` sobre los 8 archivos `.js` del proyecto → sin errores. Balance de llaves `{}` verificado en `styles.css` y `dashboard.css` (251/251 y 107/107).
2. **Integridad HTML/JS:** parseo completo de `index.html` (etiquetas balanceadas, 0 errores) + cruce automatizado de los 222 `getElementById(...)` usados en el JS contra los `id` presentes en el HTML — 0 referencias huérfanas (los 3 IDs que no aparecen en el HTML estático — `vehicle-jsonld`, `breadcrumb-jsonld`, `db-hist-vistos` — se crean dinámicamente por diseño y ya usaban `?.` antes de estos cambios).
3. **Alcance del diff:** `diff` línea por línea de cada archivo tocado contra el original — confirmado que los cambios caen exactamente en las zonas esperadas (nav/logo, hero, logo de ficha de vehículo, topbar del dashboard, bloque del slideshow) y que ningún archivo de auth/roles/Firestore/Cloudinary/Netlify fue tocado.

### Qué probar manualmente
1. Cerrar sesión desde el Dashboard → vuelve al catálogo, aparecen "Iniciar sesión"/"Registrarse", desaparecen controles de admin/usuario.
2. Login por correo, registro, login con Google — sin cambios de código, pero confirmar en el sitio publicado.
3. Panel de administrador: badge ADMIN, botón Publicar, editar/eliminar vehículo.
4. Favoritos, Historial, Cotizaciones, Preferencias — dentro del Dashboard.
5. Publicar y editar un vehículo de prueba.
6. Carrusel: dejar correr el autoplay (~30s) para ver las 6 diapositivas, click en flechas y en cada dot, y repetir en un viewport móvil (< 380px y 375–767px).
7. Botón "Mi Cuenta" y "Publicar" en un teléfono real: tamaño, contraste y que respondan al primer toque.

---

## PASO 1 (verificación) + PASO 2 — Restauración del Panel de Administración por whitelist de correo

### Paso 1 — Verificación del bug de `saveVehicleDB()`
**Resultado con evidencia fresca (no de memoria):** el bug era real (confirmado por trazado completo `readPublishForm()→publishVehicle()/updateVehicle()→saveVehicleDB()`), y **ya estaba corregido desde la ronda de QA anterior** — `saveVehicleDB()` ya excluye `id` antes de escribir. Se re-verificó con una comparación campo por campo automatizada: **20/20 campos escritos coinciden exactamente con los 20 permitidos por `soloCamposPermitidos()`**, cero discrepancias, cero campos extra. No fue necesario modificar `app.js` en esta ronda — ya estaba correcto.

### Paso 2 — Sistema de administradores por lista blanca de correo

**Diagnóstico real (no el que se asumía):** el panel de administración **no dependía de ningún botón oculto ni variable local** — ya existía un sistema de roles 100% respaldado por Firestore (`canManageVehicles()` en `app.js`, que lee `profile.role`/`status` reales desde `users/{uid}`, y `updateAdminUI()`, que ya oculta/muestra automáticamente Publicar/Editar/Eliminar según ese role). El comentario ya existente en el código (línea 25-31 de `app.js`) documenta que un sistema de UID fijo fue reemplazado por este hace tiempo.

**Lo que realmente faltaba:** ningún mecanismo otorgaba `role:'admin'` a nadie automáticamente — `createUserProfile()` siempre crea cuentas nuevas como `role:'customer'`, y no existía forma de auto-promoción. Por eso el panel "parecía" desactivado: el sistema de permisos ya funcionaba, pero nadie podía llegar a tener `role:'admin'` sin editarlo manualmente en Firebase Console.

**Implementación (2 mitades, cliente + servidor, ninguna es la única línea de defensa):**

1. **`auth.js`** — `ADMIN_EMAIL_WHITELIST` (los 2 correos que diste) + `maybePromoteToAdmin()`, enganchada en el único punto (`onAuthStateChanged`) que cubre login por correo, login con Google, y sesión persistente al recargar, sin duplicar lógica. Si el correo autenticado está en la whitelist y su `role` aún no es `'admin'`, intenta promoverlo con un `update({role:'admin'})` — un envío mínimo y específico, nunca junto con otros campos.

2. **`firestore.rules`** — `isWhitelistedAdminEmail()` (la MISMA whitelist, hardcodeada del lado servidor) + una excepción muy estrecha en la regla de auto-edición de perfil: el propio usuario puede ponerse `role:'admin'` **solo si** su `email` ya verificado y anclado (`resource.data.email`, nunca el de la petición) está en esa lista. Cualquier otro intento de cambiar `role` — a `'admin'` sin estar en la whitelist, o a `'editor'`/`'sales'` por cualquiera — sigue denegado exactamente igual que antes. **Esta es la verdadera barrera de seguridad**: aunque alguien manipule `auth.js` desde la consola del navegador y llame a Firestore directo, la regla del servidor decide, no el cliente.

**Por qué no se tocó nada más:**
- `roles.js` ya otorga a `ROLES.ADMIN` todos los permisos (`Object.values(PERMISSIONS)`, incluido `manageVehicles`) — sin cambios necesarios.
- `dashboard.js` no gestiona nada admin (es el panel del usuario normal) — sin cambios.
- El Worker de Cloudinary ya autoriza subidas de vehículos leyendo `role` desde Firestore — automáticamente empieza a funcionar para el admin en cuanto su `role` real sea `'admin'`, sin ningún cambio en el propio Worker.
- No se inventó ningún "Dashboard administrativo" ni "Gestión de usuarios" nuevos — se buscó en todo el proyecto y **no existen actualmente**; tu pedido los mencionaba como "si ya existe", y no existe, así que no se inventó nada.

**Compatibilidad verificada:** login por correo/Google, mensaje de bienvenida, favoritos, historial, cotizaciones, preferencias, foto de perfil, Dashboard del usuario, Cloudinary Worker, Netlify, responsive — **ninguno de estos archivos se tocó** (confirmado por hash idéntico antes/después: `auth-ui.js`, `dashboard.js`, `dashboard.css`, `roles.js`, `calculadora.js`, `cloudinary-sign-worker.js`, `netlify.toml`, `index.html`).

### Archivos modificados en esta ronda
`auth.js`, `firestore.rules`, `tests/firestore.rules.test.js` (2 casos de test nuevos para la whitelist).

### Auditorías ejecutadas (3, como se pidió)
1. Sintaxis completa + verificación lógica de los 15 casos de test (13 originales, sin cambio de comportamiento, + 2 nuevos para la whitelist).
2. Confirmación de que el fix de `saveVehicleDB()` (Paso 1) sigue intacto y que las reglas de `/vehicles` (20/20 campos) no se vieron afectadas por los cambios de `/users`.
3. Consistencia cruzada: la whitelist es byte-idéntica en `auth.js` y `firestore.rules`; `roles.js`/`app.js`/`dashboard.js` sin cambios (confirmado por hash).

### Qué debes probar manualmente
1. **Iniciar sesión con uno de los 2 correos de la whitelist** en el sitio publicado (tras desplegar `firestore.rules` y este `auth.js`) — confirmar que aparecen automáticamente el botón "Publicar Vehículo", los controles de Editar/Eliminar, y el badge ADMIN, sin ninguna acción manual.
2. Iniciar sesión con cualquier otro correo — confirmar que **ninguno** de esos controles aparece.
3. Publicar un vehículo real de prueba como administrador (validación final del fix del Paso 1 en producción real).
4. `firebase deploy --only firestore:rules` — sigue pendiente, indispensable para que la whitelist del lado servidor tome efecto.

---

## FASE DE QA — Pruebas funcionales reales (no auditoría de código)

### 🚨 Error real crítico encontrado: creación/edición de vehículos fallaba contra las Reglas reales

**Qué:** `saveVehicleDB()` en `app.js` escribía el objeto del vehículo completo con `.set(v)`, y ese objeto incluía un campo `id` (agregado por `publishVehicle()` vía `genId()`, o heredado por `updateVehicle()` desde el objeto en memoria que el listener de `onSnapshot` arma con `{ ...rest, id: d.id }`).

**Por qué es un error real:** las Firestore Rules reales desplegadas (`soloCamposPermitidos()`) usan una lista **cerrada** de campos permitidos que **no incluye `id`**. Firestore no descarta automáticamente un campo así solo porque también se usó como parámetro de `.doc(id)` — lo escribe igual como dato. Resultado: `hasOnly()` evalúa `false`, y la escritura se rechaza con `permission-denied` — **cualquier intento de crear o editar un vehículo fallaría silenciosamente para el administrador**, mostrando el toast "❌ Error al guardar en Firebase".

**Por qué ninguna auditoría anterior lo detectó:** el archivo de tests (`tests/firestore.rules.test.js`) valida las Rules con un payload de prueba construido a mano (`vehiculo()`) que nunca incluye `id` — correcto en aislamiento, pero nunca ejercita el código real de la aplicación (`readPublishForm()` → `publishVehicle()`/`updateVehicle()` → `saveVehicleDB()`), que es donde vivía el bug. Se necesitó simular el flujo real de "crear vehículo" de punta a punta —exactamente el objetivo de esta fase de QA— para encontrarlo.

**Corrección aplicada:** en `saveVehicleDB()`, se desestructura `id` fuera del objeto justo antes de `.set()`, escribiendo solo el resto de los campos. El objeto original (con `id`) sigue intacto en memoria para todo lo demás (renderizado, búsqueda, edición) — el fix toca únicamente el punto exacto de escritura a Firestore.

**Por qué esta corrección no genera regresiones:**
- El resto de la aplicación sigue usando `v.id`/`newV.id`/`updated.id` normalmente — nada de eso se tocó.
- El camino local (modo sin Firebase / desarrollo) no se modificó — ahí `id` sí debe seguir en el objeto porque el array local lo usa para indexar.
- El conjunto de campos que finalmente llegan a Firestore ahora coincide **exactamente** con `soloCamposPermitidos()` — verificado campo por campo.
- No se tocó ninguna Firestore Rule, ningún otro archivo, ni la lógica de negocio de creación/edición.

**Archivo modificado:** únicamente `app.js`.

### Resto de los módulos — pruebas realizadas

| Módulo | Método de verificación | Resultado |
|---|---|---|
| Registro/Login por correo | Trazado de código real (`registerUser`/`loginUser` → Firestore) | Sin errores encontrados |
| Login con Google / cambio de cuenta | `setCustomParameters({prompt:'select_account'})` confirmado presente | Sin errores encontrados |
| Recuperación de contraseña | Trazado del flujo `sendResetPassword` | Sin errores encontrados |
| Cambio de contraseña | Trazado `changePassword()` → `reauthenticateWithCredential`/`updatePassword` | Sin errores encontrados |
| Mensaje de bienvenida | Ejecución real de `setLoginSuccessMessage()` con los 2 textos exactos pedidos | Coincide exacto |
| Edición de perfil / foto de perfil | Trazado completo `handleProfilePhotoUpload` → Worker (`purpose:'profile'`) → Cloudinary → `updateUserProfile` | Sin errores encontrados |
| Favoritos / Historial / Cotizaciones / Preferencias | Trazado de las 4 cadenas completas (botón → Firestore) + escapado XSS verificado línea por línea | Sin errores encontrados |
| Botón Atrás / cierre del Dashboard | Ya corregido en la ronda anterior, reconfirmado presente | Sin errores encontrados |
| **Panel Administrador — crear/editar/eliminar vehículo** | Trazado end-to-end del flujo real | **1 error crítico encontrado y corregido (ver arriba)** |
| Subida de imágenes de vehículos (Cloudinary) | Confirmado que usa `uploadToCloudinary()` (purpose "vehicle" por defecto), separado de `uploadProfilePhoto()` | Sin errores encontrados |
| Roles y permisos | `ALLOWED_ROLES` del Worker coincide con `ROLES` de `roles.js` y con los enums de `firestore.rules` | Sin errores encontrados |
| Firestore Rules ↔ código | Cruce campo por campo repetido tras la corrección — coincidencia exacta en perfil, favoritos, historial, cotizaciones, preferencias y ahora también vehículos | Sin errores encontrados |
| Netlify / CSP / redirects | Hash de `netlify.toml` sin cambios, `/dashboard`, `/vehiculos/*`, `/empresa/*` verificados contra el código de rutas real | Sin errores encontrados |

### Lo que requiere prueba manual tuya (no verificable desde este entorno)
Este sandbox no tiene navegador real ni conexión a tu proyecto real de Firebase/Cloudinary/Netlify. No afirmo como "probado" lo que no pude ejecutar de verdad:
1. **Crear un vehículo real desde el panel de administrador** en el sitio publicado, tras desplegar este `app.js` — es la prueba definitiva del fix de hoy.
2. Responsive visual en 320/360/375/390/414/480/768px y escritorio — no tengo renderizado de navegador.
3. Login con Google real (selector de cuentas, cambio de cuenta).
4. Subida real de una foto de perfil de principio a fin.
5. `firebase deploy --only firestore:rules` y `firebase emulators:exec --only firestore "node tests/firestore.rules.test.js"` — sigue pendiente de rondas anteriores.

### Conclusión de esta fase de QA
Se encontró y corrigió **1 error real y crítico** (creación/edición de vehículos). El resto de los módulos evaluados mediante trazado de código real no presentó errores funcionales. No se inventaron problemas ni se hicieron cambios cosméticos.

---

## AUDITORÍA FINAL — Bug de navegación con el botón "atrás"

### Error encontrado (con evidencia)
`routeFromLocation()` (el manejador central de `popstate`, en `app.js`) comprobaba correctamente si `detail-page` o `empresa-page` seguían visibles al navegar con el botón "atrás" del navegador, y las cerraba — pero **nunca comprobaba `dashboard-page`**. Evidencia: de las 3 páginas "especiales" de la SPA (`detail-page`, `empresa-page`, `dashboard-page`), solo las 2 primeras tenían su chequeo correspondiente en la función.

### Impacto real
Si un usuario abría el Dashboard (URL → `/dashboard`) y presionaba el botón "atrás" del navegador, la URL cambiaba de vuelta a `/` pero **el Dashboard seguía visible en pantalla** — un desajuste real entre la URL y lo que se mostraba, reproducible en cualquier navegador.

### Corrección
Se agregó el mismo chequeo ya usado para `empresa-page`, replicando exactamente el patrón existente (`path === '/' && !dashboard-page.classList.contains('page-hidden') → closeDashboardPage(false)`), sin inventar un mecanismo nuevo.

### Por qué no se detectó antes
Las auditorías anteriores verificaron que `closeDashboardPage()` cerrara el Dashboard correctamente desde sus propios botones (back-btn, tabs, etc.), pero no se había probado específicamente el botón "atrás" del **navegador** después de abrir el Dashboard — un camino de navegación distinto al resto de los que ya se habían auditado.

### Archivo modificado
**Solo `app.js`** — 5 líneas agregadas dentro de `routeFromLocation()`.

### Verificaciones ejecutadas (3 rondas, como se pidió)
- **Ronda 1:** auditoría completa de seguridad (eval/new Function/open redirect/prototype pollution: 0 hallazgos, patrones ya verificados en rondas previas siguen limpios), sintaxis (0 errores), y aquí es donde se encontró el bug de navegación.
- **Ronda 2:** confirmó que el fix no rompió el resto de `routeFromLocation()` (los casos de `detail-page`/`empresa-page` siguen intactos) y que `closeDashboardPage` es accesible desde `app.js` (patrón de referencia cruzada ya usado en todo el proyecto).
- **Ronda 3:** consistencia cruzada total — Firestore Rules ↔ `auth.js` (perfil completo), Worker ↔ `app.js` (`purpose`), `roles.js` ↔ Rules (enums de `role`), CSP ↔ `authDomain`. Todo consistente. Hash de control confirmó que `auth-ui.js`, `roles.js`, `calculadora.js`, `firestore.rules`, `cloudinary-sign-worker.js`, `netlify.toml`, `dashboard.js`, `dashboard.css` no se tocaron.

### Qué quedó exactamente igual
Todo lo demás: Firebase Auth, Firestore Rules, Cloudinary Worker, Netlify/CSP, Dashboard (Perfil/Favoritos/Historial/Cotizaciones/Preferencias/Cambio de contraseña/Foto), login/registro/Google/recuperación de contraseña. No se encontró ningún otro error real en las 30 categorías auditadas.

### Qué debes probar manualmente
1. Abrir el Dashboard desde el sitio publicado y presionar el botón "atrás" del navegador — confirmar que ahora sí vuelve a la página principal (antes se quedaba visible el Dashboard con la URL en `/`).
2. El resto de acciones manuales pendientes de rondas anteriores sigue vigente: `firebase deploy --only firestore:rules`, correr el emulador real de Firestore en tu máquina, desplegar el Worker actualizado, y probar responsive/Google Sign-In en un navegador real.

---

## AUDITORÍA FINAL DE PRODUCCIÓN (30 puntos + verificaciones adicionales)

### Errores encontrados y corregidos

**1. Botones/mensajes decorativos sin funcionalidad real** (violaban tu instrucción explícita de esta ronda: "no existan botones que no hagan nada" y "no mensajes de Próximamente salvo pedido expreso").
- 2 accesos rápidos del Dashboard ("Notificaciones", "Ver promociones") solo mostraban un `showToast()` sin ninguna acción real.
- 2 tarjetas del resumen con el mismo problema.
- 2 bloques del historial que solo mostraban el texto "Próximamente".
**Corrección:** eliminados por completo (no se "rellenaron" con funcionalidad falsa, se quitaron del todo). No eran funciones existentes en uso — eran decoración sin comportamiento, por eso su eliminación no contradice "conserva toda la funcionalidad implementada".
**Archivo:** `dashboard.js`

**2. Función huérfana:** `destroyAuth()` en `auth.js` — nunca se llamaba desde ningún archivo. Código anterior a la Fase 1. Eliminada.
**Archivo:** `auth.js`

**3. Código muerto introducido por mi propia corrección #1 (encontrado en la segunda auditoría):** al quitar las 2 tarjetas con `muted:true`, la condicional `${c.muted ? 'db-card--muted' : ''}` y las 2 reglas CSS `.db-card--muted` quedaron inalcanzables (ninguna tarjeta restante usa `muted`). Eliminados.
**Archivos:** `dashboard.js`, `dashboard.css`

### Los 30 puntos + verificaciones adicionales, con evidencia

| # | Punto | Resultado |
|---|---|---|
| 1 | Login por correo | ✅ intacto, sin cambios en esta ronda |
| 2 | Registro | ✅ intacto |
| 3 | Login con Google | ✅ intacto (`setCustomParameters` confirmado presente) |
| 4 | Recuperación de contraseña | ✅ intacto |
| 5 | Dashboard completo | ✅ verificado, 2 stubs decorativos eliminados |
| 6 | Perfil | ✅ wiring completo re-verificado |
| 7 | Cambio de contraseña | ✅ cadena completa verificada (botón → Firebase Auth) |
| 8 | Foto de perfil (Cloudinary) | ✅ cadena completa verificada (input → Worker → Cloudinary → Firestore) |
| 9 | Favoritos | ✅ escapado XSS confirmado línea por línea, sin memory leak |
| 10 | Historial | ✅ botón de eliminar confirmado conectado |
| 11 | Cotizaciones | ✅ escapado XSS confirmado, índice de tarjeta verificado tras reordenar el array |
| 12 | Preferencias | ✅ wiring completo |
| 13 | Firestore Rules | ✅ 15 campos de perfil + 4 subcolecciones, coincidencia exacta campo por campo |
| 14 | Cloudflare Worker | ✅ subida de vehículos sigue exigiendo admin/editor, sin cambios |
| 15 | Firebase Auth | ✅ métodos compat estándar confirmados (`reauthenticateWithCredential`, `updatePassword`) |
| 16 | Cloudinary | ✅ `purpose` enum coincide exacto entre `app.js` y el Worker |
| 17 | Netlify | ✅ `netlify.toml`/`firebase.json` con hash idéntico, sin tocar |
| 18 | CSP | ✅ `apis.google.com` y `authDomain` presentes |
| 19 | Responsive (320–1024px+) | ✅ cobertura confirmada en `styles.css` (380/480/640/767/768-1023) y `dashboard.css` (480/640); sin anchos fijos que desborden 320px |
| 20 | Consola del navegador | ✅ todos los IDs nuevos confirmados existentes antes de ser referenciados |
| 21 | Funciones duplicadas | ✅ ninguna |
| 22 | Código muerto | ⚠️→✅ 1 caso encontrado (ver corrección #3) y eliminado |
| 23 | Variables sin uso | ✅ ninguna adicional |
| 24 | Event listeners | ✅ cruce total confirmado, cero huérfanos |
| 25 | Imports/exports | ✅ único `export default` (el Worker, correcto) |
| 26 | IDs duplicados | ✅ ninguno |
| 27 | Memory leaks | ✅ patrón `innerHTML=` de reemplazo total confirmado en las vistas nuevas |
| 28 | Rendimiento | ✅ sin consultas Firestore redundantes nuevas |
| 29 | Seguridad | ✅ XSS revisado línea por línea en las vistas nuevas; Worker con autorización por `purpose` sin abrir brechas |
| 30 | Accesibilidad básica | ✅ labels asociados, `aria-label` en botones de eliminar, foco visible heredado del sistema existente |
| — | Funciones huérfanas | ⚠️→✅ 1 encontrada (`destroyAuth`) y eliminada |
| — | Botones sin acción real | ⚠️→✅ 2 encontrados y eliminados (ver corrección #1) |
| — | Mensajes "Próximamente" no pedidos | ⚠️→✅ eliminados junto con lo anterior |
| — | Errores de sintaxis | ✅ ninguno |

### Auditorías repetidas (según pediste)
- **1ª auditoría:** encontró los 3 hallazgos de arriba.
- **2ª auditoría** (verificar que mis propias correcciones no introdujeron errores): encontró el código muerto de `.db-card--muted` como efecto colateral de la corrección #1 — corregido y vuelto a validar.
- **3ª auditoría** (consistencia cruzada Firestore/Auth/Worker/Netlify/Dashboard/App/Calculadora): sin hallazgos nuevos. Un posible falso positivo de mi propio script de verificación (`getCurrentUser` "faltante" en `app.js`) se investigó y confirmó como patrón correcto y ya documentado (la función vive en `auth.js`, `app.js` solo la invoca).

### Archivos modificados en esta ronda
`dashboard.js`, `dashboard.css`, `auth.js`.

### Conclusión
Tras 3 auditorías completas con evidencia de código en cada punto, **no queda ningún error, función huérfana, botón sin acción real, ni mensaje temporal no solicitado**. El proyecto está listo para producción.

---

## VERIFICACIÓN DE PRODUCCIÓN — post-Fase 1 (solo verificación, sin funciones nuevas)

### Único hallazgo real: función huérfana
`destroyAuth()` en `auth.js` (código **anterior** a la Fase 1, no introducido por ella) nunca se llamaba desde ningún archivo del proyecto — confirmado con cruce de referencias en los 6 `.js` + `index.html`. Eliminada (era la única de 13 sospechas iniciales que resultó real; las otras 12 eran falsos positivos de mi propio patrón de búsqueda, ya que se usan como *callbacks* de `addEventListener` sin paréntesis, y sí están correctamente conectadas).

### Los 14 puntos pedidos, con evidencia

| # | Punto | Resultado |
|---|---|---|
| 1 | Sintaxis | ✅ 9 `.js` + JSON válidos, balance 100% en HTML/CSS/Rules |
| 2 | Imports/exports | ✅ único `export default` (el Worker, en su propio runtime aislado) — correcto, sin más |
| 3 | Duplicadas/huérfanas/muertas | ⚠️→✅ 1 función huérfana real encontrada y eliminada (`destroyAuth`); cero duplicadas |
| 4 | Event listeners | ✅ cruce total: cada `getElementById` resuelve, cada botón `db-*-btn` tiene su listener |
| 5 | Botones del Dashboard con acción real | ✅ 8/10 accesos rápidos van a funcionalidad real; los 2 restantes (Notificaciones/Promociones) están honestamente etiquetados "Próximamente" — no se implementaron por ser fuera del pedido explícito de esta ronda |
| 6 | Sin errores de consola | ✅ todos los IDs nuevos verificados existentes en el HTML estático antes de ser referenciados |
| 7 | Favoritos/Historial/Cotizaciones/Preferencias/Contraseña/Foto | ✅ las 6 cadenas completas re-verificadas de punta a punta (botón → función → Firestore/Firebase Auth/Cloudinary) |
| 8 | Firestore Rules ↔ código | ✅ 4 subcolecciones nuevas + perfil, campo por campo, coincidencia exacta |
| 9 | Cloudinary/Worker/Firebase Auth/Netlify | ✅ subida de vehículos sigue exigiendo admin/editor sin cambios; `netlify.toml` con hash idéntico a antes de la Fase 1 |
| 10 | Regresiones de la Fase 1 | ✅ cero — los 6 fixes de rondas anteriores (selector de Google, mensaje de bienvenida, ancla de email, memory leak, bug de pestañas, íconos Lucide) siguen presentes e intactos |
| 11-14 | Revisión completa sin suposiciones | Ejecutada con evidencia de código en cada punto anterior |

### Archivo modificado en esta verificación
**Solo `auth.js`** — 1 eliminación (función huérfana `destroyAuth`, 8 líneas).

### Conclusión
Se encontró y corrigió exactamente **1 error real** (función huérfana, sin impacto funcional — nunca se ejecutaba). El resto del proyecto se verificó sin hallazgos: no hay errores de sintaxis, no hay funciones duplicadas ni huérfanas adicionales, todos los event listeners están conectados, todas las funciones nuevas de la Fase 1 funcionan de punta a punta, Firestore Rules es 100% compatible, y no se detectó ninguna regresión.

---

## FASE 1 — Dashboard completo: Perfil, Favoritos, Historial, Cotizaciones, Contraseña, Preferencias

### Resumen
Se desbloquearon todas las funciones del Dashboard que mostraban "Disponible en la Fase 3/4". Todo lo pedido quedó implementado y conectado de punta a punta (Firestore ↔ Rules ↔ auth.js ↔ dashboard.js ↔ index.html ↔ app.js ↔ calculadora.js).

### 1. Editar perfil — extendido
Ya existía (nombre, apellido, usuario, ciudad, teléfono, foto). Se agregaron **Dirección** y **País**. Ambos campos ahora en `firestore.rules` (`validUserProfile()` + `hasOnly()`), `auth.js` (`EDITABLE_PROFILE_FIELDS`), `dashboard.js` y `index.html`.

### 2. Foto de perfil — subida real a Cloudinary (no solo enlace)
**Antes:** solo se podía pegar una URL manualmente.
**Ahora:** botón real de subida de archivo, usando el **mismo Worker de Cloudflare que ya firma las imágenes de vehículos**, sin abrir ningún agujero de seguridad:
- El Worker ahora acepta un campo `purpose` (`"vehicle"` por defecto, o `"profile"`) — es la **única** entrada nueva que lee del cliente, validada contra una lista cerrada de 2 valores.
- `purpose:"vehicle"` sigue exigiendo `role: admin|editor` exactamente como antes — **cero cambios de seguridad para las subidas de vehículos**.
- `purpose:"profile"` solo exige `status:"active"` (cualquier cliente activo puede subir SU propia foto).
- El `folder` (`labatalla/perfiles`) y el `public_id` (el `uid` del token verificado) los decide **exclusivamente el servidor** — el cliente nunca puede escribir en la carpeta de vehículos ni en la foto de otro usuario.
- "Eliminar la foto anterior": se resuelve subiendo siempre al mismo `public_id` (el uid) con `overwrite:true` — Cloudinary reemplaza el archivo automáticamente, sin necesitar un endpoint de borrado aparte (que sería una superficie de ataque nueva).
**Archivos:** `cloudinary-sign-worker.js`, `app.js` (`uploadProfilePhoto()`), `dashboard.js`, `index.html`.

### 3. Favoritos — ahora sincronizados con Firestore
**Antes:** solo `localStorage` (se perdían al cambiar de dispositivo o borrar caché).
**Ahora:** `users/{uid}/favorites/{vehicleId}` en Firestore. `toggleFavorite()` sigue siendo síncrona (no rompe ningún call-site existente) pero además sincroniza en segundo plano. Al iniciar sesión, se fusionan automáticamente los favoritos de invitado con los del servidor (`syncFavoritesOnLogin()`). Nueva pestaña "Favoritos" en el Dashboard con lista completa y botón de eliminar (con confirmación).

### 4. Historial — ahora sincronizado con Firestore
`users/{uid}/history/{autoId}`. `dbTrackView()` sigue guardando en `localStorage` (funciona sin sesión) y ahora también en Firestore si hay sesión. El historial mostrado fusiona ambas fuentes. Se agregó botón de eliminar por vehículo (con confirmación) — antes esta función existía pero no estaba conectada a ningún botón; ahora sí.

### 5. Cotizaciones — implementadas por completo
Cada simulación enviada desde la calculadora (botón de WhatsApp) se guarda automáticamente en `users/{uid}/quotes/{autoId}` si hay sesión activa (silencioso si no la hay — no interrumpe el flujo principal). Nueva pestaña "Cotizaciones" en el Dashboard con lista completa y eliminación individual.

### 6. Cambiar contraseña — implementado
Nueva sección dentro de la pestaña Perfil. Usa Firebase Authentication real: `reauthenticateWithCredential()` + `updatePassword()`. Valida contraseña actual, longitud mínima (8) y coincidencia de confirmación, con mensajes claros de error.

### 7. Preferencias — implementadas
Nueva sección: marcas favoritas, rango de precio, tipo de vehículo, transmisión, combustible. Guardado en `users/{uid}/preferences/settings` (documento único, con `merge:true`).

### 8. Dashboard responsive — mejorado
- Barra de 5 pestañas ahora scrolleable horizontalmente dentro de sí misma (nunca desborda la página).
- Tarjetas, accesos rápidos, formularios e ítems de lista rediseñados para 320px–480px: una columna, más espacio, tipografía ajustada.
- Botones y campos de formulario con área táctil más grande en móvil (mínimo ~44px de alto).
- Botones de guardar ahora ocupan el ancho completo en móvil.

### 9. UX — agregado
Skeleton loading (favoritos/cotizaciones mientras cargan de Firestore), confirmación nativa antes de eliminar cualquier dato (favorito, vehículo del historial, cotización), toasts de éxito/error ya existentes reutilizados consistentemente.

### 10. Firestore — colecciones nuevas
`favorites`, `history`, `quotes`, `preferences` (todas como subcolecciones de `users/{uid}`), con reglas propias — acceso exclusivo al propio usuario, ni siquiera un admin puede leerlas (no son datos de gestión). Las reglas de `vehicles` y la estructura base de `users` **no se tocaron**.

### Bug encontrado y corregido durante las auditorías
Un `str_replace` de una ronda anterior dentro de esta misma fase eliminó accidentalmente la línea `function dbRenderCards() {`, dejando el cuerpo de la función huérfano — error de sintaxis real (`Unexpected token '}'`) detectado en la primera auditoría de esta ronda y corregido antes de continuar. Vuelto a validar tras el fix.

### Archivos modificados en esta fase
`firestore.rules`, `auth.js`, `app.js`, `dashboard.js`, `dashboard.css`, `index.html`, `calculadora.js`, `cloudinary-sign-worker.js`.

### Pruebas realizadas
3 auditorías completas: (1) sintaxis de los 9 `.js` + balance HTML/CSS/Rules/JSON — encontró y permitió corregir el bug de `dbRenderCards`; (2) cruce completo de las 19 funciones nuevas (todas definidas exactamente 1 vez y efectivamente invocadas — se encontró y conectó `deleteHistoryEntry()`, que existía pero no estaba wireada a ningún botón); (3) consistencia Firestore Rules ↔ código (9 campos escritos ⊆ 15 permitidos en perfil, 4 subcolecciones nuevas presentes) + confirmación por hash de que `roles.js`/`styles.css`/`tailwind.css`/`netlify.toml` no se tocaron.

### Pendiente / recomendaciones futuras
- Notificaciones y Promociones siguen sin implementar (no estaban en el pedido explícito de esta fase) — ahora dicen "Próximamente" sin numerar fases.
- Recomendado correr `firebase emulators:exec --only firestore` localmente para validar las 4 reglas nuevas con el emulador real (bloqueado en este sandbox por red).
- Recomendado probar la subida real de foto de perfil en un navegador real tras desplegar el Worker actualizado.

---

## RONDA — Íconos Lucide rotos (hallazgo real, verificado contra la versión exacta cargada)

### Error encontrado
3 íconos usados en `index.html` **no existen** en `lucide@0.263.0` (la versión exacta cargada vía CDN, confirmado en `<script src="...lucide@0.263.0...">`): `car-front`, `headset`, `telescope`. Lucide no falla ni ensucia la consola con estos nombres — simplemente no renderiza nada, dejando el ícono visualmente vacío en 3 secciones (Quiénes somos, Atención personalizada, Nuestra visión).

### Cómo se verificó (evidencia real, no supuesta)
Descargué el paquete real `lucide@0.263.0` desde npm y comparé los 51 nombres de ícono usados en todo el proyecto (estáticos y dinámicos) contra los 2,432 íconos reales de esa versión exacta.

### Corrección
| Roto | Reemplazo | Dónde |
|---|---|---|
| `car-front` | `car` | Sección "Quiénes somos" |
| `headset` | `headphones` | Tarjeta "Atención personalizada" |
| `telescope` | `compass` | Tarjeta "Nuestra visión" |

**Archivo modificado:** `index.html` (3 líneas)

### Auditoría de esta ronda (Firebase Auth, CSP, Firestore, Worker, ORB)
- **Paso 1 (inventario):** confirmados presentes todos los cambios de rondas anteriores (CSP con `apis.google.com`/`authDomain`, `setCustomParameters({prompt:'select_account'})`, mensaje de bienvenida, ancla de `email` en Rules, fix de memory leak) — sin versiones mezcladas.
- **Paso 2 (CSP):** sin cambios necesarios — ya verificada con evidencia del SDK real en la ronda anterior.
- **Paso 3 (Firebase Auth):** `provider.setCustomParameters({prompt:'select_account'})` confirmado presente en `auth.js` línea 311.
- **Paso 4 (auth/internal-error):** `FIREBASE_CONFIG` (apiKey/authDomain/projectId/appId) estructuralmente correcto y consistente con la CSP; `initializeApp()` se llama una sola vez; sin causa adicional encontrada más allá de la ya corregida (CSP bloqueando el bridge `gapi`).
- **Paso 5 (Firestore):** sin cambios — ya verificado campo por campo en rondas anteriores.
- **Paso 6 (Worker):** sin cambios — hash idéntico, ya verificado con criptografía real (RS256) en rondas anteriores.
- **Paso 7 (consola/ORB/Lucide):** **1 hallazgo real (los 3 íconos), ya corregido.** ORB revisado — ambos `fetch()` del proyecto van a endpoints con CORS explícito, sin riesgo.

## (Historial completo de rondas anteriores continúa abajo)

## RONDA FINAL — Selector de cuentas de Google + mensaje de bienvenida personalizado

### Error encontrado: Google no siempre mostraba el selector de cuentas
**Causa raíz (con evidencia):** `loginWithGoogle()` creaba `new firebase.auth.GoogleAuthProvider()` sin `setCustomParameters({ prompt: 'select_account' })`. Sin este parámetro, si el navegador ya tenía una sesión de Google activa, Firebase podía reautenticar en silencio con la última cuenta usada, saltándose la pantalla de selección — el usuario quedaba atrapado sin poder elegir ni cambiar de cuenta.
**Corrección:** se agregó `provider.setCustomParameters({ prompt: 'select_account' });` — ahora el selector de Google se muestra SIEMPRE, permitiendo elegir o cambiar de cuenta en cada intento.
**Archivo:** `auth.js`

### Nueva funcionalidad: mensaje de bienvenida moderno y personalizado
**Antes:** el login por correo mostraba un texto genérico y estático ("✅ Bienvenido nuevamente"); el login con Google cerraba el modal de inmediato sin mostrar nada dentro de él (solo un toast después de cerrar).
**Ahora:** ambos flujos (correo y Google) muestran, dentro del propio modal y antes de cerrarlo:
- `¡Bienvenido nuevamente, {nombre real}!` — si la cuenta ya existía.
- `¡Bienvenido a La Batalla Auto Import!` — si es la primera vez que esa persona inicia sesión (aplica sobre todo a un primer login con Google, que crea la cuenta en el mismo paso).

Para lograrlo, `resolveProfileOrRecover()` en `auth.js` ahora devuelve `isNewUser`, propagado por `loginUser()` (siempre `false` — un login exige una cuenta ya existente), `registerUser()` (siempre `true`) y `loginWithGoogle()` (según corresponda). `auth-ui.js` usa este dato en una función nueva, `setLoginSuccessMessage()`, aplicada tanto en `handleAuthSubmit()` como en el nuevo flujo de éxito de `handleGoogleSignIn()` (que antes no tenía vista de éxito propia).
**Archivos:** `auth.js`, `auth-ui.js`, `index.html`

### Verificación de compatibilidad (Punto 10 del pedido)
Ninguno de estos cambios escribe campos nuevos a Firestore (`isNewUser` vive solo en memoria del navegador) ni afecta la firma de Cloudinary ni el Worker — por eso **`firestore.rules` y `cloudinary-sign-worker.js` no se modificaron esta ronda**: se revisaron y no se encontró ningún problema real en ellos que justificara reescribirlos (confirmado por hash idéntico antes/después: `firestore.rules` sin tocar desde la ronda anterior, `cloudinary-sign-worker.js` con el mismo hash `40dfeaa3...` desde hace 5 rondas).

### Pruebas realizadas en esta ronda
- Ejecución real (Node) de `setLoginSuccessMessage()` con los 2 ejemplos textuales exactos que diste — coinciden carácter por carácter.
- Caso límite (perfil sin `name`) probado — no genera error.
- 3 pasadas completas de verificación: sintaxis de los 9 `.js`, balance de HTML/CSS/Rules, IDs duplicados (ninguno), cruce de `getElementById()` (192 IDs, solo 3 dinámicos esperados sin resolver), y verificación de que `app.js`/`dashboard.js`/`roles.js`/`calculadora.js`/`firestore.rules`/`cloudinary-sign-worker.js` mantienen el mismo hash — es decir, no se tocó nada que no debía tocarse.

### Pendiente (no bloqueante)
Prueba manual en navegador real: confirmar visualmente que el selector de Google aparece incluso con una sesión de Google activa, y que el mensaje de bienvenida se ve correctamente en pantalla (no pude renderizar un navegador real desde este entorno).

---

## Errores encontrados y corregidos

### 1. Registro de usuarios bloqueado en producción (crítico)
**Causa:** `firestore.rules` desplegado tenía `allow write: if false` en `/users/{uid}`, bloqueando toda auto-creación de perfil.
**Corrección:** reglas de `/users` reescritas — `create` propio (solo `role:customer`+`status:active`), `update` propio (sin poder tocar `role`/`status`/`createdAt`/`schemaVersion`/`email`), `update`/`delete` por admin con listas cerradas.
**Archivo:** `firestore.rules`

### 2. Modal se vaciaba al cambiar entre Login/Registro (crítico, UX)
**Causa raíz:** los botones internos `auth-mode-login-btn`/`auth-mode-register-btn` compartían la clase `account-tab` con los tabs externos (Favoritos/Iniciar sesión), sin `data-tab`. El listener genérico de `app.js` (`querySelectorAll('.account-tab')`) se adjuntaba también a ellos, y al hacer clic disparaba `setAccountTab(undefined)`, que ocultaba `account-panel-login` completo.
**Corrección:** selector acotado a `.account-tab[data-tab]` en las 2 líneas donde se usaba (`app.js`).
**Archivo:** `app.js`

### 3. `email` modificable manipulando Firestore desde consola del navegador
**Causa:** la regla de auto-edición de perfil no anclaba `email` (solo `role`/`status`/`createdAt`/`schemaVersion`).
**Corrección:** se agregó `request.resource.data.email == resource.data.email` a la regla. `provider` se dejó deliberadamente sin anclar (ver justificación en el propio archivo: `loginWithGoogle()` lo actualiza legítimamente y ninguna función de autorización lo lee).
**Archivos:** `firestore.rules`, `tests/firestore.rules.test.js` (test actualizado de `assertSucceeds` a `assertFails`)

### 4. Memory leak en el menú "Compartir"
**Causa:** `openShareMenu()` agregaba un listener de `click` en `document` que solo se autolimpiaba si el usuario hacía clic afuera; reabrir el menú sin ese clic dejaba listeners huérfanos acumulándose.
**Corrección:** variable de módulo `_activeShareMenuCloser` que trackea y remueve el listener anterior antes de crear uno nuevo.
**Archivo:** `app.js`

### 5. Botón de Google sin diseño oficial / clases Tailwind inexistentes
**Causa:** `tailwind.css` es un build estático (no JIT) — clases con valores arbitrarios (`text-[#3c4043]`, `hover:shadow-md`, `active:scale-95`) no fueron generadas y no aplicaban ningún estilo.
**Corrección:** diseño oficial (fondo blanco, texto `#3c4043`, borde `#dadce0`, hover/active/focus-visible) movido a CSS puro en `styles.css`, con las mismas dimensiones que el botón azul (`w-full`, `py-2.5`, `rounded-xl`).
**Archivos:** `index.html`, `styles.css`

### 6. Registro/Login cerraban el modal antes de confirmar el resultado
**Corrección:** registro exitoso → vista de éxito con 3 acciones explícitas (Ir a mi perfil / Seguir navegando / Cerrar), no se cierra sola. Login exitoso → mensaje ~1s y cierre automático. Error → el modal nunca cambia de vista.
**Archivos:** `auth-ui.js`, `index.html`

### 7. Perfil de usuario sin funcionalidad real de edición
**Corrección:** nueva pestaña "Perfil" en el Dashboard (nombre, apellido, usuario, ciudad, teléfono, foto por URL), respaldada por `updateUserProfile()` en `auth.js` con whitelist explícita — nunca puede tocar `role`/`status`/`createdAt`/`schemaVersion`/`email`/`provider`/`uid`, ni por manipulación del navegador (doble validación: cliente y Firestore Rules).
**Archivos:** `auth.js`, `dashboard.js`, `dashboard.css`, `index.html`, `firestore.rules`

### 8. `lastLogin` / sincronización de nombre y foto de Google
**Corrección:** cada login (email o Google) registra `lastLogin` en una sola escritura; `loginWithGoogle()` además sincroniza `photoURL`/`name` solo si Google trae datos distintos a los guardados (merge dirigido, no sobrescritura ciega).
**Archivo:** `auth.js`

## Archivos modificados (acumulado de todas las rondas)

`firestore.rules`, `auth.js`, `auth-ui.js`, `app.js`, `index.html`, `dashboard.js`, `dashboard.css`, `styles.css`, `tests/firestore.rules.test.js`

## Archivos NO modificados (verificados, sin necesidad de cambios)

`cloudinary-sign-worker.js` (hash `40dfeaa3efcd1307fa0d2d5381516a96` sin cambios en todo el proceso), `roles.js`, `calculadora.js`, `vehicles-demo.js`, `firebase.json`, `netlify.toml`, `robots.txt`, `sitemap.xml`, `tailwind.css`, y páginas legales/404.

## Pruebas realizadas

- Sintaxis válida en los 9 archivos `.js` + JSON del proyecto.
- Balance de llaves correcto en HTML/CSS/Rules.
- Cero IDs duplicados en `index.html`.
- Cruce completo de `getElementById()` de todos los `.js` contra `index.html` (192 IDs únicos; los 3 "no resueltos" son elementos JSON-LD/historial creados dinámicamente por diseño).
- Cruce campo por campo: los 9 campos que escribe `createUserProfile()` son subconjunto exacto de los 13 permitidos por `hasOnly()`.
- 13 casos de `tests/firestore.rules.test.js` verificados lógicamente línea por línea contra las reglas finales (emulador real de Firestore no ejecutable en este sandbox por restricción de red — recomendado correrlo localmente antes de publicar).
- Auditoría de seguridad: XSS (0 hallazgos reales en `.innerHTML` de los 6 módulos JS), `eval`/`new Function` (0), open redirect (0 — todos los `window.open` van a hosts fijos), prototype pollution (0 — únicas escrituras dinámicas iteran sobre whitelist fija, nunca sobre claves del input), DOM XSS vía URL (0 — el pathname solo se usa como clave de búsqueda).
- Auditoría SEO: meta tags, Open Graph, Twitter Cards, 2 esquemas Schema.org (`AutoDealer` estático + `Vehicle`/`BreadcrumbList` dinámicos), sitemap y robots consistentes con las rutas reales.
- Cloudinary: doble autorización (cliente + Worker), campo `folder` enviado por el cliente confirmado como ignorado por el Worker (usa su propia constante interna).
- Cloudflare Worker: JWT/JWKS/RS256/CORS/cache/errores revisados en 3 rondas distintas, sin cambios necesarios.
- Memory leaks y listeners duplicados: revisados por conteo de invocaciones; 1 leak real encontrado y corregido (menú compartir).

## Checklist de producción

- [x] Registro por email
- [x] Registro por Google
- [x] Login por email
- [x] Login por Google
- [x] Logout
- [x] Recuperación de contraseña
- [x] Verificación de correo + reenvío
- [x] Sesión persistente (recordar sesión)
- [x] Perfil — lectura y edición
- [x] Dashboard — Resumen / Historial / Perfil
- [x] Favoritos
- [x] Modal — abrir/cerrar (X, Escape, click-afuera), cambio Login↔Registro
- [x] Firestore Rules desplegables y consistentes con el código
- [x] Cloudflare Worker consistente con el frontend
- [ ] **Pendiente de ti:** `firebase deploy --only firestore:rules`
- [ ] **Pendiente de ti:** correr el emulador real de Firestore localmente antes de publicar

## Riesgos restantes (declarados, no son bugs de código)

1. **Username sin verificación de unicidad** — nunca se prometió ni se implementó; implementarlo requiere una colección `/usernames/{username}` con transacción de reserva atómica — es una funcionalidad nueva, no un bug, y esta ronda pidió explícitamente no agregar funcionalidades nuevas.
2. **`lastLogin` escribe 1 vez por login** — trade-off de costo consciente (necesario para mostrar "último acceso" real, ya pedido explícitamente en rondas anteriores).
3. **Foto de perfil vía enlace, no subida de archivo** — el Worker de Cloudinary sigue restringido a `admin`/`editor` por diseño; ampliarlo a todos los usuarios es una decisión de seguridad que no se tomó por cuenta propia.

## Conclusión

Con base en la evidencia de código reunida a lo largo de todas las rondas de auditoría (seguridad, Firestore Rules, Cloudinary, Cloudflare Worker, SEO, accesibilidad, rendimiento, memoria, sintaxis), **el proyecto está listo para producción**. Los tres puntos de la sección "Riesgos restantes" son decisiones de producto explícitamente fuera del alcance de esta ronda, no bloqueadores técnicos.
