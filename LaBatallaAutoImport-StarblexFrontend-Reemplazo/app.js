// ============================================================
// DATA — Vehículos de demo (fallback) viven en vehicles-demo.js
// Se cargan de forma diferida solo si Firebase no está disponible.
// Ver initLocalMode() más abajo.
// ============================================================
// ============================================================
// FIREBASE CONFIG
// ============================================================
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCKbXJMWfsj6d_Cve6JCuKGGFRruvOA8dw",
  authDomain: "la-batalla-auto-import.firebaseapp.com",
  projectId: "la-batalla-auto-import",
  storageBucket: "la-batalla-auto-import.firebasestorage.app",
  messagingSenderId: "933405812389",
  appId: "1:933405812389:web:b499382c98b6dbdb95cf4c"
};
// ————— Variables globales — DEBEN ir antes de Firebase —————
let vehicles = [];
let db = null;
let fbReady = false;
const STORAGE_KEY = 'labatalla_vehicles_v3';
let USD_TO_RD_RATE = 59; // valor de respaldo si Firestore no responde
// El estado de admin depende del usuario autenticado en Firebase Auth Y de que
// su UID coincida exactamente con el admin autorizado (debe ser igual al UID
// usado en las Firestore Security Rules). Así, aunque alguien más se registre
// con email/password, no ve ni puede usar los controles de administración.
// La autorización ya no depende de un UID fijo: role/status vienen del
// perfil real cargado por auth.js (users/{uid}). hasPermission()/ROLES/
// PERMISSIONS/STATUS están definidos en roles.js, cargado antes que este
// archivo; getCurrentUser() vive en auth.js y solo se invoca dentro de
// callbacks que corren tras la carga completa de todos los scripts.
function canManageVehicles() {
  const { profile } = getCurrentUser();
  return !!profile && profile.status === STATUS.ACTIVE && hasPermission(profile.role, PERMISSIONS.MANAGE_VEHICLES);
}
function saveLocal() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles)); } catch(e) {} }
// ————— Fallback final: ni Firebase ni localStorage disponibles —————
function showDataLoadError() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.innerHTML = `<div style="text-align:center;padding:24px;max-width:340px;">
    <i data-lucide="wifi-off" style="width:48px;height:48px;color:#f87171;margin:0 auto 16px;"></i>
    <p style="color:#f1f5f9;font-weight:700;font-size:16px;margin-bottom:8px;">No pudimos cargar el inventario</p>
    <p style="color:#94a3b8;font-size:13px;margin-bottom:20px;line-height:1.5;">Verifica tu conexión a internet o intenta recargar la página. Si usas modo incógnito, prueba en modo normal.</p>
    <button id="reload-btn" style="background:#38bdf8;color:#0f172a;font-weight:800;padding:10px 24px;border:none;border-radius:10px;cursor:pointer;font-size:14px;">Recargar página</button>
  </div>`;
  overlay.style.display = 'flex';
  if (window.lucide) lucide.createIcons();
  const reloadBtn = overlay.querySelector('#reload-btn');
  if (reloadBtn) reloadBtn.addEventListener('click', () => window.location.reload());
}
// ————— Modo local —————
// Fallback si Firebase falla. Orden de prioridad:
//   1. Caché en localStorage (datos REALES de una visita anterior) — cualquier entorno.
//   2. vehicles-demo.js — SOLO en desarrollo (localhost / file://).
//   3. Pantalla de error — producción sin caché. Nunca mostramos
//      inventario ficticio a un visitante real: un cliente podría
//      contactar por un vehículo que no existe.
function isDevEnvironment() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || window.location.protocol === 'file:';
}
function initLocalMode() {
  // El try/catch va SOLO alrededor de la lectura+parseo de la caché. Antes
  // envolvía también a renderSections(), así que cualquier excepción de
  // renderizado se interpretaba como "no hay caché" y se descartaba el
  // inventario real guardado. Nunca se silencia el error: se registra.
  let cached = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) cached = JSON.parse(raw);
  } catch (e) {
    console.warn('Caché local ilegible — se ignora:', e);
  }
  if (Array.isArray(cached) && cached.length > 0) {
    vehicles = cached;
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    renderSections();
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (!isDevEnvironment()) { showDataLoadError(); return; }

  const script = document.createElement('script');
  script.src = '/vehicles-demo.js';
  script.onload = () => {
    vehicles = JSON.parse(JSON.stringify(window.DEFAULT_VEHICLES || []));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vehicles)); } catch(e) {}
    if (vehicles.length === 0) { showDataLoadError(); return; }
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
    renderSections();
    if (window.lucide) lucide.createIcons();
  };
  script.onerror = () => showDataLoadError();
  document.head.appendChild(script);
}
// ————— Estado vacío explícito (reemplaza el auto-seed) —————
// Con el inventario a cero, las tres cabeceras de categoría no aportan nada
// y quien llega se queda sin ninguna salida: antes solo se pintaba el texto
// "Inventario en actualización — vuelve pronto." repetido tres veces, sin
// icono, sin contacto y sin acción posible. Ahora las tres secciones se
// ocultan y en su lugar aparece UN panel con la misma forma que la página
// 404 del sitio (icono + título + explicación + botón), con el WhatsApp del
// negocio ya cargado con el mensaje. El número es el mismo que usan la ficha
// de vehículo, el botón de contacto y el pie de página.
const CATALOG_SECTIONS = ['sedanes', 'suvs', 'pickups'];
const CATALOG_EMPTY_ID = 'catalog-empty';
const WHATSAPP_NUMBER = '18097759771';
const EMPTY_STATE_MESSAGE = 'Hola, vi que ahora mismo no hay vehículos publicados en la web. '
  + '¿Me avisan cuando entre algo? Me interesa saber qué tienen disponible.';

function renderEmptyInventoryState() {
  CATALOG_SECTIONS.forEach(cat => {
    const scroll = document.getElementById(cat + '-scroll');
    const paginationEl = document.getElementById(cat + '-pagination');
    if (scroll) scroll.innerHTML = '';
    if (paginationEl) paginationEl.innerHTML = '';
    const section = document.getElementById(cat);
    if (section) section.hidden = true;
  });
  showCatalogEmptyState();
  renderBrandLogoFilter();
  if (window.lucide) lucide.createIcons();
}

function showCatalogEmptyState() {
  const view = document.getElementById('catalog-view');
  if (!view || document.getElementById(CATALOG_EMPTY_ID)) return;
  const box = document.createElement('section');
  box.id = CATALOG_EMPTY_ID;
  // role="status" + aria-live: el panel sustituye al catálogo DESPUÉS de la
  // carga, así que un lector de pantalla debe anunciar el cambio. El icono
  // es decorativo y se oculta del árbol de accesibilidad.
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.innerHTML = `
    <div class="ce-box">
      <i data-lucide="car-front" class="ce-icon" aria-hidden="true"></i>
      <h2>Estamos renovando el inventario</h2>
      <p>Ahora mismo no hay vehículos publicados. Recibimos unidades nuevas cada semana
         — escríbenos y te avisamos en cuanto entre algo que encaje con lo que buscas.</p>
      <a class="ce-cta" href="https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(EMPTY_STATE_MESSAGE)}"
         target="_blank" rel="noopener noreferrer">
        <svg class="ce-cta-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#icon-whatsapp"></use></svg>
        Avísame por WhatsApp
      </a>
      <a class="ce-link" href="#contacto">Ver todas las formas de contacto</a>
    </div>`;
  view.insertBefore(box, view.firstChild);
}

// Se retira en cuanto entra el primer vehículo: con Firestore en vivo, el
// onSnapshot vuelve a llamar a renderSections() en el momento en que el
// administrador publica, sin recargar la página.
function hideCatalogEmptyState() {
  document.getElementById(CATALOG_EMPTY_ID)?.remove();
  CATALOG_SECTIONS.forEach(cat => {
    const section = document.getElementById(cat);
    if (section) section.hidden = false;
  });
}
// ————— Backfill de slugs (solo admin, una vez por sesión) —————
// Persiste el slug de vehículos publicados antes de esta versión.
// Idempotente: si todos ya tienen slug, no escribe nada. Permite que
// la Edge Function resuelva TODO el inventario con consultas de 1
// lectura, eliminando el escaneo de la colección completa.
let _slugBackfillDone = false;
let _slugBackfillRunning = false;
async function backfillSlugs() {
  if (_slugBackfillDone || _slugBackfillRunning || !fbReady || !db) return;
  // Con sesión cacheada, onAuthStateChanged dispara ANTES de que el primer
  // onSnapshot llene `vehicles`. No marcar como hecho todavía: el propio
  // onSnapshot volverá a invocarnos cuando haya datos.
  if (vehicles.length === 0) return;
  _slugBackfillRunning = true;
  const missing = vehicles.filter(v => !v.slug && v.name);
  if (missing.length === 0) { _slugBackfillDone = true; _slugBackfillRunning = false; return; }
  let okCount = 0;
  // `id` se borra en la MISMA escritura: en un update, las Rules evalúan el
  // documento ya fusionado, así que un `id` heredado (lo llevan los 37
  // vehículos reales) deja la escritura fuera de soloCamposPermitidos() y
  // el backfill se rechazaba SIEMPRE. Borrarlo no pierde información: es una
  // copia exacta del ID del documento, que es como se direcciona.
  const deleteId = (firebase.firestore.FieldValue && firebase.firestore.FieldValue.delete)
    ? firebase.firestore.FieldValue.delete() : undefined;
  for (const v of missing) {
    try {
      const patch = { slug: getVehicleSlug(v) };
      if (deleteId !== undefined) patch.id = deleteId;
      await db.collection('vehicles').doc(v.id).update(patch);
      okCount++;
    } catch (e) {
      // No abortar el resto. Un documento heredado puede llevar campos que
      // no están en la lista cerrada de las Rules (en el inventario real, 4
      // vehículos arrastran una clave `adminKey` de un esquema antiguo que
      // ninguna línea de este código lee). Ese resto NO se borra aquí a
      // propósito: un backfill automático no debe hacer escrituras
      // destructivas sobre datos de producción sin intervención humana.
      // Abrir el vehículo en el panel y pulsar "Guardar Cambios" lo
      // regulariza: saveVehicleDB() escribe solo los campos permitidos.
      console.warn(`Backfill: no se pudo persistir el slug de "${v.name}" (${v.id}). ` +
        'Abre ese vehículo en el panel y pulsa "Guardar Cambios" para regularizarlo.', e);
    }
  }
  _slugBackfillDone = true; // intento completo realizado; no reintentar en bucle
  _slugBackfillRunning = false;
  if (okCount > 0) console.info(`Slugs persistidos para ${okCount} de ${missing.length} vehículo(s) antiguo(s).`);
}
// ============================================================
// ESTADO DE OPERACIONES Y HELPERS
// ============================================================
const operations = { vehicle: { save: false, delete: false } };
// NOTA DE ARQUITECTURA (documentado, no resuelto): el token evita que una
// respuesta OBSOLETA modifique la interfaz, pero no impone orden de
// escritura en Firestore. Para un solo admin/editor esto no ocurre en la
// práctica. Con edición multi-admin del mismo documento haría falta
// resolución de conflictos real (transacciones o updatedAt comparado).
let currentSaveToken = 0;
let currentDeleteToken = 0;

// Clona UN vehículo individual para revertir un cambio optimista si el
// guardado falla. No usar para colecciones completas.
function cloneVehicle(v) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(v); } catch (e) { /* cae al fallback */ }
  }
  return JSON.parse(JSON.stringify(v));
}
// Deshabilita/rehabilita un botón durante una operación async. Opera
// sobre <span class="btn-label"> si existe (no destruye iconos).
function setBtnBusy(btn, busy, busyText, idleText) {
  btn.disabled = busy;
  btn.classList.toggle('opacity-60', busy);
  btn.classList.toggle('pointer-events-none', busy);
  const label = btn.querySelector('.btn-label') || btn;
  label.textContent = busy ? busyText : idleText;
}

// Lista CERRADA de campos que las Firestore Rules aceptan en /vehicles
// (debe coincidir exactamente con soloCamposPermitidos() de firestore.rules).
// Cualquier otra clave hace que la escritura se rechace con permission-denied.
const VEHICLE_FIELDS = [
  'name','price','priceUSD','currency','priceDisplay',
  'category','condition','brand','year','carfax',
  'mileage','color','transmission',
  'features','seoTags','media',
  'tags','slug','img','createdAt'
];
// Deja el documento EXACTAMENTE con los campos permitidos. Resuelve dos
// defectos reales verificados contra el inventario de producción:
//   1. `id` — los 37 vehículos lo llevan como CAMPO además de como ID de
//      documento. Es información duplicada y no está en la lista cerrada.
//   2. `adminKey` — 4 documentos arrastran esta clave de un esquema viejo
//      (ninguna línea del código la lee). Al reenviarla en cada guardado,
//      las Rules rechazaban la edición de esos vehículos.
// Al sanear aquí, guardar un vehículo desde el panel además LIMPIA el
// documento de esos restos.
function sanitizeVehicleForWrite(v) {
  const out = {};
  for (const k of VEHICLE_FIELDS) if (v[k] !== undefined) out[k] = v[k];
  return out;
}
// ————— Guardar vehículo — SOLO persistencia —————
async function saveVehicleDB(v) {
  if (fbReady && db) {
    try {
      // 'id' vive en el objeto en memoria por conveniencia (búsquedas,
      // renderizado, edición), pero NUNCA debe escribirse como CAMPO
      // del documento — solo se usa para direccionarlo (.doc(v.id)).
      // Firestore no lo descarta solo, y las Rules reales desplegadas
      // (soloCamposPermitidos()) no lo incluyen en su lista cerrada:
      // si se manda, la escritura se rechaza con permission-denied.
      const dataToWrite = sanitizeVehicleForWrite(v);
      await db.collection('vehicles').doc(v.id).set(dataToWrite);
      return { success: true };
    } catch (e) {
      console.error('Error guardando:', e);
      return { success: false, error: e };
    }
  }
  try {
    const idx = vehicles.findIndex(x => x.id === v.id);
    if (idx !== -1) vehicles[idx] = v; else vehicles.push(v);
    saveLocal();
    return { success: true };
  } catch (e) {
    return { success: false, error: e };
  }
}
// ————— Eliminar vehículo — SOLO persistencia —————
async function deleteVehicleDB(id) {
  if (fbReady && db) {
    try {
      await db.collection('vehicles').doc(id).delete();
      return { success: true };
    } catch (e) {
      console.error('Error eliminando:', e);
      return { success: false, error: e };
    }
  }
  try {
    vehicles = vehicles.filter(v => v.id !== id);
    saveLocal();
    return { success: true };
  } catch (e) {
    return { success: false, error: e };
  }
}
// ————— Inicializar Firebase —————
function initFirebase() {
  try {
    if (typeof firebase === 'undefined') {
      initLocalMode();
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    // App Check ya configurado con la Site Key de reCAPTCHA v3
    try {
      firebase.appCheck().activate(
        new firebase.appCheck.ReCaptchaV3Provider('6LeiV1AtAAAAAOK0SkpvRnrof2x1hitasCCLoW12'),
        true // auto-refresh del token
      );
    } catch (e) {
      console.error('Error inicializando App Check:', e);
    }
    db = firebase.firestore();
    fbReady = true;
    // Tasa de cambio USD→RD$ configurable — editable por el admin sin
    // tocar código. Requiere la regla `match /config/{docId}` de
    // firestore.rules (lectura pública, escritura solo admin): sin ella
    // esta lectura devuelve permission-denied, el catch la silencia y la
    // tasa se queda en el valor de respaldo de arriba para siempre.
    db.collection('config').doc('finanzas').get().then(doc => {
      if (doc.exists && typeof doc.data().tasaUsdRd === 'number') {
        USD_TO_RD_RATE = doc.data().tasaUsdRd;
      }
    }).catch(() => { /* se mantiene el valor de respaldo */ });
    // Vigilante de carga: si Firestore no entrega el primer snapshot (canal
    // bloqueado, App Check sin resolver, red caída), sin esto el visitante se
    // queda mirando "Cargando La Batalla Auto Import…" indefinidamente —
    // onSnapshot puede no llamar nunca al callback de error. Reproducido en
    // navegador. Tras el plazo se cae al respaldo local (caché real o, en
    // producción sin caché, pantalla de error explícita).
    let firstSnapshotArrived = false;
    const loadWatchdog = setTimeout(() => {
      if (!firstSnapshotArrived) {
        console.warn('Firestore no respondió a tiempo — usando respaldo local.');
        initLocalMode();
      }
    }, 12000);
    db.collection('vehicles').onSnapshot((snap) => {
      firstSnapshotArrived = true;
      clearTimeout(loadWatchdog);
      const fromDB = snap.docs.map(d => {
        const { _deleted, ...rest } = d.data();
        return { ...rest, id: d.id };
      });
      vehicles = fromDB;
      if (canManageVehicles()) backfillSlugs(); // segundo disparador: cubre el caso en que el inventario llega antes de que se resuelva la sesión
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.style.display = 'none';
      if (vehicles.length === 0) {
        renderEmptyInventoryState();
      } else {
        renderSections();
      }
      if (window.lucide) lucide.createIcons();
    }, (err) => {
      firstSnapshotArrived = true;
      clearTimeout(loadWatchdog);
      console.error('Firestore error:', err);
      initLocalMode();
    });
  } catch(e) {
    console.error('Firebase init error:', e);
    try { initLocalMode(); } catch(e2) { showDataLoadError(); }
  }
}
// El arranque (initFirebase) NO se invoca aquí: vive al FINAL de este
// archivo. Motivo (defecto real corregido en esta auditoría): app.js se
// carga con `defer`, así que al llegar a esta línea document.readyState ya
// es 'interactive' y la llamada se ejecutaba de inmediato, a mitad del
// script. initFirebase() -> initLocalMode() -> renderSections() ->
// renderCategory() lee `pageState`, declarado con `const` ~500 líneas más
// abajo: zona muerta temporal (TDZ) -> ReferenceError. El `catch` vacío de
// initLocalMode() lo silenciaba, de modo que el respaldo de localStorage
// NUNCA funcionó: en producción el visitante veía "No pudimos cargar el
// inventario" aunque tuviera una copia válida en caché.
// ============================================================
// HELPERS
// ============================================================
function fmtPrice(p, v) {
  if (v && v.priceDisplay) return v.priceDisplay;
  return 'RD$ ' + Number(p).toLocaleString('es-DO');
}

// ============================================================
// IMPORTES — valor interno (número) separado del valor mostrado
// ------------------------------------------------------------
// El campo de precio era <input type="number">. Ese tipo NO admite
// separadores de miles: en cuanto el navegador encuentra la segunda coma
// el valor deja de ser un "floating-point number" válido y `.value`
// devuelve "" — `parseFloat("")` es NaN y la publicación se rechazaba
// con "el precio debe ser mayor que cero", sin decir nunca que el
// problema era la coma. En el teclado numérico de Android la coma está
// junto al 0, así que escribir "1,550,000" era el camino natural... y el
// único que no funcionaba.
//
// El patrón es el que ya usaba la calculadora para el monto inicial:
// input de TEXTO, se conserva el NÚMERO para calcular y persistir, y se
// muestra el texto formateado. Convención dominicana (es-DO): coma para
// los miles, punto para los decimales.
// ============================================================

// Tope máximo de precio en RD$. Debe coincidir con firestore.rules
// (`d.price < 2000000000`): validarlo también aquí convierte un rechazo
// silencioso del servidor en un mensaje que explica qué corregir.
const MAX_PRICE_RD = 2000000000;
// Tope de firestore.rules para `priceUSD` (`< 20000000`).
const MAX_PRICE_USD = 20000000;

// "1,550,000.50" -> 1550000.5 · "" o texto sin cifras -> NaN
function parseAmount(value) {
  // La coma es SIEMPRE separador de miles (es-DO, y es lo que emite
  // formatAmount). El punto solo es decimal cuando hay uno único y le
  // siguen una o dos cifras — los céntimos; en cualquier otro caso
  // ("1.550.000", formato europeo que algunos teclados producen) también
  // separa miles. Así ninguna forma razonable de teclear el importe
  // acaba interpretada como un número mil veces menor.
  let raw = String(value == null ? '' : value).replace(/[^\d.,]/g, '').replace(/,/g, '');
  const dots = raw.split('.');
  raw = (dots.length === 2 && /^\d{1,2}$/.test(dots[1])) ? dots[0] + '.' + dots[1] : dots.join('');
  if (!/^\d+(\.\d+)?$/.test(raw)) return NaN;
  return Number(raw);
}

// 1550000 -> "1,550,000" · 1550000.5 -> "1,550,000.5"
function formatAmount(n) {
  if (!Number.isFinite(n)) return '';
  const [entera, decimal] = String(n).split('.');
  const agrupada = Number(entera).toLocaleString('es-DO');
  return decimal ? `${agrupada}.${decimal}` : agrupada;
}

// Formatea mientras se escribe y recoloca el cursor contando CIFRAS a su
// izquierda: los separadores aparecen y desaparecen con cada pulsación,
// así que la posición absoluta no sirve como referencia.
function attachAmountFormatter(input) {
  if (!input || input.dataset.amountFormatter) return;
  input.dataset.amountFormatter = '1';
  input.addEventListener('input', () => {
    const antes = input.value;
    const caret = input.selectionStart == null ? antes.length : input.selectionStart;
    const cifrasIzquierda = antes.slice(0, caret).replace(/\D/g, '').length;
    const n = parseAmount(antes);
    if (!Number.isFinite(n)) return; // campo vacío o a medio escribir: no estorbar
    // Un punto recién tecleado ("1500." o "1500.5") desaparecería al
    // formatear e impediría escribir decimales, así que se respeta tal
    // cual mientras el importe se está escribiendo.
    const cola = /\.\d{0,2}$/.test(antes) ? antes.slice(antes.indexOf('.')) : '';
    const formateado = cola ? formatAmount(Math.trunc(n)) + cola : formatAmount(n);
    if (formateado === antes) return;
    input.value = formateado;
    let pos = 0;
    let vistas = 0;
    while (pos < formateado.length && vistas < cifrasIzquierda) {
      if (/\d/.test(formateado[pos])) vistas++;
      pos++;
    }
    try { input.setSelectionRange(pos, pos); } catch (e) { /* input sin selección */ }
  });
  // Al salir del campo se normaliza: "1.550.000" o "1550000" quedan
  // igual de legibles que si se hubieran escrito con separadores.
  input.addEventListener('blur', () => {
    const n = parseAmount(input.value);
    input.value = Number.isFinite(n) ? formatAmount(n) : '';
  });
}
// ============================================================
// ROUTING REAL — Slugs y URLs por vehículo (reemplaza #auto-id)
// ============================================================
// Convierte "BMW 330i 2024" -> "bmw-330i-2024"
// FASE 8 (auditoría de pre-lanzamiento): unificado con scripts/generar-sitemap.js
// y netlify/edge-functions/vehicle-og.js — las 3 implementaciones eran
// idénticas en todos los casos reales (acentos, símbolos, espacios,
// mayúsculas, unicode) y solo divergían si `text` era null/undefined:
// antes, `String(null)` producía el slug literal "null" aquí, mientras
// los otros dos ya devolvían "" (String(text ?? '')). No hay evidencia
// de que un vehículo real llegue con `name` nulo, pero se corrige para
// que las 3 funciones sean deterministas y equivalentes byte a byte en
// TODOS los casos, no solo en los que ocurren hoy. No cambia ningún
// slug ya generado (mismo resultado para cualquier nombre real).
function slugify(text) {
  return String(text ?? '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
// Slug único por vehículo. Si el nombre genera un slug duplicado
// entre vehículos activos, se le agrega un sufijo corto del id
// para que cada URL sea siempre única (dos vehículos distintos
// nunca deben compartir la misma URL — rompería el SEO).
function getVehicleSlug(v) {
  if (v.slug) return v.slug; // si en el futuro guardas el slug en Firestore, se respeta
  const base = slugify(v.name);
  const collision = vehicles.some(x => x.id !== v.id && slugify(x.name) === base);
  return collision ? `${base}-${v.id.slice(-5)}` : base;
}
function getBaseUrl() {
  return (window.location.hostname === 'localhost' || window.location.protocol === 'file:')
    ? 'https://labatallaautoimport.netlify.app' : window.location.origin;
}
function getVehiclePath(v) { return `/vehiculos/${getVehicleSlug(v)}`; }
// Genera un slug ÚNICO en el momento de crear el vehículo. Se guarda
// en Firestore y nunca cambia aunque el nombre se edite después —
// así los enlaces ya compartidos por WhatsApp siguen funcionando.
function generateUniqueSlug(name, excludeId) {
  const base = slugify(name);
  const taken = vehicles.some(x => x.id !== excludeId && getVehicleSlug(x) === base);
  return taken ? `${base}-${String(Date.now()).slice(-5)}` : base;
}
function getVehicleUrl(v) { return `${getBaseUrl()}${getVehiclePath(v)}`; }
// Busca un vehículo a partir del slug en la URL actual
function findVehicleBySlug(slug) {
  return vehicles.find(v => getVehicleSlug(v) === slug);
}
// Escapa texto para insertarlo de forma segura en innerHTML (anti-XSS).
// Cualquier dato que venga de Firestore y vaya a innerHTML debe pasar por aquí.
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Escapa para usar dentro de un atributo entre comillas (src, alt, data-id, href)
function escapeAttr(str) { return escapeHtml(str); }
// Resuelve la foto de portada de un vehículo desde el esquema real de
// `media` ({type, src} o string suelto de registros antiguos), cayendo a
// `img` y por último al placeholder que se le indique. Antes cada punto
// de render resolvía esto por su cuenta con criterios distintos: uno caía
// al propio objeto de media (renderizaba src="[object Object]", petición
// 404 real) y dos caían a cadena vacía (<img src=""> vuelve a pedir el
// documento HTML completo). Un solo criterio para todos.
function getVehicleCover(v, placeholder) {
  const first = v && Array.isArray(v.media) && v.media.length > 0 ? v.media[0] : null;
  if (typeof first === 'string' && first) return first;
  if (first && typeof first.src === 'string' && first.src) return first.src;
  return (v && typeof v.img === 'string' && v.img) ? v.img : placeholder;
}
// Inserta una transformación de Cloudinary (f_auto,q_auto + ancho) en
// cualquier URL que provenga de Cloudinary. Si la URL no es de
// Cloudinary (ej. placehold.co, Pexels demo), la devuelve intacta.
function cldOptimize(url, width) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const transform = `f_auto,q_auto,c_fill,w_${width}`;
  return url.replace('/upload/', `/upload/${transform}/`);
}
// ============================================================
// SEO DINÁMICO — meta tags + JSON-LD por vehículo (mejora previews
// de WhatsApp/Facebook y ayuda a Google a entender el contenido)
// ============================================================
const SEO_DEFAULT = {
  title: 'La Batalla Auto Import | Sedanes, SUVs y Camionetas en República Dominicana',
  description: 'Compra tu próximo vehículo en La Batalla Auto Import. Sedanes, SUVs y camionetas nuevas, usadas e importadas en Santo Domingo, San Francisco de Macorís y Nagua. Financiamiento disponible.'
};
function setMetaTag(selector, attr, value) { const el = document.querySelector(selector); if (el) el.setAttribute(attr, value); }
// Actualiza (o crea si no existe) el <link rel="canonical">.
// El canonical le dice a Google cuál es la URL "oficial" de cada
// página — sin esto, si la misma ficha fuera accesible por dos rutas
// distintas, Google podría diluir el posicionamiento entre ambas.
function setCanonical(url) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
}
function updateSeoForVehicle(v) {
  const title = `${v.name} — ${fmtPrice(v.price, v)} | La Batalla Auto Import`;
  const desc = `${v.name} ${v.condition === 'nuevo' ? 'nuevo' : 'usado'} en venta. ${fmtPrice(v.price, v)}. ` +
    `${v.mileage ? 'Millaje: ' + v.mileage + '. ' : ''}${v.color ? 'Color ' + v.color + '. ' : ''}` +
    `Financiamiento disponible en La Batalla Auto Import, Santo Domingo.`;
  const url = getVehicleUrl(v);
  document.title = title;
  setMetaTag('meta[name="description"]', 'content', desc);
  setMetaTag('meta[property="og:title"]', 'content', title);
  setMetaTag('meta[property="og:description"]', 'content', desc);
  setMetaTag('meta[property="og:url"]', 'content', url);
  setMetaTag('meta[name="twitter:title"]', 'content', title);
  setMetaTag('meta[name="twitter:description"]', 'content', desc);
  setCanonical(url);
  const rawImg = getVehicleCover(v, '');
  const img = cldOptimize(rawImg, 1200); // mismo criterio que la Edge Function vehicle-og.js
  if (img) { setMetaTag('meta[property="og:image"]', 'content', img); setMetaTag('meta[name="twitter:image"]', 'content', img); }
  injectVehicleJsonLd(v);
  injectBreadcrumbJsonLd(v);
}
function resetSeoToDefault() {
  document.title = SEO_DEFAULT.title;
  setMetaTag('meta[name="description"]', 'content', SEO_DEFAULT.description);
  setMetaTag('meta[property="og:title"]', 'content', SEO_DEFAULT.title);
  setMetaTag('meta[property="og:description"]', 'content', SEO_DEFAULT.description);
  setMetaTag('meta[property="og:url"]', 'content', getBaseUrl() + '/');
  setMetaTag('meta[name="twitter:title"]', 'content', SEO_DEFAULT.title);
  setMetaTag('meta[name="twitter:description"]', 'content', SEO_DEFAULT.description);
  setCanonical(getBaseUrl() + '/');
  document.getElementById('vehicle-jsonld')?.remove();
  document.getElementById('breadcrumb-jsonld')?.remove();
}
// Datos estructurados — le indican a Google explícitamente "esto es un vehículo en venta"
function injectVehicleJsonLd(v) {
  document.getElementById('vehicle-jsonld')?.remove();
  const img = getVehicleCover(v, '');
  const keywords = Array.isArray(v.seoTags) ? v.seoTags : [];
  const data = {
    "@context": "https://schema.org", "@type": "Vehicle", "name": v.name,
    "url": getVehicleUrl(v),
    "brand": v.brand || undefined, "vehicleModelDate": v.year || undefined,
    "mileageFromOdometer": v.mileage ? { "@type": "QuantitativeValue", "value": v.mileage, "unitCode": "KMT" } : undefined,
    "color": v.color || undefined, "vehicleTransmission": v.transmission || undefined,
    "image": img || undefined, "keywords": keywords.length ? keywords.join(', ') : undefined,
    "offers": { "@type": "Offer", "price": v.price, "priceCurrency": "DOP", "availability": "https://schema.org/InStock",
      "url": getVehicleUrl(v),
      "itemCondition": v.condition === 'nuevo' ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
      "seller": { "@type": "AutoDealer", "name": "La Batalla Auto Import" } }
  };
  const script = document.createElement('script');
  script.type = 'application/ld+json'; script.id = 'vehicle-jsonld'; script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}
// Breadcrumbs — ayudan a Google a entender la jerarquía del sitio
// (Home > Categoría > Vehículo) y a menudo se muestran en los
// resultados de búsqueda en vez de la URL cruda.
function injectBreadcrumbJsonLd(v) {
  document.getElementById('breadcrumb-jsonld')?.remove();
  const catLabel = v.category === 'sedanes' ? 'Sedanes' : v.category === 'suvs' ? 'SUVs' : 'Camionetas';
  const data = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": getBaseUrl() + '/' },
      { "@type": "ListItem", "position": 2, "name": catLabel, "item": getBaseUrl() + '/#' + v.category },
      { "@type": "ListItem", "position": 3, "name": v.name, "item": getVehicleUrl(v) }
    ]
  };
  const script = document.createElement('script');
  script.type = 'application/ld+json'; script.id = 'breadcrumb-jsonld'; script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}
function genId() {
  return 'v' + Date.now() + Math.floor(Math.random()*1000);
}
function showToast(msg, duration=2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}
// Un clic con Ctrl/Cmd/Shift/Alt o con el botón central significa "ábrelo
// en otra pestaña/ventana". Interceptarlo con preventDefault() rompía esa
// expectativa en TODAS las tarjetas del catálogo: el enlace existía pero no
// se podía abrir aparte. Con esto, el enrutado SPA solo actúa en el clic normal.
function isModifiedClick(e) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === 'number' && e.button !== 0);
}
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
// ============================================================
// RENDER VEHICLE CARD
// ============================================================
function renderCard(v) {
  const imgSrc = getVehicleCover(v, 'https://placehold.co/300x176/1e293b/38bdf8?text=Auto');
  const div = document.createElement('div');
  div.className = 'vehicle-card rounded-xl overflow-hidden shadow-lg relative';
  div.style.background = 'rgb(30,41,59)';
  div.dataset.id = v.id;
  // ¿Es nuevo? (publicado hace menos de 5 días)
  let isNew = false;
  if (v.createdAt) {
    const days = (Date.now() - v.createdAt) / 86400000;
    isNew = days <= 5;
  }
  // Tags destacados
  const tagDefs = {
    financiamiento: { label: '💰 Financiamiento', color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
    negociable: { label: '🤝 Negociable', color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
    unicodueno: { label: '👤 Único dueño', color: '#a78bfa', bg: 'rgba(167,139,250,0.15)' },
    importado: { label: '🌎 Importado', color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
  };
  const activeTags = Object.keys(tagDefs).filter(k => v.tags && v.tags[k]);
  // Favoritos
  const isFav = isFavorite(v.id);
  const vehicleUrl = getVehicleUrl(v);
  const vehiclePath = getVehiclePath(v);
  div.innerHTML = `
    <div class="relative card-image-link">
      <img src="${escapeAttr(cldOptimize(imgSrc, 500))}" class="w-full h-44 object-cover" loading="lazy" alt="${escapeAttr(v.name)}" data-fallback="https://placehold.co/300x176/1e293b/38bdf8?text=Auto">
      <a href="${escapeAttr(vehiclePath)}" class="card-image-overlay" data-id="${escapeAttr(v.id)}" aria-label="Ver ${escapeAttr(v.name)}"></a>
      ${isNew ? `<span class="absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full" style="background:#38bdf8;color:#0f172a;">✨ NUEVO</span>` : ''}
      <button type="button" class="fav-btn absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center transition" data-id="${escapeAttr(v.id)}" aria-label="Agregar a favoritos" style="background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);z-index:2;">
        <i data-lucide="heart" class="fav-icon w-4 h-4 pointer-events-none" style="color:${isFav ? '#f87171' : '#fff'};fill:${isFav ? '#f87171' : 'none'};"></i>
      </button>
    </div>
    <div class="p-4">
      <h3 class="font-bold mb-1" style="color:rgb(248,250,252); font-size:19px;">${escapeHtml(v.name)}</h3>
      <span class="font-bold text-lg block mb-2" style="color:rgb(56,189,248);">${escapeHtml(fmtPrice(v.price, v))}</span>
      <div class="flex gap-1 mb-2 flex-wrap">
        <span class="text-xs px-2 py-1 rounded-full" style="background:rgba(14,165,233,0.15); color:#38bdf8;">${v.category === 'sedanes' ? 'Sedán' : v.category === 'suvs' ? 'SUV' : 'Camioneta'}</span>
        <span class="text-xs px-2 py-1 rounded-full" style="background:rgba(100,116,139,0.2); color:#94a3b8;">${v.condition === 'nuevo' ? 'Nuevo' : v.condition === 'importado' ? 'Importado' : 'Usado'}</span>
      </div>
      ${activeTags.length > 0 ? `<div class="flex gap-1 mb-3 flex-wrap">${activeTags.map(t => `<span class="text-xs px-2 py-1 rounded-full font-semibold" style="background:${tagDefs[t].bg};color:${tagDefs[t].color};">${tagDefs[t].label}</span>`).join('')}</div>` : '<div class="mb-1"></div>'}
      <div class="flex gap-2">
        <a href="${escapeAttr(vehiclePath)}" class="ver-btn flex-1 px-3 py-2 rounded-lg font-medium text-sm text-center" data-id="${escapeAttr(v.id)}"
          style="background:rgb(14,165,233); color:#042c53; font-weight:700;">Ver Características</a>
        <a href="https://wa.me/18097759771?text=${encodeURIComponent('Hola, estoy interesado en el ' + v.name + ' (' + fmtPrice(v.price, v) + ') de La Batalla Auto Import. ¿Está disponible?\n\n🔗 ' + vehicleUrl)}" target="_blank" rel="noopener noreferrer"
          class="px-3 py-2 rounded-lg font-medium text-center text-sm flex items-center justify-center"
          style="background:rgb(34,197,94); color:#052e16;" title="WhatsApp">
          <svg class="w-4 h-4 fill-current"><use href="#icon-whatsapp"/></svg>
        </a>
        <button type="button" class="share-btn px-3 py-2 rounded-lg font-medium text-sm flex items-center justify-center" data-id="${escapeAttr(v.id)}" data-name="${escapeAttr(v.name)}" data-price="${escapeAttr(fmtPrice(v.price, v))}"
          style="background:rgba(148,163,184,0.15); color:#cbd5e1;" title="Compartir">
          <i data-lucide="share-2" class="w-4 h-4 pointer-events-none"></i>
        </button>
      </div>
    </div>`;
  return div;
}
// ============================================================
// FAVORITOS
// ============================================================
const FAV_KEY = 'labatalla_favorites_v1';
function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e) { return []; }
}
function isFavorite(id) { return getFavorites().includes(id); }
function toggleFavorite(id) {
  let favs = getFavorites();
  const nowFav = !favs.includes(id);
  if (favs.includes(id)) favs = favs.filter(x => x !== id);
  else favs.push(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch(e) {}

  // Fase 1 — sincronización con Firestore: si hay sesión, se replica en
  // segundo plano (fire-and-forget) sin bloquear ni cambiar el resultado
  // síncrono que ya esperan todos los call-sites existentes. Si falla
  // (sin red, por ejemplo), el favorito sigue funcionando localmente.
  try {
    const { user } = typeof getCurrentUser === 'function' ? getCurrentUser() : {};
    if (user && typeof toggleFavoriteRemote === 'function') {
      toggleFavoriteRemote(id, nowFav).catch(() => {});
    }
  } catch (e) { /* auth.js aún no listo o sin sesión — no crítico */ }

  return favs.includes(id);
}

// Fusiona favoritos remotos (Firestore) con los locales al iniciar sesión,
// para que un usuario que ya marcó favoritos como invitado no los pierda,
// y para que vea sus favoritos de otros dispositivos/sesiones.
async function syncFavoritesOnLogin() {
  if (typeof getFavoritesRemote !== 'function') return;
  const remote = await getFavoritesRemote();
  if (!remote.success) return;
  const local = getFavorites();
  const merged = Array.from(new Set([...local, ...remote.ids]));
  try { localStorage.setItem(FAV_KEY, JSON.stringify(merged)); } catch (e) {}
  // Sube al servidor los que solo existían localmente (favoritos de invitado).
  const onlyLocal = local.filter(id => !remote.ids.includes(id));
  for (const id of onlyLocal) {
    try { await toggleFavoriteRemote(id, true); } catch (e) {}
  }
}
// ============================================================
// SHARE — WhatsApp / Facebook / Instagram
// ============================================================
// Rastrea el listener de "clic afuera" del menú de compartir para poder
// limpiarlo explícitamente si el menú se reabre sin que el usuario haya
// hecho clic afuera del anterior — sin esto, cada reapertura sin cierre
// previo dejaba un listener huérfano en document (memory leak real,
// aunque acotado: se resuelve solo, se recargar la página).
let _activeShareMenuCloser = null;
function openShareMenu(id, name, price, anchorEl) {
  const shareV = vehicles.find(x => x.id === id);
  const vehicleUrl = shareV ? getVehicleUrl(shareV) : getBaseUrl();
  const text = `Mira este ${name} (${price}) en La Batalla Auto Import`;
  // Quitar menú existente si hay uno abierto
  document.querySelectorAll('.share-menu-popup').forEach(m => m.remove());
  if (_activeShareMenuCloser) {
    document.removeEventListener('click', _activeShareMenuCloser);
    _activeShareMenuCloser = null;
  }
  const menu = document.createElement('div');
  menu.className = 'share-menu-popup';
  menu.style.cssText = 'position:fixed;z-index:99999;background:rgb(30,41,59);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:8px;box-shadow:0 8px 30px rgba(0,0,0,0.55);display:flex;flex-direction:column;gap:4px;min-width:190px;visibility:hidden;';
  const items = [
    { label: 'WhatsApp', icon: '💬', action: () => window.open(`https://wa.me/?text=${encodeURIComponent(text + '\n\n🔗 ' + vehicleUrl)}`, '_blank') },
    { label: 'Facebook', icon: '📘', action: () => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(vehicleUrl)}`, '_blank') },
    { label: 'Instagram', icon: '📷', action: () => { navigator.clipboard?.writeText(vehicleUrl).catch(()=>{}); window.open('https://www.instagram.com/jmsanchez1015', '_blank'); showToast('🔗 Link copiado — pégalo en tu historia'); } },
    { label: 'Copiar link', icon: '🔗', action: () => {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(vehicleUrl).then(()=>showToast('✅ Link copiado')).catch(()=>fallbackCopy(vehicleUrl));
        } else { fallbackCopy(vehicleUrl); }
      } },
  ];
  items.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-200 hover:bg-slate-700 transition text-left';
    btn.innerHTML = `<span>${item.icon}</span><span>${item.label}</span>`;
    btn.addEventListener('click', (ev) => { ev.stopPropagation(); item.action(); menu.remove(); });
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  // Calcular posición DESPUÉS de insertar el menú (ya con su tamaño real)
  const rect = anchorEl.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  let top = rect.bottom + 6;
  let left = rect.left - menuRect.width + rect.width;
  // Evitar que se salga de la pantalla
  if (left < 8) left = 8;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 6;
  if (top < 8) top = 8;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
  menu.style.visibility = 'visible';
  setTimeout(() => {
    _activeShareMenuCloser = function closeMenu(e) {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
        _activeShareMenuCloser = null;
      }
    };
    document.addEventListener('click', _activeShareMenuCloser);
  }, 50);
}
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('✅ Link copiado');
  } catch(e) {
    showToast('⚠️ No se pudo copiar — copia manualmente: ' + text, 4000);
  }
}
// Delegated click handlers for fav and share buttons
document.addEventListener('click', e => {
  const favBtn = e.target.closest('.fav-btn');
  if (favBtn) {
    e.preventDefault();
    e.stopPropagation();
    const id = favBtn.dataset.id;
    const nowFav = toggleFavorite(id);
    // Tras lucide.createIcons() el <i> se convierte en <svg>, por eso buscamos ambos
    const icon = favBtn.querySelector('svg, i');
    if (icon) {
      icon.style.color = nowFav ? '#f87171' : '#fff';
      icon.style.fill = nowFav ? '#f87171' : 'none';
    }
    showToast(nowFav ? '❤️ Agregado a favoritos' : '💔 Eliminado de favoritos');
    refreshFavoritesPanelIfOpen();
    return;
  }
  const shareBtn = e.target.closest('.share-btn');
  if (shareBtn) {
    e.preventDefault();
    e.stopPropagation();
    openShareMenu(shareBtn.dataset.id, shareBtn.dataset.name, shareBtn.dataset.price, shareBtn);
  }
  // Click/tap en la imagen del vehículo → abre la ficha. Ahora es un <a>
  // real con href, así que el teclado (Enter), el menú contextual y
  // "abrir en pestaña nueva" funcionan solos: no hace falta keydown propio.
  const cardImg = e.target.closest('.card-image-overlay');
  if (cardImg && !isModifiedClick(e)) {
    e.preventDefault();
    openDetail(cardImg.dataset.id);
  }
});
// ============================================================
// MI CUENTA — Login simple (localStorage) + panel de Favoritos
// ============================================================
// Cuenta SOLO los favoritos que siguen existiendo en el inventario. Antes
// contaba los identificadores guardados en bruto, y el panel de favoritos
// (renderAccountFavorites) sí filtra por vehículo existente: al retirarse una
// publicación, el globo del menú seguía marcando "3" mientras el panel decía
// "Aún no tienes vehículos favoritos". Reproducido en navegador con el
// catálogo vacío. Mientras el inventario no ha cargado todavía
// (`vehicles` vacío en el primer render) no se inventa un número: el globo
// queda oculto y se actualiza solo en cuanto llega el primer snapshot.
function countExistingFavorites() {
  const favIds = getFavorites();
  if (favIds.length === 0) return 0;
  return favIds.filter(id => vehicles.some(v => v.id === id)).length;
}
function updateNavFavCount() {
  const el = document.getElementById('nav-fav-count');
  if (!el) return;
  const n = countExistingFavorites();
  if (n > 0) {
    el.textContent = n > 99 ? '99+' : n;
    el.classList.remove('hidden');
    el.classList.add('flex');
  } else {
    el.classList.add('hidden');
    el.classList.remove('flex');
  }
}
function renderAccountFavorites() {
  const grid = document.getElementById('account-fav-grid');
  const empty = document.getElementById('account-fav-empty');
  if (!grid) return;
  const favIds = getFavorites();
  const items = favIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean);
  grid.innerHTML = '';
  if (items.length === 0) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.classList.remove('hidden');
  items.forEach(v => {
    const imgSrc = getVehicleCover(v, 'https://placehold.co/300x176/1e293b/38bdf8?text=Auto');
    const card = document.createElement('div');
    card.className = 'rounded-xl overflow-hidden cursor-pointer relative group';
    card.style.cssText = 'background:rgb(30,41,59);border:1px solid rgba(255,255,255,0.07);';
    card.innerHTML = `
      <div style="height:90px;overflow:hidden;position:relative;">
        <img src="${escapeAttr(cldOptimize(imgSrc, 300))}" alt="${escapeAttr(v.name)}" style="width:100%;height:100%;object-fit:cover;" data-fallback="https://placehold.co/300x120/1e293b/38bdf8?text=Auto">
        <button type="button" class="account-fav-remove-btn absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center" data-id="${escapeAttr(v.id)}" style="background:rgba(15,23,42,0.75);">
          <i data-lucide="x" class="w-3 h-3 text-white pointer-events-none"></i>
        </button>
      </div>
      <div style="padding:8px 10px 10px;">
        <p style="color:#f1f5f9;font-weight:700;font-size:12px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(v.name)}</p>
        <p style="color:#38bdf8;font-weight:800;font-size:12px;">${escapeHtml(fmtPrice(v.price, v))}</p>
      </div>`;
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('.account-fav-remove-btn')) return;
      closeAccountModal();
      window.scrollTo(0,0);
      openDetail(v.id);
    });
    grid.appendChild(card);
  });
  grid.querySelectorAll('.account-fav-remove-btn').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleFavorite(btn.dataset.id);
      renderAccountFavorites();
      updateNavFavCount();
      showToast('💔 Eliminado de favoritos');
    });
  });
}
function refreshFavoritesPanelIfOpen() {
  updateNavFavCount();
  if (!document.getElementById('account-modal')?.classList.contains('hidden')) {
    renderAccountFavorites();
  }
}
function setAccountTab(tab) {
  document.querySelectorAll('.account-tab[data-tab]').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('account-panel-fav').classList.toggle('hidden', tab !== 'fav');
  document.getElementById('account-panel-login').classList.toggle('hidden', tab !== 'login');
}
function openAccountModal(defaultTab) {
  const modal = document.getElementById('account-modal');
  modal.classList.remove('hidden');
  renderAccountFavorites();
  refreshAuthTabView(); // definida en auth-ui.js
  setAccountTab(defaultTab || (getFavorites().length > 0 ? 'fav' : 'fav'));
  if (window.lucide) lucide.createIcons();
}
function closeAccountModal() {
  document.getElementById('account-modal').classList.add('hidden');
}
document.getElementById('nav-account-btn')?.addEventListener('click', () => {
  const { user } = getCurrentUser();
  if (user) window.LB_DASHBOARD?.open();
  else openAccountModal('fav'); // sin sesión: favoritos + pestaña de login disponible
});
document.getElementById('account-close-btn')?.addEventListener('click', closeAccountModal);
document.getElementById('account-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'account-modal') closeAccountModal();
});
document.querySelectorAll('.account-tab[data-tab]').forEach(tab => {
  tab.addEventListener('click', () => setAccountTab(tab.dataset.tab));
});
// ============================================================
// RENDER ALL SECTIONS
// ============================================================
// ============================================================
// PAGINATION — Todos los dispositivos
// ============================================================
const pageState = { sedanes: 1, suvs: 1, pickups: 1 };
function getPageSize() {
  const w = window.innerWidth;
  if (w < 768) return 6;   // móvil: 2 col × 3 rows
  if (w < 1024) return 6;  // tablet: 2 col × 3 rows
  return 9;                 // PC: 3 col × 3 rows
}
function renderSections() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.style.display = 'none';
  hideCatalogEmptyState();
  ['sedanes','suvs','pickups'].forEach(cat => renderCategory(cat));
  // Los listeners de .ver-btn los pone renderCategory() sobre las tarjetas
  // que acaba de crear. Aquí había un segundo querySelectorAll('.ver-btn')
  // global que volvía a enlazar LAS MISMAS tarjetas: cada clic ejecutaba
  // openDetail() dos veces y registraba la vista por duplicado en el
  // historial del usuario (documentos repetidos en Firestore).
  renderBrandLogoFilter();
  if (window.lucide) lucide.createIcons();
}
function renderCategory(cat, page) {
  if (page !== undefined) pageState[cat] = page;
  const scroll = document.getElementById(cat + '-scroll');
  const paginationEl = document.getElementById(cat + '-pagination');
  scroll.innerHTML = '';
  if (paginationEl) paginationEl.innerHTML = '';
  const all = vehicles.filter(v => v.category === cat);
  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const p = Math.min(pageState[cat], totalPages);
  pageState[cat] = p;
  const toShow = all.slice((p - 1) * pageSize, p * pageSize);
  if (all.length === 0) {
    scroll.innerHTML = '<p class="text-slate-400 text-sm py-4">No hay vehículos en esta categoría.</p>';
  } else {
    toShow.forEach(v => scroll.appendChild(renderCard(v)));
  }
  scroll.querySelectorAll('.ver-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (isModifiedClick(e)) return; // Ctrl/Cmd/medio clic -> pestaña nueva
      e.preventDefault(); openDetail(btn.dataset.id);
    });
  });
  if (totalPages > 1 && paginationEl) {
    renderPagination(paginationEl, p, totalPages, (newPage) => {
      renderCategory(cat, newPage); scrollToSection(cat);
    });
  }
}
function renderPagination(container, currentPage, totalPages, onPageClick) {
  if (typeof container === 'string') container = document.getElementById(container);
  container.innerHTML = '';
  container.className = 'flex items-center justify-center gap-2 mt-5 mb-1 flex-wrap';
  container.setAttribute('role', 'navigation');
  container.setAttribute('aria-label', 'Paginación del catálogo');
  const sA = 'width:38px;height:38px;border-radius:50%;background:rgb(14,165,233);color:#fff;font-size:14px;font-weight:800;border:none;cursor:pointer;box-shadow:0 0 14px rgba(14,165,233,0.45);display:flex;align-items:center;justify-content:center;';
  const sI = 'width:38px;height:38px;border-radius:50%;background:rgb(22,32,50);color:rgb(148,163,184);font-size:14px;font-weight:700;border:1px solid rgba(255,255,255,0.09);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;';
  const sAr = 'width:38px;height:38px;border-radius:50%;background:rgb(22,32,50);color:#94a3b8;font-size:20px;font-weight:700;border:1px solid rgba(255,255,255,0.09);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;';
  const make = (label, page, style) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = String(label);
    btn.style.cssText = style;
    // Los botones no tenían nombre accesible: las flechas se anunciaban como
    // "botón" a secas y nada indicaba cuál es la página actual.
    if (label === '\u2039') btn.setAttribute('aria-label', 'Página anterior');
    else if (label === '\u203a') btn.setAttribute('aria-label', 'Página siguiente');
    else {
      btn.setAttribute('aria-label', `Ir a la página ${label}`);
      if (style === sA) btn.setAttribute('aria-current', 'page');
    }
    if (page !== null) {
      btn.addEventListener('click', () => onPageClick(page));
      if (style !== sA) {
        btn.addEventListener('mouseenter', () => { btn.style.background='rgba(14,165,233,0.18)'; btn.style.color='#38bdf8'; btn.style.borderColor='rgba(56,189,248,0.3)'; });
        btn.addEventListener('mouseleave', () => { btn.style.background='rgb(22,32,50)'; btn.style.color='#94a3b8'; btn.style.borderColor='rgba(255,255,255,0.09)'; });
      }
    }
    return btn;
  };
  if (currentPage > 1) container.appendChild(make('\u2039', currentPage - 1, sAr));
  let pages = [];
  if (totalPages <= 7) {
    pages = Array.from({length: totalPages}, (_, i) => i + 1);
  } else {
    pages = [1];
    if (currentPage > 3) pages.push('\u2026');
    for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('\u2026');
    pages.push(totalPages);
  }
  pages.forEach(pg => {
    if (pg === '\u2026') {
      const d = document.createElement('span');
      d.textContent = '\u2026';
      d.style.cssText = 'color:rgb(148,163,184);font-size:14px;padding:0 2px;line-height:38px;';
      container.appendChild(d);
    } else {
      container.appendChild(make(pg, pg, pg === currentPage ? sA : sI));
    }
  });
  if (currentPage < totalPages) container.appendChild(make('\u203a', currentPage + 1, sAr));
}
// ============================================================
// NAV CATEGORY LINKS (scroll to section)
// ============================================================
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').replace('#','');
    if (document.getElementById(id)) {
      e.preventDefault();
      scrollToSection(id);
    }
  });
});
// ============================================================
// BLOQUEO DE SCROLL DEL FONDO — helper único para TODOS los modales
// ------------------------------------------------------------
// Antes cada modal hacía `document.body.style.overflow = 'hidden'` por
// su cuenta y lo limpiaba al cerrar. Dos problemas reales:
//   1. En iOS Safari `overflow:hidden` sobre <body> NO detiene el
//      scroll del fondo: al arrastrar dentro del formulario de
//      publicación se movía el catálogo de detrás (scroll chaining) y
//      al cerrar el modal el administrador aparecía en otro punto de
//      la página. Se soluciona fijando el body y restaurando la
//      posición exacta al desbloquear.
//   2. Al cerrar un modal se desbloqueaba aunque siguiera abierto
//      otro. El contador evita ese caso.
// ============================================================
let scrollLockCount = 0;
let scrollLockY = 0;
function lockBodyScroll() {
  if (++scrollLockCount > 1) return;
  scrollLockY = window.scrollY || window.pageYOffset || 0;
  const b = document.body;
  b.style.position = 'fixed';
  b.style.top = `-${scrollLockY}px`;
  b.style.left = '0';
  b.style.right = '0';
  b.style.width = '100%';
  b.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  if (scrollLockCount === 0) return;
  if (--scrollLockCount > 0) return;
  const b = document.body;
  b.style.position = '';
  b.style.top = '';
  b.style.left = '';
  b.style.right = '';
  b.style.width = '';
  b.style.overflow = '';
  window.scrollTo(0, scrollLockY);
}
// calculadora.js vive en otro archivo y necesita el mismo contador.
window.LB_SCROLL_LOCK = { lock: lockBodyScroll, unlock: unlockBodyScroll };

function updateAdminUI() {
  const { profile } = getCurrentUser();
  const canManage = canManageVehicles();
  const badge = document.getElementById('admin-badge');
  const badgeLabel = document.getElementById('admin-badge-label');
  const btn = document.getElementById('nav-publish-btn');
  const detailCtrl = document.getElementById('detail-admin-controls');
  // El nav pasa de 1 a 3 controles a la derecha en modo administración.
  // `.nav--admin` habilita en CSS el ajuste responsive de esa barra
  // (ver styles.css). No cambia nada para el visitante normal.
  document.querySelector('#main-page nav')?.classList.toggle('nav--admin', canManage);

  if (canManage) {
    badge.classList.add('show');
    badgeLabel.textContent = profile.role === ROLES.ADMIN ? 'ADMIN' : 'EDITOR';
    btn.classList.remove('hidden');
    btn.classList.add('flex');
    detailCtrl.classList.remove('hidden');
  } else {
    badge.classList.remove('show');
    btn.classList.add('hidden');
    btn.classList.remove('flex');
    detailCtrl.classList.add('hidden');
  }
}
// ============================================================
// HERO SLIDESHOW — movido a hero-carousel.js
// ------------------------------------------------------------
// El carrusel dejó de vivir aquí: mezclaba responsabilidades con el
// catálogo y necesitaba lógica propia (swipe, control de pausa,
// diapositivas rotas, re-armado del temporizador en móvil). El <h1>/<p>
// del hero son suyos en exclusiva desde que las subpáginas de Empresa
// pasaron a ser documentos HTML independientes.
// ============================================================

// ============================================================
// YEAR OPTIONS (filter + publish form)
// ============================================================
function populateYears(selId, from=1970, to=2027) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = sel.id === 'pub-year' ? '<option value="">Selecciona</option>' : '<option value="">Todos</option>';
  for (let y = to; y >= from; y--) {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    sel.appendChild(o);
  }
  if (cur) sel.value = cur;
}
// ============================================================
// FILTERS — sistema viejo eliminado, ahora se usa renderBrandLogoFilter()
// (la función clearFilter() que vivía aquí nunca se llamaba desde
// ningún lado — su lógica ya estaba duplicada en el listener real
// de #brand-clear-btn, más abajo — se eliminó para no mantener dos
// copias de la misma lógica)
// ============================================================
// ============================================================
// DETAIL PAGE
// ============================================================
let currentVehicleId = null;
let galleryMedia = [], galleryIdx = 0;

// ============================================================
// FICHA — Especificaciones y características (ver ficha-vehiculo.css)
// ------------------------------------------------------------
// Antes ambas listas eran texto plano en una rejilla de Tailwind. Se
// reescribieron como componentes con icono para que la ficha se lea de
// un vistazo. Todo es data-driven: los vehículos que se publiquen a
// futuro heredan el diseño sin tocar HTML ni CSS.
// ============================================================

// Icono de cada especificación. Se usan nombres presentes en la versión
// de Lucide que carga el sitio (0.263.0) y, aun así, todo pasa por
// lucideIconName() para no dejar huecos si un día cambia la librería.
const SPEC_ICONS = {
  'Marca': 'car', 'Año': 'calendar', 'Estado': 'sparkles', 'Categoría': 'layers',
  'Millaje': 'gauge', 'Color': 'palette', 'Transmisión': 'cog',
};

// Reglas texto → icono para las características. Se evalúan en orden, así
// que las más específicas van primero. Ampliar esta tabla es la única
// edición necesaria para cubrir equipamiento nuevo.
const FEATURE_ICON_RULES = [
  [/c[áa]mara|retrovisor|360|reversa/i, 'camera'],
  [/carplay|android auto/i, 'smartphone'],
  [/pantalla|t[áa]ctil|touch|display|infotainment|multimedia/i, 'monitor'],
  [/bluetooth/i, 'bluetooth'],
  [/gps|navegaci[óo]n|waze/i, 'map-pin'],
  [/bocina|sonido|audio|bose|harman|jbl|parlante|sub/i, 'volume-2'],
  [/techo|sunroof|panor[áa]mic|quemacoco|corredizo/i, 'sun'],
  [/cuero|piel|asiento|tapicer[íi]a/i, 'armchair'],
  [/clima|aire|a\/c|calefacci[óo]n|calefactad|ventilad/i, 'wind'],
  [/sensor|parqueo|park|punto ciego|colisi[óo]n|frenado|asistencia/i, 'radar'],
  [/crucero|cruise|control de velocidad/i, 'gauge'],
  [/llave|keyless|arranque|push start|bot[óo]n/i, 'key-round'],
  [/rin|aro|llanta|neum[áa]tic/i, 'circle-dot'],
  [/4x4|awd|4wd|tracci[óo]n|off.?road/i, 'mountain'],
  [/turbo|caballo|\bhp\b|motor|cilindr|v6|v8/i, 'zap'],
  [/led|luz|luces|faro|x[ée]non|halogen/i, 'lightbulb'],
  [/airbag|abs|seguridad|alarma|blindaj|isofix/i, 'shield'],
  [/usb|carga|inal[áa]mbric|cargador|bater[íi]a/i, 'battery-charging'],
  [/autom[áa]tic|transmisi[óo]n|caja|manual|paddle/i, 'cog'],
  [/el[ée]ctric|h[íi]brid|gasolina|di[ée]sel|combustible|gas/i, 'fuel'],
  [/vidrio|ventana|cristal|polariza/i, 'square'],
  [/garant[íi]a|servicio|mantenimiento/i, 'badge-check'],
];
const FEATURE_ICON_FALLBACK = 'check-circle';

// kebab-case → PascalCase, que es como Lucide indexa sus iconos.
function toPascalIcon(name) {
  return name.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
// Devuelve `name` si Lucide lo conoce; si no, el icono de reserva. Evita
// el hueco silencioso que deja un data-lucide inexistente. Mientras la
// librería no haya cargado se confía en el nombre pedido (se resuelve al
// llamar a lucide.createIcons() al final del render).
function lucideIconName(name, fallback = FEATURE_ICON_FALLBACK) {
  const icons = window.lucide?.icons;
  if (!icons) return name;
  if (icons[toPascalIcon(name)] || icons[name]) return name;
  return fallback;
}

function featureIconFor(text) {
  const rule = FEATURE_ICON_RULES.find(([re]) => re.test(text));
  return lucideIconName(rule ? rule[1] : FEATURE_ICON_FALLBACK);
}

// Etiquetas legibles del campo `condition` — un único punto de verdad.
const CONDITION_LABELS = { nuevo: 'Nuevo', importado: 'Recién Importado', usado: 'Usado' };
// Claves reales del selector de publicación (#pub-category).
const CATEGORY_LABELS = { sedanes: 'Sedán', suvs: 'SUV', pickups: 'Camioneta' };

// Insignia de historial. El estado se comunica con una clase (no con
// estilos en línea), para que color, borde e icono cambien juntos y
// nunca queden en contradicción con el texto.
function renderVehicleCarfax(v) {
  const box = document.getElementById('detail-carfax-box');
  const value = document.getElementById('detail-carfax');
  if (!box || !value) return;
  const limpio = v.carfax === 'si';
  box.classList.toggle('vd-badge--ok', limpio);
  box.classList.toggle('vd-badge--none', !limpio);
  const icono = lucideIconName(limpio ? 'shield-check' : 'shield-alert', 'shield');
  value.innerHTML = `<i data-lucide="${escapeAttr(icono)}" aria-hidden="true"></i>` +
    (limpio ? 'Clean Carfax' : 'Sin reporte');
}

function renderVehicleSpecs(v) {
  const specs = document.getElementById('detail-specs');
  if (!specs) return;
  const categoria = v.category ? (CATEGORY_LABELS[String(v.category).toLowerCase()] || v.category) : '';
  const filas = [
    ['Marca', v.brand],
    ['Año', v.year],
    ['Estado', CONDITION_LABELS[v.condition] || CONDITION_LABELS.usado],
    ['Categoría', categoria],
    ['Millaje', v.mileage ? `${v.mileage} km` : ''],
    ['Color', v.color],
    ['Transmisión', v.transmission],
  ];
  specs.innerHTML = filas.map(([label, value]) => {
    const vacio = value === undefined || value === null || String(value).trim() === '';
    const icono = lucideIconName(SPEC_ICONS[label] || 'info', 'info');
    return `<div class="vd-spec">
      <dt><span class="vd-spec-icon"><i data-lucide="${escapeAttr(icono)}" aria-hidden="true"></i></span>${escapeHtml(label)}</dt>
      <dd class="vd-spec-value${vacio ? ' vd-spec-empty' : ''}">${vacio ? 'No especificado' : escapeHtml(String(value))}</dd>
    </div>`;
  }).join('');
}

function renderVehicleFeatures(v) {
  const list = document.getElementById('detail-features');
  if (!list) return;
  const feats = (Array.isArray(v.features) ? v.features : [])
    .map(f => String(f).trim()).filter(Boolean);
  if (feats.length === 0) {
    list.innerHTML = `<li class="vd-empty">
      <i data-lucide="info" aria-hidden="true"></i>
      Este vehículo aún no tiene características detalladas. Escríbenos y te contamos todo su equipamiento.
    </li>`;
    return;
  }
  list.innerHTML = feats.map(f => `<li class="vd-feature">
      <span class="vd-feature-icon"><i data-lucide="${escapeAttr(featureIconFor(f))}" aria-hidden="true"></i></span>
      <span class="vd-feature-text">${escapeHtml(f)}</span>
    </li>`).join('');
}

function openDetail(id) {
  const v = vehicles.find(x => x.id === id);
  if (!v) return;
  if (id !== currentVehicleId) { currentSaveToken++; currentDeleteToken++; }
  currentVehicleId = id;
  // B2 — se fija ANTES de construir galleryMedia/llamar a
  // renderGalleryMedia(), que es quien lee esta variable para el alt
  // dinámico de #detail-img. Antes se asignaba más abajo, después de
  // esa llamada, causando que el alt mostrara el vehículo anterior.
  currentDetailVehicle = v;
  window.LB_DASHBOARD?.trackView(id);
  // Build media list — extraer .src correctamente del objeto {type, src}
  galleryMedia = [];
  if (v.media && v.media.length > 0) {
    v.media.forEach(m => {
      if (typeof m === 'string') {
        galleryMedia.push({ type: 'image', src: m });
      } else if (m && m.src) {
        galleryMedia.push({ type: m.type || 'image', src: m.src });
      }
    });
  }
  if (galleryMedia.length === 0 && v.img) {
    galleryMedia.push({ type: 'image', src: v.img });
  }
  if (galleryMedia.length === 0) galleryMedia.push({ type:'image', src:'https://placehold.co/800x450/1e293b/38bdf8?text=Sin+Imagen' });
  galleryIdx = 0;
  renderGalleryMedia();
  // Dots
  const dots = document.getElementById('gallery-dots');
  dots.innerHTML = '';
  galleryMedia.forEach((_,i) => {
    const d = document.createElement('div');
    d.className = 'gallery-dot' + (i===0?' active':'');
    d.addEventListener('click', () => { galleryIdx=i; renderGalleryMedia(); });
    dots.appendChild(d);
  });
  // Prev/Next
  const prev = document.getElementById('gallery-prev');
  const next = document.getElementById('gallery-next');
  if (galleryMedia.length > 1) {
    prev.classList.remove('hidden'); next.classList.remove('hidden');
  } else {
    prev.classList.add('hidden'); next.classList.add('hidden');
  }
  // Info
  document.getElementById('detail-name').textContent = v.name;
  document.getElementById('detail-price').textContent = fmtPrice(v.price, v);
  renderVehicleCarfax(v);
  // WhatsApp link con URL real específica de esta publicación
  const vehicleUrl = getVehicleUrl(v);
  const waMsg = `Hola, estoy interesado en el *${v.name}* — ${fmtPrice(v.price, v)}\n\n🔗 Ver publicación: ${vehicleUrl}\n\n¿Está disponible?`;
  document.getElementById('detail-whatsapp-btn').href = `https://wa.me/18097759771?text=${encodeURIComponent(waMsg)}`;
  renderVehicleSpecs(v);
  renderVehicleFeatures(v);
  // Calculadora de financiamiento — el botón "Simular financiamiento"
  // abre el modal global precargado con este vehículo
  const openCalcBtn = document.getElementById('detail-open-calc-btn');
  if (openCalcBtn) openCalcBtn.onclick = () => openCalcModal(v);
  makeGalleryClickable();
  updateSeoForVehicle(v);
  // Vehículos similares
  renderSimilarVehicles(v);
  // Agregar al historial con URL REAL (/vehiculos/slug) — solo en
  // entornos que lo soporten (no iframes/srcdoc). Esto es lo que
  // permite que cada ficha tenga su propia URL indexable por Google,
  // en vez de depender de un hash (#auto-id) que Google ignora.
  try {
    if (window.self === window.top && window.location.pathname !== getVehiclePath(v)) {
      history.pushState({ vehicleId: id }, '', getVehiclePath(v));
      _detailOpenedFromSite = true; // hay una entrada nuestra a la que volver
    }
  } catch(e) { /* iframe o sandbox — ignorar */ }
  document.getElementById('main-page').classList.add('page-hidden');
  document.getElementById('detail-page').classList.remove('page-hidden');
  window.scrollTo(0,0);
  if (window.lucide) lucide.createIcons();
}
// Botón atrás/adelante del navegador → reconstruye el estado según la URL real.
// Antes solo revisaba si la ficha estaba abierta; ahora también soporta
// navegar directamente entre dos vehículos (/vehiculos/a -> /vehiculos/b)
// y volver a la home cuando la ruta es "/".
window.addEventListener('popstate', () => {
  routeFromLocation();
});
function routeFromLocation() {
  const path = window.location.pathname;
  const match = path.match(/^\/vehiculos\/([^\/]+)\/?$/);
  if (match) {
    const v = findVehicleBySlug(decodeURIComponent(match[1]));
    if (v) { openDetail(v.id); return; }
    // Solo si el inventario ya cargó (vehicles.length > 0) sabemos con
    // certeza que el slug no existe; si aún no ha cargado, dejamos que
    // checkPathVehicle() lo reintente en su propio ciclo al inicio.
    if (vehicles.length > 0) { showNotFound(); return; }
  }
  // Las subpáginas de Empresa (/empresa/*) ya no son vistas de la SPA:
  // son documentos HTML propios servidos por el hosting, así que aquí
  // no hay nada que enrutar para ellas.
  if (!document.getElementById('detail-page').classList.contains('page-hidden')) {
    goBackToMain();
  }
  // Volver a "/" con el botón atrás desde el Dashboard — faltaba este
  // caso (bug real encontrado en auditoría): a diferencia de detail-page,
  // nada comprobaba si dashboard-page seguía visible al navegar con
  // "atrás", dejándolo abierto con la URL ya en "/".
  if (path === '/' && !document.getElementById('dashboard-page').classList.contains('page-hidden')) {
    closeDashboardPage(false);
  }
}
function renderGalleryMedia() {
  const item = galleryMedia[galleryIdx];
  const img = document.getElementById('detail-img');
  const vid = document.getElementById('detail-video');
  if (item.type === 'video') {
    img.classList.add('hidden'); vid.classList.remove('hidden');
    vid.src = typeof item.src === 'string' ? item.src : '';
  } else {
    vid.classList.add('hidden'); img.classList.remove('hidden');
    // El ternario original comparaba y devolvía LO MISMO en ambas ramas
    // (`typeof item.src === 'string' ? item.src : item.src`), así que un
    // media mal formado llegaba tal cual al atributo y el navegador pedía
    // "[object Object]" (404 real). Ahora se descarta lo que no sea cadena.
    const rawSrc = typeof item.src === 'string' ? item.src : '';
    img.src = rawSrc ? cldOptimize(rawSrc, 1000) : 'https://placehold.co/800x600/1e293b/38bdf8?text=Sin+imagen';
    // Fallback si la imagen principal falla (Cloudinary/Pexels caído, URL
    // rota, etc.) — mismo patrón placehold.co usado en el resto del sitio
    // (tarjetas de catálogo, avatares, logos). Antes esta imagen, la más
    // grande y visible de la ficha, era la única sin fallback: mostraba el
    // ícono de imagen rota del navegador.
    img.onerror = () => { img.onerror = null; img.src = 'https://placehold.co/800x600/1e293b/38bdf8?text=Sin+imagen'; };
    // Alt descriptivo por vehículo + posición — WCAG 1.1.1
    const vName = (typeof currentDetailVehicle !== 'undefined' && currentDetailVehicle && currentDetailVehicle.name) ? currentDetailVehicle.name : 'Vehículo';
    img.alt = `${vName} — foto ${galleryIdx + 1} de ${galleryMedia.length}`;
  }
  // Update dots
  document.querySelectorAll('.gallery-dot').forEach((d,i) => {
    d.classList.toggle('active', i === galleryIdx);
  });
}
// ============================================================
// SIMILAR VEHICLES — con paginación
// ============================================================
let similarPage = 1;
let similarVehicles = [];
function renderSimilarVehicles(v) {
  similarPage = 1;
  const section = document.getElementById('similar-section');
  similarVehicles = vehicles
    .filter(x => x.id !== v.id)
    .map(x => {
      let score = 0;
      if (x.brand === v.brand) score += 3;
      if (x.category === v.category) score += 2;
      const priceDiff = Math.abs(x.price - v.price) / (v.price || 1);
      if (priceDiff <= 0.3) score += 1;
      return { ...x, _score: score };
    })
    .filter(x => x._score > 0)
    .sort((a, b) => b._score - a._score);
  if (similarVehicles.length === 0) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  renderSimilarPage(1);
}
function getSimilarPageSize() { return window.innerWidth < 768 ? 3 : 6; }
function renderSimilarPage(page) {
  similarPage = page;
  const grid = document.getElementById('similar-grid');
  const paginationEl = document.getElementById('similar-pagination');
  grid.innerHTML = '';
  if (paginationEl) paginationEl.innerHTML = '';
  const pageSize = getSimilarPageSize();
  const totalPages = Math.max(1, Math.ceil(similarVehicles.length / pageSize));
  const toShow = similarVehicles.slice((page-1)*pageSize, page*pageSize);
  toShow.forEach(sv => {
    const imgSrc = getVehicleCover(sv, 'https://placehold.co/300x176/1e293b/38bdf8?text=Auto');
    const svIsFav = isFavorite(sv.id);
    const card = document.createElement('a');
    card.href = getVehiclePath(sv);
    card.className = 'similar-card rounded-xl overflow-hidden cursor-pointer block';
    card.style.cssText = 'background:rgb(30,41,59);border:1px solid rgba(255,255,255,0.07);transition:transform 0.18s,box-shadow 0.18s;';
    card.innerHTML = `
      <div style="height:120px;overflow:hidden;position:relative;">
        <img src="${escapeAttr(cldOptimize(imgSrc, 400))}" alt="${escapeAttr(sv.name)}"
          style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s;"
          data-fallback="https://placehold.co/300x120/1e293b/38bdf8?text=Auto">
        <button type="button" class="fav-btn absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center transition" data-id="${escapeAttr(sv.id)}" aria-label="Agregar a favoritos" style="background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);">
          <i data-lucide="heart" class="fav-icon w-3.5 h-3.5 pointer-events-none" style="color:${svIsFav ? '#f87171' : '#fff'};fill:${svIsFav ? '#f87171' : 'none'};"></i>
        </button>
      </div>
      <div style="padding:10px 12px 12px;">
        <p style="color:#f1f5f9;font-weight:700;font-size:13px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(sv.name)}</p>
        <p style="color:#38bdf8;font-weight:800;font-size:13px;margin-bottom:6px;">${escapeHtml(fmtPrice(sv.price, sv))}</p>
        <span style="background:rgba(14,165,233,0.15);color:#38bdf8;font-size:10px;font-weight:600;padding:2px 8px;border-radius:20px;">
          ${sv.category === 'sedanes' ? 'Sedán' : sv.category === 'suvs' ? 'SUV' : 'Camioneta'}
        </span>
      </div>`;
    card.addEventListener('click', (e) => {
      if (isModifiedClick(e)) return;
      e.preventDefault(); openDetail(sv.id);
    });
    card.addEventListener('mouseenter', () => {
      card.style.transform = 'translateY(-3px)';
      card.style.boxShadow = '0 8px 24px rgba(56,189,248,0.13)';
      const img = card.querySelector('img');
      if (img) img.style.transform = 'scale(1.05)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      card.style.boxShadow = '';
      const img = card.querySelector('img');
      if (img) img.style.transform = '';
    });
    grid.appendChild(card);
  });
  if (totalPages > 1 && paginationEl) {
    renderPagination(paginationEl, page, totalPages, (newPage) => renderSimilarPage(newPage));
  }
  if (window.lucide) lucide.createIcons();
}
function goToGalleryMedia(step) {
  if (galleryMedia.length < 2) return;
  galleryIdx = (galleryIdx + step + galleryMedia.length) % galleryMedia.length;
  renderGalleryMedia();
}
document.getElementById('gallery-prev').addEventListener('click', () => goToGalleryMedia(-1));
document.getElementById('gallery-next').addEventListener('click', () => goToGalleryMedia(1));

// ============================================================
// GESTO TÁCTIL — deslizar entre fotos
// ------------------------------------------------------------
// En un teléfono, cambiar de foto pulsando una flecha de 32 px es un
// objetivo táctil pequeño y poco natural: la expectativa universal en
// una galería es deslizar. Se implementa una sola vez y se reutiliza en
// la ficha y en el lightbox.
//
// No se llama a preventDefault(): el scroll vertical de la página debe
// seguir funcionando. Es `touch-action: pan-y` (styles.css) lo que le
// cede el eje horizontal al gesto sin robarle el vertical al navegador.
// ============================================================
const SWIPE_MIN_PX = 40;
const SWIPE_MAX_MS = 800;
// Marca de tiempo del último deslizamiento reconocido. El navegador
// dispara `click` después de `pointerup`, así que sin esto un swipe sobre
// el fondo del lightbox lo cerraba en vez de pasar a la foto siguiente.
let lastSwipeAt = 0;
function attachSwipe(el, onSwipe) {
  if (!el) return;
  let start = null;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return; // con ratón están las flechas
    if (e.target.closest('button, video')) return; // controles nativos primero
    start = { x: e.clientX, y: e.clientY, t: Date.now() };
  }, { passive: true });
  // `pointerup` en window: si el dedo se levanta fuera del elemento, el
  // listener local nunca se dispararía y el gesto se perdería.
  window.addEventListener('pointerup', e => {
    if (!start) return;
    const { x, y, t } = start;
    start = null;
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    if (Date.now() - t > SWIPE_MAX_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
    lastSwipeAt = Date.now();
    onSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
  window.addEventListener('pointercancel', () => { start = null; }, { passive: true });
}
attachSwipe(document.getElementById('detail-media-container'), step => goToGalleryMedia(step));
// ============================================================
// LIGHTBOX — click foto para ampliar
// ============================================================
function openLightbox(idx) {
  const lb = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  const lbVid = document.getElementById('lightbox-video');
  if (!lb || galleryMedia.length === 0) return;
  galleryIdx = idx;
  const item = galleryMedia[galleryIdx];
  const lbSrc = typeof item.src === 'string' ? item.src : '';
  if (item.type === 'video') {
    lbImg.classList.add('hidden'); lbVid.classList.remove('hidden'); lbVid.src = lbSrc;
  } else {
    lbVid.classList.add('hidden'); lbImg.classList.remove('hidden');
    // Misma optimización (f_auto/q_auto) y mismo respaldo ante error que la
    // imagen de la ficha. Antes la vista ampliada era la ÚNICA sin ninguna de
    // las dos: cargaba el original sin transformar y, si fallaba, mostraba el
    // icono de imagen rota del navegador. El alt tampoco decía qué foto era.
    lbImg.onerror = () => { lbImg.onerror = null; lbImg.src = 'https://placehold.co/1200x900/1e293b/38bdf8?text=Sin+imagen'; };
    lbImg.src = lbSrc ? cldOptimize(lbSrc, 1600) : 'https://placehold.co/1200x900/1e293b/38bdf8?text=Sin+imagen';
    const lbName = (currentDetailVehicle && currentDetailVehicle.name) ? currentDetailVehicle.name : 'Vehículo';
    lbImg.alt = `${lbName} — foto ${galleryIdx + 1} de ${galleryMedia.length} (ampliada)`;
  }
  lb.classList.add('open');
  lockBodyScroll();
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  const lbVid = document.getElementById('lightbox-video');
  if (lb) lb.classList.remove('open');
  // `src = ''` NO libera el vídeo: la cadena vacía se resuelve contra la
  // URL del documento, así que el navegador se descarga el HTML entero
  // como si fuera el medio. removeAttribute + load() es lo que corta de
  // verdad la descarga en curso.
  if (lbVid) { try { lbVid.pause(); lbVid.removeAttribute('src'); lbVid.load(); } catch(e){} }
  unlockBodyScroll();
}
document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
document.getElementById('lightbox')?.addEventListener('click', e => {
  // Un deslizamiento sobre el fondo termina en `click`: sin esta guarda,
  // pasar a la foto siguiente con el dedo cerraba la vista ampliada.
  if (Date.now() - lastSwipeAt < 400) return;
  if (e.target === document.getElementById('lightbox')) closeLightbox();
});
document.getElementById('lightbox-prev')?.addEventListener('click', e => { e.stopPropagation(); openLightbox((galleryIdx - 1 + galleryMedia.length) % galleryMedia.length); });
document.getElementById('lightbox-next')?.addEventListener('click', e => { e.stopPropagation(); openLightbox((galleryIdx + 1) % galleryMedia.length); });
// Mismo gesto dentro de la vista ampliada, donde la flecha queda aún más
// lejos del pulgar que en la ficha.
attachSwipe(document.getElementById('lightbox'), step => {
  if (galleryMedia.length < 2) return;
  openLightbox((galleryIdx + step + galleryMedia.length) % galleryMedia.length);
});
document.addEventListener('keydown', e => {
  if (!document.getElementById('lightbox')?.classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') openLightbox((galleryIdx-1+galleryMedia.length)%galleryMedia.length);
  if (e.key === 'ArrowRight') openLightbox((galleryIdx+1)%galleryMedia.length);
});
// Make gallery clickable to open lightbox
function makeGalleryClickable() {
  const img = document.getElementById('detail-img');
  const vid = document.getElementById('detail-video');
  if (img) { img.style.cursor = 'zoom-in'; img.onclick = () => openLightbox(galleryIdx); }
  if (vid) { vid.style.cursor = 'zoom-in'; }
}
// Re-render on resize/orientation change
let resizeTimer;
let lastPageSize = getPageSize();
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // Solo re-renderizamos si cambió de verdad cuántas tarjetas caben por
    // página. Antes bastaba CUALQUIER resize: al desplazarse en móvil, la
    // barra de URL se oculta, eso dispara `resize` por el cambio de ALTO y
    // el catálogo saltaba de la página 3 a la 1 mientras el usuario leía.
    const size = getPageSize();
    if (size === lastPageSize) return;
    lastPageSize = size;
    Object.keys(pageState).forEach(cat => { pageState[cat] = 1; });
    renderSections();
    if (window.lucide) lucide.createIcons();
  }, 300);
});
function goBackToMain() {
  currentSaveToken++;
  currentDeleteToken++;
  document.getElementById('detail-page').classList.add('page-hidden');
  document.getElementById('main-page').classList.remove('page-hidden');
  document.getElementById('not-found-page')?.classList.add('page-hidden');
  currentVehicleId = null;
  currentDetailVehicle = null;
  resetSeoToDefault();
  try { if (window.self === window.top && /^\/vehiculos\//.test(window.location.pathname)) history.replaceState(null, '', '/'); } catch(e) {}
}
// ============================================================
// PÁGINA 404 — vehículo eliminado, slug viejo o link roto.
// Antes esto se quedaba esperando en silencio y volvía a la home
// sin avisar nada al usuario; ahora se muestra un estado explícito
// con un botón para volver al catálogo.
// ============================================================
function showNotFound() {
  document.getElementById('main-page').classList.add('page-hidden');
  document.getElementById('detail-page').classList.add('page-hidden');
  document.getElementById('not-found-page')?.classList.remove('page-hidden');
  document.title = 'Vehículo no encontrado | La Batalla Auto Import';
  window.scrollTo(0, 0);
  if (window.lucide) lucide.createIcons();
}
document.getElementById('not-found-back-btn')?.addEventListener('click', () => {
  // replaceState, no pushState: con pushState el 404 quedaba en el historial
  // y el botón Atrás del navegador devolvía al "Vehículo no encontrado" —
  // un callejón sin salida del que solo se salía pulsando Atrás dos veces.
  try { if (window.self === window.top) history.replaceState(null, '', '/'); } catch(e) {}
  document.getElementById('not-found-page')?.classList.add('page-hidden');
  document.getElementById('main-page').classList.remove('page-hidden');
  resetSeoToDefault();
});
// Marca si la ficha se abrió navegando DENTRO del sitio. Es el caso normal
// (catálogo -> ficha) y ahí `history.back()` es lo correcto. Pero la vía de
// entrada más frecuente de este negocio es un enlace /vehiculos/slug
// compartido por WhatsApp: entonces no hay ninguna entrada previa nuestra en
// el historial y `history.back()` sacaba al visitante del sitio — desde el
// botón "Volver" del propio sitio. Ahora, en ese caso, vamos al catálogo.
let _detailOpenedFromSite = false;
document.getElementById('back-btn').addEventListener('click', () => {
  try {
    if (window.self === window.top && _detailOpenedFromSite) history.back();
    else goBackToMain();
  } catch(e) { goBackToMain(); }
});
// ============================================================
// ADMIN DETAIL ACTIONS
// ============================================================
document.getElementById('detail-edit-btn').addEventListener('click', () => {
  if (!currentVehicleId) return;
  const v = vehicles.find(x => x.id === currentVehicleId);
  if (!v) return;
  openPublishModal(v);
});
let pendingDeleteId = null;
// 'detail' | 'dashboard' — de dónde vino el clic en Eliminar. Decide
// SOLO a dónde navegamos después de un borrado exitoso, nunca la
// autorización (esa siempre depende de firestore.rules).
let deleteOrigin = 'detail';
function requestVehicleDelete(id, origin = 'dashboard') {
  pendingDeleteId = id;
  deleteOrigin = origin;
  const modal = document.getElementById('delete-modal');
  if (modal.classList.contains('hidden')) lockBodyScroll();
  modal.classList.remove('hidden');
}
// Cierra #delete-modal liberando el bloqueo de scroll una sola vez,
// se llame desde donde se llame (Cancelar, Escape o borrado correcto).
function closeDeleteModal() {
  const modal = document.getElementById('delete-modal');
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  unlockBodyScroll();
}
document.getElementById('detail-delete-btn').addEventListener('click', () => {
  if (!currentVehicleId) return;
  requestVehicleDelete(currentVehicleId, 'detail');
});
document.getElementById('delete-cancel-btn').addEventListener('click', () => {
  closeDeleteModal();
  pendingDeleteId = null;
});
document.getElementById('delete-confirm-btn').addEventListener('click', async () => {
  if (operations.vehicle.delete || !pendingDeleteId) return;
  operations.vehicle.delete = true;
  const token = ++currentDeleteToken;
  const idToDelete = pendingDeleteId;
  const origin = deleteOrigin; // capturado ya — inmune a que algo lo cambie durante el await
  const btn = document.getElementById('delete-confirm-btn');
  setBtnBusy(btn, true, '⏳ Eliminando...', 'Eliminar');

  try {
    showToast('🗑️ Eliminando...');
    const result = await removeVehicle(idToDelete, token);
    if (result.stale) return;

    closeDeleteModal();
    pendingDeleteId = null;

    if (!result.success) {
      console.error('No se pudo eliminar el vehículo:', result.error);
      showToast('❌ Error al eliminar en Firebase — el vehículo NO se eliminó');
      return; // seguimos donde estábamos — el vehículo sigue existiendo de verdad
    }
    if (!fbReady) renderSections();
    if (origin === 'dashboard') {
      // Viene de "Mis Publicaciones": nos quedamos en el Dashboard,
      // solo se refresca esa lista — comportamiento nuevo, aislado.
      dbRenderPublicaciones?.();
    } else {
      // Comportamiento ORIGINAL sin cambios: viene de la ficha de detalle.
      document.getElementById('detail-page').classList.add('page-hidden');
      document.getElementById('main-page').classList.remove('page-hidden');
    }
    showToast('✅ Vehículo eliminado');
  } finally {
    operations.vehicle.delete = false;
    setBtnBusy(btn, false, '', 'Eliminar');
  }
});
// ============================================================
// PUBLISH MODAL
// ============================================================
document.getElementById('nav-publish-btn').addEventListener('click', () => openPublishModal(null));
document.getElementById('publish-close-btn').addEventListener('click', closePublishModal);
document.getElementById('publish-cancel-btn').addEventListener('click', closePublishModal);
function openPublishModal(vehicle) {
  const modal = document.getElementById('publish-modal');
  const title = document.getElementById('modal-title');
  // Idempotente: se ignora si ya está enganchado en este input.
  attachAmountFormatter(document.getElementById('pub-price'));
  // Libera los object URLs del formulario anterior. Sin esto, abrir el modal,
  // elegir fotos y volver a abrirlo (sin pasar por closePublishModal) dejaba
  // los blobs retenidos en memoria durante toda la sesión.
  revokePendingObjectUrls();
  pendingFiles = [];
  mediaClearedByUser = false;
  document.getElementById('img-preview').innerHTML = '';
  if (vehicle) {
    title.textContent = 'Editar Vehículo';
    document.getElementById('pub-edit-id').value = vehicle.id;
    document.getElementById('pub-name').value = vehicle.name || '';
    document.getElementById('pub-price').value = formatAmount(
      (vehicle.currency === 'USD' && vehicle.priceUSD) ? vehicle.priceUSD : vehicle.price
    );
    document.getElementById('pub-category').value = vehicle.category || '';
    document.getElementById('pub-condition').value = vehicle.condition || '';
    document.getElementById('pub-brand').value = vehicle.brand || '';
    document.getElementById('pub-year').value = vehicle.year || '';
    document.getElementById('pub-carfax').value = vehicle.carfax || 'si';
    document.getElementById('pub-mileage').value = vehicle.mileage || '';
    document.getElementById('pub-color').value = vehicle.color || '';
    document.getElementById('pub-transmission').value = vehicle.transmission || '';
    document.getElementById('pub-features').value = Array.isArray(vehicle.features) ? vehicle.features.join('\n') : '';
    document.getElementById('pub-seo-tags').value = Array.isArray(vehicle.seoTags) ? vehicle.seoTags.join(', ') : '';
    // Restore currency
    const currSel = document.getElementById('pub-currency');
    if (currSel) currSel.value = vehicle.currency || 'RD';
    document.getElementById('publish-submit-btn').textContent = 'Guardar Cambios';
    resetBrandSearch(vehicle.brand || '');
    resetColorSearch(vehicle.color || '');
    // Restaurar etiquetas destacadas (checkboxes) al editar
    document.getElementById('pub-tag-financiamiento').checked = !!vehicle.tags?.financiamiento;
    document.getElementById('pub-tag-negociable').checked = !!vehicle.tags?.negociable;
    document.getElementById('pub-tag-unicodueno').checked = !!vehicle.tags?.unicodueno;
    document.getElementById('pub-tag-importado').checked = !!vehicle.tags?.importado;
    // Cargar fotos existentes en pendingFiles como URLs ya subidas
    const existingMedia = vehicle.media && vehicle.media.length > 0
      ? vehicle.media
      : (vehicle.img ? [{ type: 'image', src: vehicle.img }] : []);
    existingMedia.forEach(m => {
      const src = typeof m === 'string' ? m : (m.src || '');
      const type = typeof m === 'string' ? 'image' : (m.type || 'image');
      if (src) pendingFiles.push({ file: null, localUrl: src, type, cloudUrl: src });
    });
    renderImgPreview();
    updateImgLabel();
  } else {
    title.textContent = 'Publicar Vehículo';
    document.getElementById('pub-edit-id').value = '';
    ['pub-name','pub-price','pub-mileage','pub-color','pub-features','pub-seo-tags'].forEach(id => {
      document.getElementById(id).value = '';
    });
    ['pub-category','pub-condition','pub-brand','pub-year','pub-transmission'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('pub-carfax').value = 'si';
    const currSel = document.getElementById('pub-currency');
    if (currSel) currSel.value = 'RD';
    document.getElementById('publish-submit-btn').textContent = 'Publicar Vehículo';
    resetBrandSearch('');
    resetColorSearch('');
    document.getElementById('pub-tag-financiamiento').checked = false;
    document.getElementById('pub-tag-negociable').checked = false;
    document.getElementById('pub-tag-unicodueno').checked = false;
    document.getElementById('pub-tag-importado').checked = false;
  }
  // Solo bloquea si venía cerrado: openPublishModal() puede llamarse
  // sobre un modal ya abierto (editar otro vehículo) y el contador no
  // debe descuadrarse.
  if (modal.classList.contains('hidden')) lockBodyScroll();
  modal.classList.remove('hidden');
  populateYears('pub-year');
  if (vehicle) document.getElementById('pub-year').value = vehicle.year || '';
}
// ============================================================
// CLOUDINARY — subida firmada vía Cloudflare Worker
// ------------------------------------------------------------
// El API Secret de Cloudinary NO vive aquí. Un Worker de Cloudflare
// calcula la firma en su propio servidor (donde guarda el secreto como
// variable de entorno) y solo devuelve la firma ya calculada — así nadie
// puede subir archivos a nuestra cuenta sin pasar antes por nuestra
// lógica de negocio.
//
// La mecánica de red (compresión previa, reintentos, temporizador de
// inactividad, caché de firma, Wake Lock) vive en media-upload.js. Aquí
// solo queda la AUTORIZACIÓN de nuestro dominio: quién puede subir qué.
// ============================================================

// Sube una foto/vídeo de vehículo. Solo staff con sesión activa.
async function uploadToCloudinary(file, onProgress) {
  const { user } = getCurrentUser();
  if (!canManageVehicles() || !user) {
    throw new Error('Debes iniciar sesión con un rol autorizado para subir archivos.');
  }
  return LBMedia.uploadFile(file, {
    purpose: 'vehicle',
    uid: user.uid,
    // El token se pide en cada intento, no una sola vez: si una tanda de
    // diez fotos tarda más que la vigencia del token, Firebase lo renueva
    // aquí de forma transparente en lugar de fallar a mitad.
    getIdToken: () => user.getIdToken(),
    onProgress,
  });
}

// Foto de perfil: mismo flujo firmado, con purpose:'profile'. El Worker
// exige solo status:active (no rol admin/editor) y fuerza folder y
// public_id derivados del uid verificado — un usuario nunca puede
// escribir en la carpeta de vehículos ni sobre la foto de otro.
async function uploadProfilePhoto(file) {
  const { user } = getCurrentUser();
  if (!user) throw new Error('Debes iniciar sesión para subir una foto.');
  if (!file.type.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');
  if (file.size > PROFILE_PHOTO_MAX_MB * 1024 * 1024) {
    throw new Error(`La imagen no puede superar ${PROFILE_PHOTO_MAX_MB} MB.`);
  }
  const { url } = await LBMedia.uploadFile(file, {
    purpose: 'profile',
    uid: user.uid,
    getIdToken: () => user.getIdToken(),
  });
  return url;
}

// ————— Preview local mientras suben —————
let pendingFiles = []; // archivos originales para subir a Cloudinary
// true cuando el admin dejó la lista de fotos vacía QUITÁNDOLAS él mismo
// (distinto de "abrió el formulario y no tocó las fotos").
let mediaClearedByUser = false;
// Solo revoca los blobs creados por nosotros: al editar, `localUrl` es una
// URL https de Cloudinary y revocarla no tendría sentido.
function revokePendingObjectUrls() {
  pendingFiles.forEach(f => {
    if (f && f.file && typeof f.localUrl === 'string' && f.localUrl.startsWith('blob:')) {
      URL.revokeObjectURL(f.localUrl);
    }
  });
}
const MAX_IMAGES = 10;
function updateImgLabel() {
  const labelText = document.getElementById('pub-images-label-text');
  const input = document.getElementById('pub-images');
  const labelEl = document.getElementById('pub-images-label');
  if (!labelText) return;
  const remaining = MAX_IMAGES - pendingFiles.length;
  if (remaining <= 0) {
    labelText.textContent = `✅ Has alcanzado el máximo de ${MAX_IMAGES} fotos/videos`;
    if (input) input.disabled = true;
    if (labelEl) { labelEl.style.opacity = '0.5'; labelEl.style.pointerEvents = 'none'; }
  } else {
    // El texto anterior era "(3/10 — quedan 7)". Esa fracción se lee como
    // un objetivo que hay que completar, y más de una vez se entendió que
    // hacían falta 10 fotos para poder publicar. Las fotos son OPCIONALES
    // y 10 es solo el techo (el mismo que impone firestore.rules), así
    // que el texto lo dice con esas palabras.
    labelText.textContent = pendingFiles.length === 0
      ? `Seleccionar fotos o videos (opcional — hasta ${MAX_IMAGES})`
      : `Seleccionar fotos o videos (${pendingFiles.length} de ${MAX_IMAGES} — puedes añadir ${remaining} más)`;
    if (input) input.disabled = false;
    if (labelEl) { labelEl.style.opacity = '1'; labelEl.style.pointerEvents = 'auto'; }
  }
}
// ============================================================
// LÍMITES DE TAMAÑO
// ------------------------------------------------------------
// El tope de las FOTOS subió de 10 MB a 25 MB porque ya no se sube el
// archivo original: media-upload.js lo redimensiona a 1920 px y lo
// recomprime en el navegador antes de salir (una foto de 12 MB acaba en
// ~250 KB). El límite de 10 MB rechazaba fotos perfectamente válidas de
// móviles actuales y era, en la práctica, un obstáculo para publicar.
// Los VÍDEOS siguen en 50 MB: no se pueden recomprimir en el navegador
// de forma razonable, así que el archivo viaja tal cual.
const MAX_IMAGE_MB = 25;
const MAX_VIDEO_MB = 50;
// Foto de perfil — también se comprime antes de subir, así que el tope
// es el del archivo de origen, no el del que llega a Cloudinary.
const PROFILE_PHOTO_MAX_MB = 15;
// Image upload handler — preview inmediato, sube a Cloudinary al publicar
document.getElementById('pub-images').addEventListener('change', function() {
  let files = Array.from(this.files);
  const remaining = MAX_IMAGES - pendingFiles.length;
  if (remaining <= 0) {
    showToast(`⚠️ Límite de ${MAX_IMAGES} fotos alcanzado`);
    this.value = '';
    return;
  }
  // Filtrar archivos que excedan el tamaño permitido
  const rejected = [];
  const wrongType = [];
  files = files.filter(file => {
    // Solo se comprobaba el TAMAÑO. Un PDF o un .zip elegido por error se
    // subía a Cloudinary y se guardaba como {type:'image'}: la ficha
    // terminaba con una <img> que nunca podía renderizar. El atributo
    // `accept` del input no basta — el usuario puede saltárselo eligiendo
    // "todos los archivos" en el diálogo del sistema.
    const isVideo = LBMedia.isVideoFile(file);
    const isImage = LBMedia.isImageFile(file);
    if (!isVideo && !isImage) { wrongType.push(file.name); return false; }
    const limitMB = isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB;
    const okSize = file.size <= limitMB * 1024 * 1024;
    if (!okSize) rejected.push(file.name);
    return okSize;
  });
  if (wrongType.length > 0) {
    showToast(`⚠️ ${wrongType.length} archivo(s) descartado(s): solo se admiten fotos o videos`, 3500);
  }
  if (rejected.length > 0) {
    showToast(`⚠️ ${rejected.length} archivo(s) superan el límite (${MAX_IMAGE_MB}MB fotos / ${MAX_VIDEO_MB}MB video)`, 3500);
  }
  const toAdd = files.slice(0, remaining);
  if (files.length > remaining) showToast(`⚠️ Solo se agregaron ${remaining} foto(s) — límite de ${MAX_IMAGES}`);
  toAdd.forEach(file => {
    const localUrl = URL.createObjectURL(file);
    const type = file.type.startsWith('video') ? 'video' : 'image';
    pendingFiles.push({ file, localUrl, type, cloudUrl: null });
  });
  renderImgPreview();
  this.value = '';
});
// Detecta formatos que Chromium/Firefox NO pueden decodificar en un
// <img> (confirmado con prueba real: naturalWidth=0, dispara onerror).
// HEIC/HEIF es el caso real y frecuente: es el formato por defecto de
// la cámara del iPhone desde iOS 11 ("Alta Eficiencia"). Esto NO
// significa que la foto esté dañada ni que la subida vaya a fallar —
// Cloudinary sí decodifica y convierte HEIC correctamente en el
// servidor. El problema era puramente de la vista previa local, que
// mostraba un "?" con pinta de error real.
// La detección vive en media-upload.js (allí decide además si la imagen
// se puede comprimir en el navegador); aquí solo se reexporta con el
// nombre que usa la vista previa.
const isPreviewUnrenderable = file => LBMedia.isHeic(file);

function renderImgPreview() {
  const container = document.getElementById('img-preview');
  container.innerHTML = '';
  pendingFiles.forEach((item, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'preview-item relative';
    const portadaBadge = i === 0
      ? `<span style="position:absolute;bottom:2px;left:2px;background:rgba(14,165,233,0.9);color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:4px;letter-spacing:.5px;">PORTADA</span>`
      : '';
    const src = item.cloudUrl || item.localUrl;
    const border = i === 0 ? 'border-sky-400' : 'border-slate-600';
    if (item.type === 'video') {
      wrap.innerHTML = `<video src="${escapeAttr(src)}" class="w-full h-20 object-cover rounded-lg border-2 ${border}" muted></video>
        ${portadaBadge}
        <button class="remove-img" data-idx="${i}">✕</button>`;
    } else if (!item.cloudUrl && isPreviewUnrenderable(item.file)) {
      // HEIC/HEIF sin subir todavía: no intentar <img>, mostrar estado
      // neutral en vez del placeholder de error "?".
      wrap.innerHTML = `<div class="w-full h-20 rounded-lg border-2 ${border} bg-slate-800 flex flex-col items-center justify-center gap-0.5 px-1 text-center">
          <i data-lucide="image" class="w-4 h-4 text-sky-400"></i>
          <span class="text-[9px] text-slate-400 leading-tight">Se convertirá al subir</span>
        </div>
        ${portadaBadge}
        <button class="remove-img" data-idx="${i}">✕</button>`;
    } else {
      // Si la miniatura no se puede renderizar (archivo corrupto, objectURL
      // revocado, URL de Cloudinary caída al editar), se muestra el MISMO
      // estado neutro que la rama HEIC de arriba — nunca el placeholder de
      // error "?", que se leía como imagen rota sobre el badge PORTADA.
      wrap.innerHTML = `<img src="${escapeAttr(src)}" class="w-full h-20 object-cover rounded-lg border-2 ${border}" alt="preview"
        data-preview-border="${border}">
        ${portadaBadge}
        <button class="remove-img" data-idx="${i}">✕</button>`;
    }
    container.appendChild(wrap);
  });
  // Fallback sin handler inline (el CSP ya carga con 'unsafe-inline' por
  // deuda conocida; no se le suma uno nuevo): si la miniatura falla, se
  // sustituye por el mismo bloque neutro de la rama HEIC.
  container.querySelectorAll('img[data-preview-border]').forEach(im => {
    im.addEventListener('error', () => {
      const br = im.dataset.previewBorder || 'border-slate-600';
      const ph = document.createElement('div');
      ph.className = `w-full h-20 rounded-lg border-2 ${br} bg-slate-800 flex flex-col items-center justify-center gap-0.5 px-1 text-center`;
      ph.innerHTML = `<i data-lucide="image-off" class="w-4 h-4 text-slate-400"></i>
          <span class="text-[9px] text-slate-400 leading-tight">Vista previa no disponible</span>`;
      im.replaceWith(ph);
      if (window.lucide) window.lucide.createIcons();
    }, { once: true });
  });
  if (typeof lucide !== 'undefined' && window.lucide) window.lucide.createIcons();
  container.querySelectorAll('.remove-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (pendingFiles[idx].localUrl && !pendingFiles[idx].cloudUrl) {
        URL.revokeObjectURL(pendingFiles[idx].localUrl);
      }
      pendingFiles.splice(idx, 1);
      if (pendingFiles.length === 0) mediaClearedByUser = true;
      renderImgPreview();
      updateImgLabel();
    });
  });
  updateImgLabel();
}
// Submit
// ============================================================
// FORMULARIO — lectura y validación, sin efectos secundarios
// ============================================================
function readPublishForm() {
  const priceRaw = parseAmount(document.getElementById('pub-price').value);
  const currency = document.getElementById('pub-currency').value; // 'RD' o 'USD'
  const price = currency === 'USD' ? Math.round(priceRaw * USD_TO_RD_RATE) : Math.round(priceRaw);
  const priceUSD = currency === 'USD' ? priceRaw : null;
  const priceDisplay = currency === 'USD'
    ? `USD$ ${priceRaw.toLocaleString('en-US')} (RD$ ${price.toLocaleString('es-DO')})`
    : null;
  const featuresRaw = document.getElementById('pub-features').value.trim();
  const seoTagsRaw = document.getElementById('pub-seo-tags').value.trim();
  return {
    editId: document.getElementById('pub-edit-id').value,
    priceRaw, // solo para validar — no se persiste
    data: {
      name: document.getElementById('pub-name').value.trim(),
      price, priceUSD, currency, priceDisplay,
      category: document.getElementById('pub-category').value,
      condition: document.getElementById('pub-condition').value,
      brand: document.getElementById('pub-brand').value,
      year: document.getElementById('pub-year').value,
      carfax: document.getElementById('pub-carfax').value,
      mileage: document.getElementById('pub-mileage').value.trim(),
      color: document.getElementById('pub-color').value.trim(),
      transmission: document.getElementById('pub-transmission').value,
      features: featuresRaw ? featuresRaw.split('\n').map(f=>f.trim()).filter(Boolean) : [],
      seoTags: seoTagsRaw ? seoTagsRaw.split(',').map(t=>t.trim().toLowerCase()).filter(Boolean) : [],
      tags: {
        financiamiento: document.getElementById('pub-tag-financiamiento').checked,
        negociable: document.getElementById('pub-tag-negociable').checked,
        unicodueno: document.getElementById('pub-tag-unicodueno').checked,
        importado: document.getElementById('pub-tag-importado').checked,
      }
    }
  };
}
function validatePublishForm(form) {
  const d = form.data;
  if (!d.name || !(form.priceRaw > 0) || !d.category || !d.condition || !d.brand || !d.year) {
    return { valid: false, message: '⚠️ Completa todos los campos obligatorios (el precio debe ser mayor que cero)' };
  }
  // Los topes son los de firestore.rules. Comprobarlos aquí evita el caso
  // peor: el vehículo se sube a Cloudinary, Firestore rechaza el
  // documento y el usuario solo ve "Error al guardar" sin saber por qué.
  if (!(d.price < MAX_PRICE_RD)) {
    return { valid: false, message: `⚠️ El precio máximo es RD$ ${formatAmount(MAX_PRICE_RD - 1)}` };
  }
  if (d.priceUSD != null && !(d.priceUSD < MAX_PRICE_USD)) {
    return { valid: false, message: `⚠️ El precio máximo en USD es $${formatAmount(MAX_PRICE_USD - 1)}` };
  }
  return { valid: true };
}

// Sube las fotos pendientes o reutiliza las existentes al editar sin
// fotos nuevas. Lanza si alguna subida falla — el llamador decide qué hacer.
//
// Cada archivo ya subido guarda su `cloudUrl` en `pendingFiles`, así que
// un segundo intento tras un corte NO vuelve a subir lo que ya está en
// Cloudinary: continúa donde se quedó. Es la diferencia entre "se cayó la
// conexión en la foto 8, vuelve a empezar desde la 1" y "pulsa Publicar
// otra vez y termina en segundos".
// Devuelve SIEMPRE { media, fallidos, total }.
//
// Antes lanzaba en cuanto una subida fallaba, y con ella se perdía la
// publicación entera: con siete fotos y una conexión mala, que fallara la
// primera bastaba para que no se pudiera publicar el vehículo de ninguna
// manera. Las fotos son opcionales, así que un archivo que no sube no
// puede ser un bloqueo — se anota, se sigue con el resto y quien publica
// decide si continuar con las que sí subieron o volver al formulario.
async function resolvePublishMedia(editId, onProgress, userClearedAll) {
  // Si el admin quitó a propósito todas las fotos al editar, debe quedarse
  // sin fotos. Antes, `pendingFiles.length === 0` se interpretaba siempre
  // como "no tocó las fotos" y se devolvía el media anterior: las imágenes
  // eliminadas reaparecían al guardar y era imposible dejar un vehículo sin
  // portada.
  if (pendingFiles.length === 0 && userClearedAll) return { media: [], fallidos: [], total: 0 };
  if (pendingFiles.length > 0) {
    const media = [];
    const fallidos = [];
    const total = pendingFiles.length;
    // Mantiene la pantalla encendida mientras dura la tanda: en Android,
    // bloquear el teléfono a mitad de la subida la congelaba y la
    // publicación se quedaba a medias.
    await LBMedia.acquireWakeLock();
    try {
      for (let i = 0; i < total; i++) {
        const item = pendingFiles[i];
        if (!item.cloudUrl) {
          onProgress?.(i + 1, total, 0);
          try {
            const result = await uploadToCloudinary(item.file, percent => onProgress?.(i + 1, total, percent));
            item.cloudUrl = result.url;
            item.type = result.type;
          } catch (error) {
            // Se anota con su posición para poder decir QUÉ archivo falló,
            // no un genérico inútil. `cloudUrl` sigue vacío, así que un
            // segundo intento reintenta solo este.
            fallidos.push({ index: i + 1, error });
            continue;
          }
        }
        media.push({ type: item.type, src: item.cloudUrl });
      }
    } finally {
      LBMedia.releaseWakeLock();
    }
    return { media, fallidos, total };
  }
  if (editId) {
    const existing = vehicles.find(v => v.id === editId);
    return { media: (existing && existing.media) || [], fallidos: [], total: 0 };
  }
  return { media: [], fallidos: [], total: 0 };
}

// ============================================================
// OPERACIONES DE DOMINIO — construyen la entidad, aplican el cambio
// optimista (con rollback) y persisten. No deciden toasts, modal ni
// navegación: el listener reacciona al resultado.
// ============================================================
async function updateVehicle(editId, data, media, token) {
  const idx = vehicles.findIndex(v => v.id === editId);
  const existing = idx !== -1 ? vehicles[idx] : null;
  if (!existing) return { success: false, notFound: true };

  const coverImg = media.length > 0 ? media[0].src : '';
  const updated = { ...existing, ...data, img: coverImg || existing.img, media };
  // Slug inmutable: se conserva el existente.
  updated.slug = existing.slug || getVehicleSlug(existing);

  let previous = null;
  if (fbReady) {
    previous = cloneVehicle(existing);
    vehicles[idx] = updated;
    renderSections();
    if (!document.getElementById('detail-page').classList.contains('page-hidden')) openDetail(editId);
  }

  const result = await saveVehicleDB(updated);
  if (token !== currentSaveToken) return { success: false, stale: true };

  if (!result.success) {
    if (fbReady) {
      // Rollback: se re-busca el índice por id — nunca se reutiliza el
      // capturado antes del await, por si el array cambió en la espera.
      const rollbackIndex = vehicles.findIndex(v => v.id === editId);
      if (rollbackIndex !== -1) vehicles[rollbackIndex] = previous;
      renderSections();
      if (!document.getElementById('detail-page').classList.contains('page-hidden')) openDetail(editId);
    }
    return { success: false, error: result.error };
  }
  if (!fbReady) renderSections();
  return { success: true, vehicle: updated };
}
async function publishVehicle(data, media, token) {
  const coverImg = media.length > 0 ? media[0].src : '';
  const newV = { ...data, id: genId(), img: coverImg, media, createdAt: Date.now() };
  newV.slug = generateUniqueSlug(data.name, newV.id); // slug estable de por vida

  const result = await saveVehicleDB(newV);
  if (token !== currentSaveToken) return { success: false, stale: true };
  if (!result.success) return { success: false, error: result.error };
  if (!fbReady) renderSections();
  return { success: true, vehicle: newV };
}
async function removeVehicle(id, token) {
  const result = await deleteVehicleDB(id);
  if (token !== currentDeleteToken) return { success: false, stale: true };
  if (!result.success) return { success: false, error: result.error };
  return { success: true };
}

// ============================================================
// LISTENER — solo orquesta: lee, valida, llama a la operación de
// dominio y reacciona al resultado (toast, modal, navegación).
// ============================================================
document.getElementById('publish-submit-btn').addEventListener('click', async () => {
  if (operations.vehicle.save) return; // doble clic — ignorar
  const form = readPublishForm();
  const validation = validatePublishForm(form);
  if (!validation.valid) { showToast(validation.message); return; }

  operations.vehicle.save = true;
  const token = ++currentSaveToken;
  const btn = document.getElementById('publish-submit-btn');
  const idleLabel = form.editId ? 'Guardar Cambios' : 'Publicar Vehículo';
  setBtnBusy(btn, true, '⏳ Procesando...', idleLabel);

  try {
    let media;
    try {
      const subida = await resolvePublishMedia(form.editId, (i, total, percent) => {
        const label = btn.querySelector('.btn-label') || btn;
        // El porcentaje real importa en móvil: sin él, una subida lenta
        // pero sana se lee como "se colgó" y el usuario recarga la página
        // a mitad de la publicación.
        label.textContent = percent > 0
          ? `⏳ Subiendo ${i} de ${total} · ${percent}%`
          : `⏳ Subiendo ${i} de ${total}...`;
      }, mediaClearedByUser);
      if (token !== currentSaveToken) return;
      media = subida.media;

      // Alguna foto no subió. No se aborta: se explica qué pasó y se deja
      // elegir entre publicar con lo que sí está o volver al formulario.
      // Lo ya subido queda marcado, así que reintentar solo sube lo que
      // falta en vez de empezar de cero.
      if (subida.fallidos.length > 0) {
        const primero = subida.fallidos[0];
        const motivo = LBMedia.describeError(primero.error, { index: primero.index, total: subida.total });
        console.error('Error subiendo a Cloudinary:', primero.error);
        const conservadas = media.length;
        const detalle = conservadas > 0
          ? `Se subieron ${conservadas} de ${subida.total} archivo(s).`
          : `No se pudo subir ninguno de los ${subida.total} archivo(s).`;
        const accion = conservadas > 0
          ? `Aceptar: ${form.editId ? 'guardar' : 'publicar'} ahora con ${conservadas} foto(s).`
          : `Aceptar: ${form.editId ? 'guardar' : 'publicar'} sin fotos (podrás añadirlas después editando el vehículo).`;
        const seguir = confirm(
          `${motivo}\n\n${detalle}\n\n${accion}\nCancelar: volver al formulario y pulsar Publicar otra vez para reintentar solo lo que falta.`
        );
        if (!seguir || token !== currentSaveToken) return;
      }
    } catch (e) {
      console.error('Error subiendo a Cloudinary:', e);
      if (token === currentSaveToken) showToast(LBMedia.describeError(e, null), 6000);
      return; // el modal permanece abierto — el usuario no pierde lo que escribió
    }
    if (token !== currentSaveToken) return;

    showToast(form.editId ? '⏳ Guardando cambios...' : '⏳ Publicando vehículo...');
    const result = form.editId
      ? await updateVehicle(form.editId, form.data, media, token)
      : await publishVehicle(form.data, media, token);

    if (result.stale) return;
    if (!result.success) {
      if (result.notFound) return;
      showToast(form.editId
        ? '❌ Error al guardar en Firebase — tus cambios NO se guardaron'
        : '❌ Error al guardar en Firebase — el vehículo NO se publicó');
      return; // el modal sigue abierto con los datos escritos
    }

    closePublishModal(); // único lugar donde se cierra — solo tras éxito real
    showToast(form.editId ? '✅ Vehículo actualizado correctamente' : '✅ Vehículo publicado — visible para todos');
    if (!form.editId) setTimeout(() => scrollToSection(form.data.category), 400);
  } finally {
    operations.vehicle.save = false;
    setBtnBusy(btn, false, '', idleLabel);
  }
});
// Limpiar pendingFiles al cerrar modal
function closePublishModal() {
  const modal = document.getElementById('publish-modal');
  if (!modal.classList.contains('hidden')) unlockBodyScroll();
  modal.classList.add('hidden');
  revokePendingObjectUrls();
  pendingFiles = [];
  mediaClearedByUser = false;
}
// ============================================================
// CALCULADORA FINANCIERA (modal único + FAB) — se movió a
// calculadora.js (módulo aparte, cargado vía
// <script defer src="/calculadora.js"> justo después de este archivo
// en index.html). Expone globalmente: LB_CALC, openCalcModal(vehicle),
// closeCalcModal(), initCalcModalA11y(), initFabCalc().
// ============================================================
// ============================================================
// FILTRO POR LOGO DE MARCA (estilo SuperCarros)
// ============================================================
// Slug de simple-icons (jsDelivr CDN) por marca, y color/inicial de respaldo si el logo no carga
const BRAND_LOGO_MAP = {
  'Toyota': { slug: 'toyota', initial: 'T', color: '#EB0A1E' },
  'Honda': { slug: 'honda', initial: 'H', color: '#E40521' },
  'BMW': { slug: 'bmw', initial: 'B', color: '#0066B1' },
  'Mercedes': { slug: 'mercedes', initial: 'M', color: '#9E9E9E' },
  'Audi': { slug: 'audi', initial: 'A', color: '#BB0A30' },
  'Ford': { slug: 'ford', initial: 'F', color: '#003478' },
  'Chevrolet': { slug: 'chevrolet', initial: 'C', color: '#D1B12C' },
  'Nissan': { slug: 'nissan', initial: 'N', color: '#C3002F' },
  'Hyundai': { slug: 'hyundai', initial: 'H', color: '#002C5F' },
  'Kia': { slug: 'kia', initial: 'K', color: '#05141F' },
  'Mazda': { slug: 'mazda', initial: 'M', color: '#101010' },
  'Volkswagen': { slug: 'volkswagen', initial: 'V', color: '#151F5D' },
  'Jeep': { slug: 'jeep', initial: 'J', color: '#424A3D' },
  'RAM': { slug: 'ram', initial: 'R', color: '#000000' },
  'GMC': { slug: 'gmc', initial: 'G', color: '#B81E2E' },
  'Lexus': { slug: 'lexus', initial: 'L', color: '#0F0F0F' },
  'Subaru': { slug: 'subaru', initial: 'S', color: '#013C74' },
  'Mitsubishi': { slug: 'mitsubishimotors', initial: 'M', color: '#E60012' },
  'Ferrari': { slug: 'ferrari', initial: 'F', color: '#D40000' },
  'Lamborghini': { slug: 'lamborghini', initial: 'L', color: '#DDB321' },
  'Porsche': { slug: 'porsche', initial: 'P', color: '#000000' },
  'Tesla': { slug: 'tesla', initial: 'T', color: '#CC0000' },
  'Land Rover': { slug: 'landrover', initial: 'LR', color: '#005A2B' },
  'Jaguar': { slug: 'jaguar', initial: 'J', color: '#1B3331' },
  'Volvo': { slug: 'volvo', initial: 'V', color: '#003057' },
  'Mini': { slug: 'mini', initial: 'M', color: '#000000' },
  'Bentley': { slug: null, initial: 'B', color: '#00543C' },
  'Rolls-Royce': { slug: 'rollsroyce', initial: 'RR', color: '#1A1A1A' },
  'Maserati': { slug: 'maserati', initial: 'M', color: '#0F0F0F' },
  'Alfa Romeo': { slug: 'alfaromeo', initial: 'AR', color: '#981E32' },
  'Aston Martin': { slug: 'astonmartin', initial: 'AM', color: '#00665A' },
  'McLaren': { slug: 'mclaren', initial: 'ML', color: '#FF8000' },
  'Bugatti': { slug: 'bugatti', initial: 'BG', color: '#0F0F0F' },
  'Chrysler': { slug: 'chrysler', initial: 'CH', color: '#000000' },
  'Dodge': { slug: 'dodge', initial: 'D', color: '#C00' },
  'Buick': { slug: 'buick', initial: 'BK', color: '#A6192E' },
  'Cadillac': { slug: 'cadillac', initial: 'CD', color: '#000000' },
  'Acura': { slug: 'acura', initial: 'AC', color: '#000000' },
  'Infiniti': { slug: 'infiniti', initial: 'IN', color: '#000000' },
  'Genesis': { slug: null, initial: 'GN', color: '#000000' },
  'Lincoln': { slug: 'lincoln', initial: 'LN', color: '#000000' },
  'Suzuki': { slug: 'suzuki', initial: 'SZ', color: '#E30016' },
  'Isuzu': { slug: 'isuzu', initial: 'IZ', color: '#CC0000' },
  'Peugeot': { slug: 'peugeot', initial: 'PG', color: '#000000' },
  'Renault': { slug: 'renault', initial: 'RN', color: '#FFCC00' },
  'Citroën': { slug: 'citroen', initial: 'CT', color: '#A9003C' },
  'Seat': { slug: 'seat', initial: 'ST', color: '#33302E' },
  'Skoda': { slug: 'skoda', initial: 'SK', color: '#4BA82E' },
  'Fiat': { slug: 'fiat', initial: 'FT', color: '#941711' },
  'Opel': { slug: 'opel', initial: 'OP', color: '#F7A800' },
};
// Convierte el color de marca (#RGB o #RRGGBB) en un tinte translúcido. El
// color crudo no servía de fondo: los muchos negros del mapa desaparecían
// sobre la tarjeta oscura y esas marcas parecían un hueco.
function brandTint(hex, alpha) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return `rgba(56,189,248,${alpha})`;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Marco de la marca: logo e iniciales comparten caja, fondo y borde. Antes
// eran dos piezas visuales distintas —un símbolo blanco suelto frente a un
// cuadro de color saturado—, así que el grid parecía roto en cuanto alguna
// marca faltaba en el CDN, que es lo habitual con los fabricantes.
function crearMarcaVisual(meta, brand) {
  const mark = document.createElement('div');
  mark.className = 'brand-mark';
  mark.setAttribute('aria-hidden', 'true'); // el <button> ya lleva aria-label
  mark.style.setProperty('--brand-tint', brandTint(meta.color, 0.38));
  const ponerIniciales = () => { mark.textContent = meta.initial || brand.charAt(0); };
  if (!meta.slug) { ponerIniciales(); return mark; }
  const logo = document.createElement('img');
  logo.src = `https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/${meta.slug}.svg`;
  logo.alt = '';
  logo.loading = 'lazy';
  logo.decoding = 'async';
  logo.addEventListener('error', () => { logo.remove(); ponerIniciales(); }, { once: true });
  mark.appendChild(logo);
  return mark;
}

function renderBrandLogoFilter() {
  const grid = document.getElementById('brand-logo-grid');
  if (!grid) return;
  const brandsInStock = [...new Set(vehicles.map(v => v.brand).filter(Boolean))].sort();
  grid.innerHTML = '';
  if (brandsInStock.length === 0) {
    grid.innerHTML = '<p class="text-slate-400 text-sm col-span-full">Aún no hay vehículos publicados.</p>';
    return;
  }
  brandsInStock.forEach(brand => {
    const meta = BRAND_LOGO_MAP[brand] || { slug: null, initial: brand.charAt(0), color: '#38bdf8' };
    const count = vehicles.filter(v => v.brand === brand).length;
    // <button> en vez de <div>: era un div con un listener de clic, sin
    // tabindex ni role, así que el filtro por marca —una de las funciones
    // principales de la portada— era IMPOSIBLE de usar con teclado
    // (WCAG 2.1.1). aria-pressed comunica además qué marca está activa.
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'brand-logo-card';
    card.dataset.brand = brand;
    card.setAttribute('aria-pressed', 'false');
    card.setAttribute('aria-label', `Filtrar por ${brand} (${count} ${count === 1 ? 'vehículo' : 'vehículos'})`);
    card.appendChild(crearMarcaVisual(meta, brand));
    const nm = document.createElement('span');
    nm.className = 'brand-name'; nm.textContent = brand;
    const ct = document.createElement('span');
    ct.className = 'brand-count'; ct.textContent = `${count} ${count === 1 ? 'auto' : 'autos'}`;
    card.appendChild(nm); card.appendChild(ct);
    card.addEventListener('click', () => {
      const isActive = card.classList.contains('active');
      document.querySelectorAll('.brand-logo-card').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      if (isActive) {
        // Deselect — clear filter
        document.getElementById('filter-results').classList.add('hidden');
        document.getElementById('brand-clear-btn').classList.add('hidden');
      } else {
        card.classList.add('active');
        card.setAttribute('aria-pressed', 'true');
        filterByBrand(brand);
        document.getElementById('brand-clear-btn').classList.remove('hidden');
      }
    });
    grid.appendChild(card);
  });
}
function filterByBrand(brand) {
  const results = vehicles.filter(v => v.brand === brand);
  const section = document.getElementById('filter-results');
  const grid = document.getElementById('filter-grid');
  const countEl = document.getElementById('filter-results-count');
  const noRes = document.getElementById('filter-no-results');
  section.classList.remove('hidden');
  grid.innerHTML = '';
  if (results.length === 0) {
    noRes.classList.remove('hidden');
    countEl.textContent = '';
  } else {
    noRes.classList.add('hidden');
    countEl.textContent = `${results.length} vehículo(s) de ${brand}`;
    results.forEach(v => {
      const card = renderCard(v);
      grid.appendChild(card);
    });
    grid.querySelectorAll('.ver-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        if (isModifiedClick(e)) return;
        e.preventDefault(); openDetail(btn.dataset.id);
      });
    });
    if (window.lucide) lucide.createIcons();
  }
  section.scrollIntoView({ behavior:'smooth', block:'start' });
}
document.getElementById('brand-clear-btn')?.addEventListener('click', () => {
  document.querySelectorAll('.brand-logo-card').forEach(c => {
    c.classList.remove('active');
    c.setAttribute('aria-pressed', 'false');
  });
  document.getElementById('filter-results').classList.add('hidden');
  document.getElementById('brand-clear-btn').classList.add('hidden');
});
const ALL_BRANDS = [
  'Acura','Alfa Romeo','Aston Martin','Audi','Bentley','BMW','Bugatti','Buick',
  'Cadillac','Chevrolet','Chrysler','Citroën','Dodge','Ferrari','Fiat','Ford',
  'Genesis','GMC','Honda','Hummer','Hyundai','Infiniti','Isuzu','Jaguar',
  'Jeep','Kia','Lamborghini','Land Rover','Lexus','Lincoln','Lotus','Maserati',
  'Maybach','Mazda','McLaren','Mercedes','Mercury','Mini','Mitsubishi',
  'Nissan','Oldsmobile','Opel','Peugeot','Pontiac','Porsche','RAM','Renault',
  'Rolls-Royce','Saab','Saturn','Scion','Seat','Skoda','Smart','Subaru',
  'Suzuki','Tesla','Toyota','Volkswagen','Volvo'
].sort();
const ALL_COLORS = [
  'Amarillo','Amarillo Champagne','Amarillo Lima','Azul','Azul Celeste','Azul Cobalto',
  'Azul Eléctrico','Azul Marino','Azul Medianoche','Azul Metalizado','Azul Noche',
  'Azul Oscuro','Azul Petróleo','Azul Royal','Beige','Beige Arena','Blanco',
  'Blanco Hueso','Blanco Nacarado','Blanco Perla','Borgoña','Bronce',
  'Café','Café Metalizado','Canela','Carbon','Champagne','Chocolate',
  'Cobre','Coral','Crema','Dorado','Dorado Champagne','Dorado Metalizado',
  'Gris','Gris Acero','Gris Antracita','Gris Cemento','Gris Claro',
  'Gris Grafito','Gris Humo','Gris Metalizado','Gris Oscuro','Gris Plata',
  'Gris Titanio','Granate','Guinda','Lila','Magenta','Marrón',
  'Marrón Metalizado','Morado','Naranja','Naranja Metalizado','Negro',
  'Negro Azabache','Negro Brillante','Negro Mate','Negro Metalizado',
  'Oliva','Oro','Plateado','Plateado Brillante','Plateado Metalizado',
  'Plomo','Rojo','Rojo Burdeos','Rojo Carmesí','Rojo Cereza',
  'Rojo Ferrari','Rojo Fuego','Rojo Metalizado','Rojo Oscuro','Rojo Vino',
  'Rosa','Rosado','Salmón','Teja','Titanio','Turquesa','Verde',
  'Verde Bosque','Verde Esmeralda','Verde Limón','Verde Metalizado',
  'Verde Militar','Verde Menta','Verde Musgo','Verde Oliva','Verde Oscuro',
  'Verde Petróleo','Violeta','Vino'
].sort();
// ============================================================
// FACTORY GENÉRICA DE DROPDOWN CON BÚSQUEDA — usada por el selector
// de color y el de marca del formulario de publicación. Consolida
// dos implementaciones que eran casi idénticas (menos código, un
// solo lugar que mantener si cambia el comportamiento).
// ============================================================
// Patrón combobox accesible. Antes las opciones eran <div> que solo
// escuchaban `mousedown`: el desplegable de MARCA y el de COLOR del
// formulario de publicación no se podían usar con teclado (WCAG 2.1.1),
// y tampoco anunciaban nada a un lector de pantalla. Ahora responden a
// ArrowUp/ArrowDown/Enter/Escape y exponen role/aria-expanded/aria-activedescendant.
function createSearchDropdown({ inputId, hiddenId, dropdownId, displayId, options, emptyText, allowEmptyFilter = true }) {
  const searchInput = document.getElementById(inputId);
  const hiddenInput = document.getElementById(hiddenId);
  const dropdown = document.getElementById(dropdownId);
  const display = document.getElementById(displayId);
  if (!searchInput) return;
  let activeIdx = -1;
  let current = [];

  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', dropdownId);
  dropdown.setAttribute('role', 'listbox');

  function closeDropdown() {
    dropdown.classList.add('hidden');
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIdx = -1;
  }
  function choose(value) {
    hiddenInput.value = value;
    searchInput.value = value;
    display.textContent = '✓ ' + value;
    display.classList.remove('hidden');
    closeDropdown();
  }
  function highlight(idx) {
    const items = dropdown.querySelectorAll('[role="option"]');
    if (items.length === 0) return;
    activeIdx = (idx + items.length) % items.length;
    items.forEach((el, i) => {
      const on = i === activeIdx;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.classList.toggle('bg-slate-700', on);
      if (on) { searchInput.setAttribute('aria-activedescendant', el.id); el.scrollIntoView({ block: 'nearest' }); }
    });
  }
  function renderDropdown(filter) {
    const f = (filter || '').toLowerCase();
    const filtered = (!f && !allowEmptyFilter) ? [] :
      (f ? options.filter(o => o.toLowerCase().includes(f)) : options);
    current = filtered;
    dropdown.innerHTML = '';
    activeIdx = -1;
    searchInput.removeAttribute('aria-activedescendant');
    if (filtered.length === 0) {
      const none = document.createElement('div');
      none.className = 'px-3 py-2 text-slate-400 text-sm';
      none.textContent = emptyText;
      dropdown.appendChild(none);
    } else {
      filtered.forEach((value, i) => {
        const item = document.createElement('div');
        item.id = `${dropdownId}-opt-${i}`;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', 'false');
        item.className = 'px-3 py-2 text-white text-sm cursor-pointer hover:bg-slate-700 transition';
        item.textContent = value;
        item.addEventListener('mousedown', e => { e.preventDefault(); choose(value); });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
    searchInput.setAttribute('aria-expanded', 'true');
  }
  searchInput.addEventListener('input', () => {
    hiddenInput.value = '';
    display.classList.add('hidden');
    renderDropdown(searchInput.value);
  });
  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  searchInput.addEventListener('blur', () => setTimeout(closeDropdown, 150));
  searchInput.addEventListener('keydown', e => {
    const open = !dropdown.classList.contains('hidden');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) renderDropdown(searchInput.value);
      highlight(activeIdx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) renderDropdown(searchInput.value);
      highlight(activeIdx - 1);
    } else if (e.key === 'Enter') {
      if (open && activeIdx >= 0 && current[activeIdx]) { e.preventDefault(); choose(current[activeIdx]); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); closeDropdown(); }
    }
  });
}
function initColorSearch() {
  createSearchDropdown({
    inputId: 'pub-color-search', hiddenId: 'pub-color',
    dropdownId: 'color-dropdown', displayId: 'color-selected-display',
    options: ALL_COLORS, emptyText: 'No encontrado'
  });
}
function resetColorSearch(value = '') {
  const s = document.getElementById('pub-color-search');
  const h = document.getElementById('pub-color');
  const d = document.getElementById('color-selected-display');
  if (!s) return;
  s.value = value; h.value = value;
  if (value) { d.textContent = '✓ ' + value; d.classList.remove('hidden'); }
  else d.classList.add('hidden');
}
function initBrandSearch() {
  createSearchDropdown({
    inputId: 'pub-brand-search', hiddenId: 'pub-brand',
    dropdownId: 'brand-dropdown', displayId: 'brand-selected-display',
    options: ALL_BRANDS, emptyText: 'No encontrada'
  });
}
// Reset brand search in openPublishModal
function resetBrandSearch(value = '') {
  const searchInput = document.getElementById('pub-brand-search');
  const hiddenInput = document.getElementById('pub-brand');
  const display = document.getElementById('brand-selected-display');
  const dropdown = document.getElementById('brand-dropdown');
  if (!searchInput) return;
  searchInput.value = value;
  hiddenInput.value = value;
  if (value) {
    display.textContent = '✓ ' + value;
    display.classList.remove('hidden');
  } else {
    display.classList.add('hidden');
  }
  if (dropdown) dropdown.classList.add('hidden');
}
// ============================================================
// MENÚ "EMPRESA" — dropdown accesible (clic + teclado, funciona
// igual en desktop y móvil; no depende de :hover para no romperse
// en pantallas táctiles)
// ============================================================
function initNavEmpresa() {
  const wrap = document.getElementById('nav-empresa');
  const btn = document.getElementById('nav-empresa-btn');
  const menu = document.getElementById('nav-empresa-menu');
  if (!wrap || !btn || !menu) return;

  function closeMenu() {
    menu.classList.add('hidden');
    btn.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    menu.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  }
  btn.addEventListener('click', () => {
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    isOpen ? closeMenu() : openMenu();
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    // Además de cerrar, hay que DEVOLVER el foco al botón: sin esto el foco
    // quedaba huérfano en el documento y quien navega con teclado tenía que
    // recorrer la página entera de nuevo.
    if (btn.getAttribute('aria-expanded') === 'true') { closeMenu(); btn.focus(); }
  });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
}

// ============================================================
// SUBPÁGINAS DE EMPRESA — ahora son páginas HTML reales
// ------------------------------------------------------------
// /empresa/por-que-elegirnos, /empresa/quienes-somos,
// /empresa/mision-vision y /empresa/nuestros-valores dejaron de ser
// vistas ocultas dentro de index.html: cada una es su propio documento
// en /empresa/*.html, igual que las páginas legales. Por eso aquí ya no
// hay routing, ni meta tags dinámicas, ni FAQ inyectada por JS — cada
// página lleva su <title>, su canonical, su Open Graph y su JSON-LD
// escritos en el HTML, que es lo que los rastreadores leen sin ejecutar
// JavaScript. Los enlaces del menú Empresa son enlaces normales.
// ============================================================

// ============================================================
// ENTRADA A LA CALCULADORA DESDE FUERA DE LA SPA
// ------------------------------------------------------------
// Las páginas de Empresa son HTML estático y no cargan el modal, así que
// enlazan a /#calculadora y es la home quien lo abre. Se escucha también
// `hashchange` porque si el visitante ya está en la home, cambiar el hash
// no recarga el documento y `DOMContentLoaded` no vuelve a dispararse.
// El hash se retira del historial tras abrir para que recargar o
// compartir la URL no reabra el modal sin querer.
// ============================================================
function openCalcFromHash() {
  if (window.location.hash !== '#calculadora') return;
  if (typeof openCalcModal !== 'function') return;
  openCalcModal();
  try { history.replaceState(null, '', window.location.pathname + window.location.search); }
  catch (e) { /* iframe/sandbox — el modal ya está abierto */ }
}
window.addEventListener('hashchange', openCalcFromHash);

// ============================================================
// RESPALDO DE IMÁGENES
// ============================================================
// Cada <img> declara su respaldo en data-fallback: una URL que sustituye al
// src, o "hide" para ocultarse. Sustituye a los onerror inline que impedían
// retirar script-src 'unsafe-inline' del CSP.
function applyImageFallback(img) {
  const fallback = img.getAttribute('data-fallback');
  if (!fallback) return;
  if (fallback === 'hide') { img.style.display = 'none'; return; }
  // Si el propio respaldo es lo que falló, reasignarlo entraría en bucle.
  if (img.src === fallback) return;
  img.src = fallback;
}

// El evento `error` no burbujea: se escucha en captura. Se registra al
// evaluar el archivo, no en DOMContentLoaded, para estrechar la ventana en
// la que una imagen puede fallar sin oyente.
document.addEventListener('error', e => {
  if (e.target instanceof HTMLImageElement) applyImageFallback(e.target);
}, true);

// A diferencia del atributo inline, que quedaba registrado durante el
// parseo, el oyente de arriba llega después: una imagen del HTML inicial
// puede haber fallado ya. Una que terminó sin píxeles (complete con
// naturalWidth 0) no volverá a emitir `error`, así que se repasa a mano. Se
// excluyen las que aún no tienen src —el <img> del lightbox nace vacío— o
// se les aplicaría el respaldo sin haber intentado cargar nada.
function applyPendingImageFallbacks(root = document) {
  root.querySelectorAll('img[data-fallback]').forEach(img => {
    if (!img.getAttribute('src')) return;
    if (img.complete && img.naturalWidth === 0) applyImageFallback(img);
  });
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  applyPendingImageFallbacks();
  // El perfil se guarda desde sus propios botones; el <form> solo agrupa los
  // campos. Sin esto, pulsar Enter en un input navegaría y perdería la
  // edición en curso (antes lo evitaba un onsubmit="return false" inline).
  document.getElementById('db-profile-form')
    ?.addEventListener('submit', e => e.preventDefault());
  updateAdminUI();
  populateYears('pub-year');
  initBrandSearch();
  initColorSearch();
  initCalcModalA11y();
  initFabCalc();
  initNavEmpresa();
  updateNavFavCount();
  if (window.lucide) lucide.createIcons();
  // Si alguien entra con un link directo tipo /vehiculos/bmw-330i-2024,
  // el hosting redirige a index.html (ver _redirects/vercel.json/404.html)
  // y aquí detectamos la ruta real para abrir la ficha correcta.
  // Esto es lo que hace posible que Google indexe cada vehículo por
  // separado: la URL /vehiculos/slug siempre carga con el contenido
  // correcto, sin depender de un hash.
  function checkPathVehicle() {
    const match = window.location.pathname.match(/^\/vehiculos\/([^\/]+)\/?$/);
    if (!match) return;
    const slug = decodeURIComponent(match[1]);
    // Se reintenta cada 120 ms y SIN espera inicial. Antes había un
    // setTimeout fijo de 800 ms antes del primer intento: como el inventario
    // suele llegar antes, el visitante que abría un enlace compartido por
    // WhatsApp veía la PORTADA durante casi un segundo y después la página
    // saltaba sola a la ficha. Ahora la ficha se abre en cuanto hay datos.
    const tryOpen = (attempts = 0) => {
      const v = findVehicleBySlug(slug);
      if (v) {
        openDetail(v.id);
      } else if (attempts < 85) {
        setTimeout(() => tryOpen(attempts + 1), 120);
      } else {
        // Vehículo no encontrado tras esperar 10s — mostrar 404 real
        // en vez de dejar al usuario esperando indefinidamente.
        console.warn('Vehículo no encontrado para el slug:', slug);
        showNotFound();
      }
    };
    tryOpen(0);
  }
  checkPathVehicle();
  openCalcFromHash();
  // Entrada directa a /dashboard: refresh, marcador, o link compartido.
  // routeFromLocation() ya sabe manejar esta ruta, pero solo se ejecuta
  // en popstate — la carga inicial no pasa por ahí.
  if (window.location.pathname === '/dashboard') {
    window.LB_DASHBOARD?.open(false);
  }
  // Única fuente de reactividad para permisos de gestión: se actualiza
  // sola si el role/status cambia o la sesión termina.
  let _lastFavSyncUid = null;
  onUserChanged(({ user } = {}) => {
    updateAdminUI();
    if (canManageVehicles()) backfillSlugs();
    // Fase 1: sincronizar favoritos una sola vez por cada login real
    // (no en cada re-render del listener), fusionando invitado + remoto.
    if (user && user.uid !== _lastFavSyncUid) {
      _lastFavSyncUid = user.uid;
      syncFavoritesOnLogin().catch(() => {});
    } else if (!user) {
      _lastFavSyncUid = null;
    }
  });
});

// ============================================================
// ACCESIBILIDAD DE MODALES — Escape para cerrar + focus trap + devolver
// el foco al elemento que abrió el modal. Aplica a los 4 modales que
// no tienen su propio manejo de accesibilidad (el modal de calculadora
// ya lo maneja en calculadora.js vía initCalcModalA11y()).
// ============================================================
function setupModalAccessibility(modalId, closeFn) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  let lastFocusedEl = null;

  function getFocusable() {
    return Array.from(modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.disabled && el.offsetParent !== null);
  }

  function onKeydown(e) {
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
    if (e.key === 'Tab') {
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }
  document.addEventListener('keydown', onKeydown);

  const observer = new MutationObserver(() => {
    if (!modal.classList.contains('hidden')) {
      lastFocusedEl = document.activeElement;
      const focusable = getFocusable();
      (focusable[0] || modal).focus();
    } else if (lastFocusedEl) {
      lastFocusedEl.focus();
      lastFocusedEl = null;
    }
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
}

setupModalAccessibility('delete-modal', () => document.getElementById('delete-cancel-btn').click());
setupModalAccessibility('publish-modal', closePublishModal);
setupModalAccessibility('account-modal', closeAccountModal);

// ============================================================
// ARRANQUE — DEBE SER LO ÚLTIMO DE ESTE ARCHIVO.
// ------------------------------------------------------------
// app.js se carga con `defer`, así que cuando el navegador llega aquí el
// DOM ya está parseado y TODAS las declaraciones de este archivo
// (incluida `const pageState`) están inicializadas. Ese es justo el
// motivo de ponerlo al final: colocado a mitad del archivo, la llamada
// se ejecutaba antes de que `pageState` existiera y renderCategory()
// lanzaba "Cannot access 'pageState' before initialization".
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebase);
} else {
  initFirebase();
}
