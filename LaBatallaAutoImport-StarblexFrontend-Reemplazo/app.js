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
    <button onclick="window.location.reload()" style="background:#38bdf8;color:#0f172a;font-weight:800;padding:10px 24px;border:none;border-radius:10px;cursor:pointer;font-size:14px;">Recargar página</button>
  </div>`;
  overlay.style.display = 'flex';
  lucide.createIcons();
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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      vehicles = JSON.parse(raw);
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.style.display = 'none';
      renderSections();
      lucide.createIcons();
      return;
    }
  } catch(e) {}

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
    lucide.createIcons();
  };
  script.onerror = () => showDataLoadError();
  document.head.appendChild(script);
}
// ————— Estado vacío explícito (reemplaza el auto-seed) —————
function renderEmptyInventoryState() {
  ['sedanes', 'suvs', 'pickups'].forEach(cat => {
    const scroll = document.getElementById(cat + '-scroll');
    const paginationEl = document.getElementById(cat + '-pagination');
    if (scroll) scroll.innerHTML = '<p class="text-slate-400 text-sm py-4">Inventario en actualización — vuelve pronto.</p>';
    if (paginationEl) paginationEl.innerHTML = '';
  });
  renderBrandLogoFilter();
  lucide.createIcons();
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
  for (const v of missing) {
    try {
      await db.collection('vehicles').doc(v.id).update({ slug: getVehicleSlug(v) });
      okCount++;
    } catch (e) {
      // No abortar el resto: un documento antiguo con datos que ya no pasan
      // las reglas endurecidas (p. ej. `year` inválido) se arregla editando
      // y guardando ese vehículo desde el panel — el resto sigue su curso.
      console.warn(`Backfill: no se pudo persistir el slug de "${v.name}" (${v.id}). ` +
        'Edita y guarda ese vehículo desde el panel para regularizarlo.', e);
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
      const { id, ...dataToWrite } = v;
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
    // tocar código (ver config/finanzas en Firestore Rules).
    db.collection('config').doc('finanzas').get().then(doc => {
      if (doc.exists && typeof doc.data().tasaUsdRd === 'number') {
        USD_TO_RD_RATE = doc.data().tasaUsdRd;
      }
    }).catch(() => { /* se mantiene el valor de respaldo */ });
    db.collection('vehicles').onSnapshot((snap) => {
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
      lucide.createIcons();
    }, (err) => {
      console.error('Firestore error:', err);
      initLocalMode();
    });
  } catch(e) {
    console.error('Firebase init error:', e);
    try { initLocalMode(); } catch(e2) { showDataLoadError(); }
  }
}
// Iniciar después de que el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebase);
} else {
  initFirebase();
}
// ============================================================
// HELPERS
// ============================================================
function fmtPrice(p, v) {
  if (v && v.priceDisplay) return v.priceDisplay;
  return 'RD$ ' + Number(p).toLocaleString('es-DO');
}
// ============================================================
// ROUTING REAL — Slugs y URLs por vehículo (reemplaza #auto-id)
// ============================================================
// Convierte "BMW 330i 2024" -> "bmw-330i-2024"
function slugify(text) {
  return String(text).toLowerCase()
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
  title: 'La Batalla Auto Import | Sedanes, SUVs y Camionetas en RD',
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
  const rawImg = v.media?.[0] ? (typeof v.media[0] === 'string' ? v.media[0] : v.media[0].src) : v.img;
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
  const img = v.media?.[0] ? (typeof v.media[0] === 'string' ? v.media[0] : v.media[0].src) : v.img;
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
function scrollToSection(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}
// ============================================================
// RENDER VEHICLE CARD
// ============================================================
function renderCard(v) {
  // media[0] es {type, src} — extraer .src correctamente
  let imgSrc = 'https://placehold.co/300x176/1e293b/38bdf8?text=Auto';
  if (v.media && v.media.length > 0) {
    const first = v.media[0];
    imgSrc = typeof first === 'string' ? first : (first.src || first);
  } else if (v.img) {
    imgSrc = v.img;
  }
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
    <div class="relative card-image-link" data-id="${escapeAttr(v.id)}" role="link" tabindex="0" aria-label="Ver ${escapeAttr(v.name)}">
      <img src="${escapeAttr(cldOptimize(imgSrc, 500))}" class="w-full h-44 object-cover" loading="lazy" alt="${escapeAttr(v.name)}"
        onerror="this.src='https://placehold.co/300x176/1e293b/38bdf8?text=Auto'">
      ${isNew ? `<span class="absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full" style="background:#38bdf8;color:#0f172a;">✨ NUEVO</span>` : ''}
      <button type="button" class="fav-btn absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center transition" data-id="${escapeAttr(v.id)}" aria-label="Agregar a favoritos" style="background:rgba(15,23,42,0.65);backdrop-filter:blur(4px);border:1px solid rgba(255,255,255,0.1);">
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
        <a href="${vehiclePath}" class="ver-btn flex-1 px-3 py-2 rounded-lg font-medium text-sm text-center" data-id="${v.id}"
          style="background:rgb(14,165,233); color:#fff;">Ver Características</a>
        <a href="https://wa.me/18097759771?text=${encodeURIComponent('Hola, estoy interesado en el ' + v.name + ' (' + fmtPrice(v.price, v) + ') de La Batalla Auto Import. ¿Está disponible?\n\n🔗 ' + vehicleUrl)}" target="_blank" rel="noopener noreferrer"
          class="px-3 py-2 rounded-lg font-medium text-center text-sm flex items-center justify-center"
          style="background:rgb(34,197,94); color:#fff;" title="WhatsApp">
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
  // Click/tap en la imagen o miniatura del vehículo → abre la ficha completa
  const cardImg = e.target.closest('.card-image-link');
  if (cardImg) {
    window.scrollTo(0, 0);
    openDetail(cardImg.dataset.id);
  }
});
// Soporte de teclado (Enter/Espacio) para .card-image-link — accesibilidad
document.addEventListener('keydown', e => {
  const cardImg = e.target.closest && e.target.closest('.card-image-link');
  if (cardImg && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    window.scrollTo(0, 0);
    openDetail(cardImg.dataset.id);
  }
});
// ============================================================
// MI CUENTA — Login simple (localStorage) + panel de Favoritos
// ============================================================
function updateNavFavCount() {
  const el = document.getElementById('nav-fav-count');
  if (!el) return;
  const n = getFavorites().length;
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
    const imgSrc = v.media && v.media.length > 0
      ? (typeof v.media[0] === 'string' ? v.media[0] : (v.media[0].src || v.img || ''))
      : (v.img || 'https://placehold.co/300x176/1e293b/38bdf8?text=Auto');
    const card = document.createElement('div');
    card.className = 'rounded-xl overflow-hidden cursor-pointer relative group';
    card.style.cssText = 'background:rgb(30,41,59);border:1px solid rgba(255,255,255,0.07);';
    card.innerHTML = `
      <div style="height:90px;overflow:hidden;position:relative;">
        <img src="${escapeAttr(cldOptimize(imgSrc, 300))}" alt="${escapeAttr(v.name)}" style="width:100%;height:100%;object-fit:cover;"
          onerror="this.src='https://placehold.co/300x120/1e293b/38bdf8?text=Auto'">
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
  lucide.createIcons();
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
  ['sedanes','suvs','pickups'].forEach(cat => renderCategory(cat));
  document.querySelectorAll('.ver-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.preventDefault(); openDetail(btn.dataset.id); });
  });
  renderBrandLogoFilter();
  lucide.createIcons();
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
    btn.addEventListener('click', (e) => { e.preventDefault(); openDetail(btn.dataset.id); });
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
  const sA = 'width:38px;height:38px;border-radius:50%;background:rgb(14,165,233);color:#fff;font-size:14px;font-weight:800;border:none;cursor:pointer;box-shadow:0 0 14px rgba(14,165,233,0.45);display:flex;align-items:center;justify-content:center;';
  const sI = 'width:38px;height:38px;border-radius:50%;background:rgb(22,32,50);color:rgb(148,163,184);font-size:14px;font-weight:700;border:1px solid rgba(255,255,255,0.09);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;';
  const sAr = 'width:38px;height:38px;border-radius:50%;background:rgb(22,32,50);color:#94a3b8;font-size:20px;font-weight:700;border:1px solid rgba(255,255,255,0.09);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all 0.15s;';
  const make = (label, page, style) => {
    const btn = document.createElement('button');
    btn.innerHTML = label;
    btn.style.cssText = style;
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
function updateAdminUI() {
  const { profile } = getCurrentUser();
  const canManage = canManageVehicles();
  const badge = document.getElementById('admin-badge');
  const badgeLabel = document.getElementById('admin-badge-label');
  const btn = document.getElementById('nav-publish-btn');
  const detailCtrl = document.getElementById('detail-admin-controls');

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
// HERO SLIDESHOW — 6 slides con título/subtítulo propio +
// indicadores (dots) y flechas de navegación manual.
// ============================================================
const slides = document.querySelectorAll('.slide');
const heroTitleEl = document.getElementById('hero-title');
const heroSubtitleEl = document.getElementById('hero-subtitle');
const heroTextWrap = document.getElementById('hero-text-wrap');
const heroDotsEl = document.getElementById('hero-dots');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let slideIdx = 0;
let heroAutoplayTimer = null;

function renderHeroDots() {
  if (!heroDotsEl) return;
  heroDotsEl.innerHTML = Array.from(slides).map((_, i) =>
    `<button type="button" class="hero-dot${i === slideIdx ? ' active' : ''}" data-idx="${i}" role="tab" aria-label="Ir a la diapositiva ${i + 1}" aria-selected="${i === slideIdx}"></button>`
  ).join('');
  heroDotsEl.querySelectorAll('.hero-dot').forEach(dot => {
    dot.addEventListener('click', () => goToHeroSlide(Number(dot.dataset.idx), true));
  });
}

function goToHeroSlide(newIdx, userInitiated = false) {
  if (slides.length === 0 || newIdx === slideIdx) return;
  slides[slideIdx].classList.remove('active');
  slideIdx = ((newIdx % slides.length) + slides.length) % slides.length;
  slides[slideIdx].classList.add('active');

  // Crossfade del texto en sincronía con la transición de la imagen
  // (misma duración que .slide en styles.css) para que título/subtítulo
  // cambien sin sensación de "salto" brusco.
  if (heroTextWrap) {
    heroTextWrap.style.opacity = '0';
    setTimeout(() => {
      const active = slides[slideIdx];
      if (heroTitleEl) heroTitleEl.textContent = active.dataset.title || heroTitleEl.textContent;
      if (heroSubtitleEl) heroSubtitleEl.textContent = active.dataset.subtitle || heroSubtitleEl.textContent;
      heroTextWrap.style.opacity = '1';
    }, 280);
  }

  heroDotsEl?.querySelectorAll('.hero-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === slideIdx);
    dot.setAttribute('aria-selected', i === slideIdx);
  });

  // Si el usuario navegó manualmente, reiniciamos el temporizador de
  // autoplay para que no "compita" con el cambio recién hecho.
  if (userInitiated) startHeroAutoplay();
}

function startHeroAutoplay() {
  if (reducedMotion || slides.length === 0) return; // Respeta WCAG 2.3.3
  if (heroAutoplayTimer) clearInterval(heroAutoplayTimer);
  heroAutoplayTimer = setInterval(() => {
    if (document.hidden) return; // no rota con la pestaña oculta
    goToHeroSlide(slideIdx + 1);
  }, 5500);
}

if (slides.length > 0) {
  renderHeroDots();
  startHeroAutoplay();
  document.getElementById('hero-prev')?.addEventListener('click', () => goToHeroSlide(slideIdx - 1, true));
  document.getElementById('hero-next')?.addEventListener('click', () => goToHeroSlide(slideIdx + 1, true));
}
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
  document.getElementById('detail-carfax').textContent = v.carfax === 'si' ? '✅ Clean Carfax' : '❌ Sin Carfax';
  document.getElementById('detail-carfax').style.color = v.carfax === 'si' ? '#4ade80' : '#f87171';
  // WhatsApp link con URL real específica de esta publicación
  const vehicleUrl = getVehicleUrl(v);
  const waMsg = `Hola, estoy interesado en el *${v.name}* — ${fmtPrice(v.price, v)}\n\n🔗 Ver publicación: ${vehicleUrl}\n\n¿Está disponible?`;
  document.getElementById('detail-whatsapp-btn').href = `https://wa.me/18097759771?text=${encodeURIComponent(waMsg)}`;
  // Specs
  const specs = document.getElementById('detail-specs');
  specs.innerHTML = '';
  const specData = [
    ['Marca', v.brand], ['Año', v.year],
    ['Estado', v.condition === 'nuevo' ? 'Nuevo' : v.condition === 'importado' ? 'Recién Importado' : 'Usado'],
    ['Millaje', v.mileage ? v.mileage + ' km' : 'N/D'],
    ['Color', v.color || 'N/D'],
    ['Transmisión', v.transmission || 'N/D']
  ];
  specData.forEach(([label, value]) => {
    specs.innerHTML += `<div><p class="text-slate-400 mb-1">${escapeHtml(label)}</p><p class="text-white font-medium">${escapeHtml(value)}</p></div>`;
  });
  // Features
  const featList = document.getElementById('detail-features');
  featList.innerHTML = '';
  const feats = Array.isArray(v.features) ? v.features : [];
  if (feats.length === 0) {
    featList.innerHTML = '<li class="text-slate-400">No especificadas</li>';
  } else {
    feats.forEach(f => {
      const li = document.createElement('li');
      li.className = 'flex items-center gap-2 text-slate-200';
      li.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-sky-400 shrink-0"></i> ${escapeHtml(f)}`;
      featList.appendChild(li);
    });
  }
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
    }
  } catch(e) { /* iframe o sandbox — ignorar */ }
  document.getElementById('main-page').classList.add('page-hidden');
  document.getElementById('detail-page').classList.remove('page-hidden');
  window.scrollTo(0,0);
  lucide.createIcons();
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
  // Rutas de Empresa — /empresa/quienes-somos, /empresa/mision-vision, etc.
  const empMatch = path.match(/^\/empresa\/([^\/]+)\/?$/);
  if (empMatch) {
    const section = decodeURIComponent(empMatch[1]);
    if (EMPRESA_SECTIONS.includes(section)) { showEmpresaPage(section, false); return; }
    showNotFound(); return;
  }
  if (!document.getElementById('detail-page').classList.contains('page-hidden')) {
    goBackToMain();
  }
  // Volver a "/" con el botón atrás desde una subpágina de Empresa
  if (path === '/' && !document.getElementById('empresa-page').classList.contains('hidden')) {
    hideEmpresaPage(false);
  }
  // Volver a "/" con el botón atrás desde el Dashboard — faltaba este
  // caso (bug real encontrado en auditoría): a diferencia de detail-page
  // y empresa-page, nada comprobaba si dashboard-page seguía visible al
  // navegar con "atrás", dejándolo abierto con la URL ya en "/".
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
    img.src = cldOptimize(typeof item.src === 'string' ? item.src : item.src, 1000);
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
    const imgSrc = sv.media && sv.media.length > 0
      ? (typeof sv.media[0] === 'string' ? sv.media[0] : (sv.media[0].src || sv.img || ''))
      : (sv.img || 'https://placehold.co/300x176/1e293b/38bdf8?text=Auto');
    const svIsFav = isFavorite(sv.id);
    const card = document.createElement('a');
    card.href = getVehiclePath(sv);
    card.className = 'similar-card rounded-xl overflow-hidden cursor-pointer block';
    card.style.cssText = 'background:rgb(30,41,59);border:1px solid rgba(255,255,255,0.07);transition:transform 0.18s,box-shadow 0.18s;';
    card.innerHTML = `
      <div style="height:120px;overflow:hidden;position:relative;">
        <img src="${escapeAttr(cldOptimize(imgSrc, 400))}" alt="${escapeAttr(sv.name)}"
          style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s;"
          onerror="this.src='https://placehold.co/300x120/1e293b/38bdf8?text=Auto'">
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
    card.addEventListener('click', (e) => { e.preventDefault(); window.scrollTo(0,0); openDetail(sv.id); });
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
  lucide.createIcons();
}
document.getElementById('gallery-prev').addEventListener('click', () => {
  galleryIdx = (galleryIdx - 1 + galleryMedia.length) % galleryMedia.length;
  renderGalleryMedia();
});
document.getElementById('gallery-next').addEventListener('click', () => {
  galleryIdx = (galleryIdx + 1) % galleryMedia.length;
  renderGalleryMedia();
});
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
  if (item.type === 'video') {
    lbImg.classList.add('hidden'); lbVid.classList.remove('hidden'); lbVid.src = item.src;
  } else {
    lbVid.classList.add('hidden'); lbImg.classList.remove('hidden'); lbImg.src = item.src;
  }
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  const lb = document.getElementById('lightbox');
  const lbVid = document.getElementById('lightbox-video');
  if (lb) lb.classList.remove('open');
  if (lbVid) { try { lbVid.pause(); lbVid.src = ''; } catch(e){} }
  document.body.style.overflow = '';
}
document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
document.getElementById('lightbox')?.addEventListener('click', e => { if (e.target === document.getElementById('lightbox')) closeLightbox(); });
document.getElementById('lightbox-prev')?.addEventListener('click', e => { e.stopPropagation(); openLightbox((galleryIdx - 1 + galleryMedia.length) % galleryMedia.length); });
document.getElementById('lightbox-next')?.addEventListener('click', e => { e.stopPropagation(); openLightbox((galleryIdx + 1) % galleryMedia.length); });
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
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    Object.keys(pageState).forEach(cat => { pageState[cat] = 1; });
    renderSections();
    lucide.createIcons();
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
  lucide.createIcons();
}
document.getElementById('not-found-back-btn')?.addEventListener('click', () => {
  try { if (window.self === window.top) history.pushState(null, '', '/'); } catch(e) {}
  document.getElementById('not-found-page')?.classList.add('page-hidden');
  document.getElementById('main-page').classList.remove('page-hidden');
  resetSeoToDefault();
});
document.getElementById('back-btn').addEventListener('click', () => {
  try {
    if (window.self === window.top) history.back();
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
  document.getElementById('delete-modal').classList.remove('hidden');
}
document.getElementById('detail-delete-btn').addEventListener('click', () => {
  if (!currentVehicleId) return;
  requestVehicleDelete(currentVehicleId, 'detail');
});
document.getElementById('delete-cancel-btn').addEventListener('click', () => {
  document.getElementById('delete-modal').classList.add('hidden');
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

    document.getElementById('delete-modal').classList.add('hidden');
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
  pendingFiles = [];
  document.getElementById('img-preview').innerHTML = '';
  if (vehicle) {
    title.textContent = 'Editar Vehículo';
    document.getElementById('pub-edit-id').value = vehicle.id;
    document.getElementById('pub-name').value = vehicle.name || '';
    document.getElementById('pub-price').value = (vehicle.currency === 'USD' && vehicle.priceUSD)
      ? vehicle.priceUSD
      : (vehicle.price || '');
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
  modal.classList.remove('hidden');
  populateYears('pub-year');
  if (vehicle) document.getElementById('pub-year').value = vehicle.year || '';
}
// ============================================================
// CLOUDINARY CONFIG — subida firmada vía Cloudflare Worker
// ============================================================
// El API Secret de Cloudinary YA NO vive aquí. Este Worker de Cloudflare
// calcula la firma en su propio servidor (donde guarda el secreto como
// variable de entorno tipo "Secret") y solo nos devuelve la firma ya
// calculada — así nadie puede subir archivos a nuestra cuenta de
// Cloudinary sin pasar primero por nuestra lógica de negocio.
const CLOUDINARY_SIGN_URL = 'https://labatalla-cloudinary-sign.chileacuentawarzone1516.workers.dev';

// Sube un archivo a Cloudinary usando firma generada en el Worker.
async function uploadToCloudinary(file) {
  const { user } = getCurrentUser();
  if (!canManageVehicles() || !user) {
    throw new Error('Debes iniciar sesión con un rol autorizado para subir archivos.');
  }
  const idToken = await user.getIdToken();

  // 1. Pedir la firma al Worker (timestamp + signature + apiKey + cloudName)
  const signRes = await fetch(CLOUDINARY_SIGN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({ folder: 'labatalla' })
  });
  if (signRes.status === 401 || signRes.status === 403) {
    throw new Error('No autorizado para subir archivos.');
  }
  if (!signRes.ok) throw new Error('No se pudo firmar la subida');
  const { signature, timestamp, apiKey, cloudName, folder } = await signRes.json();

  // 2. Subir el archivo con la firma — Cloudinary rechaza cualquier
  // request cuya firma no coincida exactamente con estos parámetros.
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);
  formData.append('folder', folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) throw new Error('Cloudinary upload failed');
  const data = await res.json();
  return { url: data.secure_url, type: file.type.startsWith('video') ? 'video' : 'image' };
}

// Fase 1 — foto de perfil: mismo flujo firmado y seguro que las
// imágenes de vehículos, pero con purpose:'profile'. El Worker exige
// solo status:active (no role admin/editor) y fuerza folder/public_id
// propios del uid verificado — un usuario nunca puede escribir en la
// carpeta de vehículos ni en la foto de otro usuario.
async function uploadProfilePhoto(file) {
  const { user } = getCurrentUser();
  if (!user) throw new Error('Debes iniciar sesión para subir una foto.');
  if (!file.type.startsWith('image/')) throw new Error('El archivo debe ser una imagen.');
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen no puede superar 5 MB.');

  const idToken = await user.getIdToken();
  const signRes = await fetch(CLOUDINARY_SIGN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
    body: JSON.stringify({ purpose: 'profile' }),
  });
  if (signRes.status === 401 || signRes.status === 403) {
    throw new Error('No autorizado para subir tu foto — tu cuenta debe estar activa.');
  }
  if (!signRes.ok) throw new Error('No se pudo firmar la subida de la foto');
  const { signature, timestamp, apiKey, cloudName, folder, publicId, overwrite } = await signRes.json();

  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', apiKey);
  formData.append('timestamp', timestamp);
  formData.append('signature', signature);
  formData.append('folder', folder);
  formData.append('public_id', publicId);
  formData.append('overwrite', String(overwrite));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('No se pudo subir la foto a Cloudinary');
  const data = await res.json();
  return data.secure_url;
}
// ————— Preview local mientras suben —————
let pendingFiles = []; // archivos originales para subir a Cloudinary
const MAX_IMAGES = 10;
function updateImgLabel() {
  const labelText = document.getElementById('pub-images-label-text');
  const input = document.getElementById('pub-images');
  const labelEl = document.getElementById('pub-images-label');
  if (!labelText) return;
  const remaining = MAX_IMAGES - pendingFiles.length;
  if (remaining <= 0) {
    labelText.textContent = '✅ Máximo de 10 fotos/videos alcanzado';
    if (input) input.disabled = true;
    if (labelEl) { labelEl.style.opacity = '0.5'; labelEl.style.pointerEvents = 'none'; }
  } else {
    labelText.textContent = `Seleccionar fotos o videos (${pendingFiles.length}/10 — quedan ${remaining})`;
    if (input) input.disabled = false;
    if (labelEl) { labelEl.style.opacity = '1'; labelEl.style.pointerEvents = 'auto'; }
  }
}
// Límites de tamaño — evita subidas gigantes que traben el flujo o llenen la cuota de Cloudinary
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 50;
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
  files = files.filter(file => {
    const isVideo = file.type.startsWith('video');
    const limitMB = isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB;
    const okSize = file.size <= limitMB * 1024 * 1024;
    if (!okSize) rejected.push(file.name);
    return okSize;
  });
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
    } else {
      wrap.innerHTML = `<img src="${escapeAttr(src)}" class="w-full h-20 object-cover rounded-lg border-2 ${border}" alt="preview"
        onerror="this.src='https://placehold.co/80x80/1e293b/38bdf8?text=?'">
        ${portadaBadge}
        <button class="remove-img" data-idx="${i}">✕</button>`;
    }
    container.appendChild(wrap);
  });
  container.querySelectorAll('.remove-img').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (pendingFiles[idx].localUrl && !pendingFiles[idx].cloudUrl) {
        URL.revokeObjectURL(pendingFiles[idx].localUrl);
      }
      pendingFiles.splice(idx, 1);
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
  const priceRaw = parseFloat(document.getElementById('pub-price').value);
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
  return { valid: true };
}

// Sube las fotos pendientes o reutiliza las existentes al editar sin
// fotos nuevas. Lanza si alguna subida falla — el llamador decide qué hacer.
async function resolvePublishMedia(editId, onProgress) {
  if (pendingFiles.length > 0) {
    const media = [];
    for (let i = 0; i < pendingFiles.length; i++) {
      const item = pendingFiles[i];
      onProgress?.(i + 1, pendingFiles.length);
      if (!item.cloudUrl) {
        const result = await uploadToCloudinary(item.file);
        item.cloudUrl = result.url;
        item.type = result.type;
      }
      media.push({ type: item.type, src: item.cloudUrl });
    }
    return media;
  }
  if (editId) {
    const existing = vehicles.find(v => v.id === editId);
    return existing?.media || [];
  }
  return [];
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
      media = await resolvePublishMedia(form.editId, (i, total) => {
        const label = btn.querySelector('.btn-label') || btn;
        label.textContent = `⏳ Subiendo foto ${i} de ${total}...`;
      });
    } catch (e) {
      console.error('Error subiendo a Cloudinary:', e);
      if (token === currentSaveToken) showToast('❌ Error subiendo fotos — intenta de nuevo');
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
  document.getElementById('publish-modal').classList.add('hidden');
  pendingFiles.forEach(f => URL.revokeObjectURL(f.localUrl));
  pendingFiles = [];
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
    const card = document.createElement('div');
    card.className = 'brand-logo-card';
    card.dataset.brand = brand;
    if (meta.slug) {
      card.innerHTML = `
        <img src="https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/${meta.slug}.svg" alt="Logo ${escapeAttr(brand)}"
          onerror="this.outerHTML='<div style=\\'width:36px;height:36px;border-radius:9px;background:${meta.color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;\\'>${escapeHtml(meta.initial)}</div>'">
        <span class="brand-name">${escapeHtml(brand)}</span>
        <span class="brand-count">${count} ${count === 1 ? 'auto' : 'autos'}</span>`;
    } else {
      card.innerHTML = `
        <div style="width:36px;height:36px;border-radius:9px;background:${meta.color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:14px;">${escapeHtml(meta.initial)}</div>
        <span class="brand-name">${escapeHtml(brand)}</span>
        <span class="brand-count">${count} ${count === 1 ? 'auto' : 'autos'}</span>`;
    }
    card.addEventListener('click', () => {
      const isActive = card.classList.contains('active');
      document.querySelectorAll('.brand-logo-card').forEach(c => c.classList.remove('active'));
      if (isActive) {
        // Deselect — clear filter
        document.getElementById('filter-results').classList.add('hidden');
        document.getElementById('brand-clear-btn').classList.add('hidden');
      } else {
        card.classList.add('active');
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
      btn.addEventListener('click', (e) => { e.preventDefault(); openDetail(btn.dataset.id); });
    });
    lucide.createIcons();
  }
  section.scrollIntoView({ behavior:'smooth', block:'start' });
}
document.getElementById('brand-clear-btn')?.addEventListener('click', () => {
  document.querySelectorAll('.brand-logo-card').forEach(c => c.classList.remove('active'));
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
function createSearchDropdown({ inputId, hiddenId, dropdownId, displayId, options, emptyText, allowEmptyFilter = true }) {
  const searchInput = document.getElementById(inputId);
  const hiddenInput = document.getElementById(hiddenId);
  const dropdown = document.getElementById(dropdownId);
  const display = document.getElementById(displayId);
  if (!searchInput) return;
  function renderDropdown(filter) {
    const f = (filter || '').toLowerCase();
    const filtered = (!f && !allowEmptyFilter) ? [] :
      (f ? options.filter(o => o.toLowerCase().includes(f)) : options);
    dropdown.innerHTML = '';
    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="px-3 py-2 text-slate-400 text-sm">${emptyText}</div>`;
    } else {
      filtered.forEach(value => {
        const item = document.createElement('div');
        item.className = 'px-3 py-2 text-white text-sm cursor-pointer hover:bg-slate-700 transition';
        item.textContent = value;
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          hiddenInput.value = value;
          searchInput.value = value;
          display.textContent = '✓ ' + value;
          display.classList.remove('hidden');
          dropdown.classList.add('hidden');
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }
  searchInput.addEventListener('input', () => {
    hiddenInput.value = '';
    display.classList.add('hidden');
    renderDropdown(searchInput.value);
  });
  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  searchInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
  menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
}

// ============================================================
// SUBPÁGINAS DE EMPRESA — SPA routing con URLs reales (/empresa/slug).
// Cada opción del menú Empresa abre la vista institucional dentro de
// index.html y hace scroll a su sección, con historial navegable.
// ============================================================
const EMPRESA_SECTIONS = ['por-que-elegirnos', 'quienes-somos', 'mision-vision', 'nuestros-valores'];

// Metadatos SEO propios por sub-página de Empresa — sin esto, las 4 rutas
// /empresa/* comparten el <title>/description/canonical genéricos de la
// home, lo que Google puede interpretar como contenido duplicado.
const EMPRESA_META = {
  'por-que-elegirnos': {
    title: '¿Por qué elegirnos? | La Batalla Auto Import',
    description: 'Vehículos verificados, financiamiento a tu medida y atención personalizada. Descubre por qué comprar en La Batalla Auto Import.'
  },
  'quienes-somos': {
    title: 'Quiénes somos | La Batalla Auto Import',
    description: 'Conoce a La Batalla Auto Import: concesionario dominicano de sedanes, SUVs y camionetas en Santo Domingo, San Francisco de Macorís y Nagua.'
  },
  'mision-vision': {
    title: 'Misión y Visión | La Batalla Auto Import',
    description: 'La misión y visión de La Batalla Auto Import como concesionario de vehículos nuevos, usados e importados en República Dominicana.'
  },
  'nuestros-valores': {
    title: 'Nuestros Valores | La Batalla Auto Import',
    description: 'Honestidad, transparencia, calidad y compromiso: los valores que guían cada venta en La Batalla Auto Import.'
  }
};

// Metadatos por defecto de la home — se restauran al salir de /empresa/*.
const DEFAULT_META = {
  title: 'La Batalla Auto Import | Sedanes, SUVs y Camionetas en República Dominicana',
  description: 'Compra tu próximo vehículo en La Batalla Auto Import. Sedanes, SUVs y camionetas nuevas, usadas e importadas en Santo Domingo, San Francisco de Macorís y Nagua. Financiamiento disponible.',
  canonical: 'https://labatallaautoimport.netlify.app/'
};

function setPageMeta({ title, description, canonical }) {
  if (title) document.title = title;
  const descTag = document.querySelector('meta[name="description"]');
  if (descTag && description) descTag.setAttribute('content', description);
  const canonicalTag = document.querySelector('link[rel="canonical"]');
  if (canonicalTag && canonical) canonicalTag.setAttribute('href', canonical);
}

// FAQPage structured data — se inyecta SOLO mientras el usuario está en
// /empresa/*, porque el bloque de preguntas frecuentes vive únicamente en
// esa vista. Insertarlo de forma estática en el <head> lo expondría también
// en la home y en cada ficha de vehículo, sin relación con ese contenido.
const FAQ_JSONLD_ID = 'faq-jsonld';
const FAQ_ENTRIES = [
  ['¿Los vehículos son nuevos, usados o importados?', 'Manejamos las tres opciones. Cada ficha indica claramente la condición del vehículo para que decidas con información completa.'],
  ['¿Puedo financiar aunque no tenga historial crediticio extenso?', 'Trabajamos con varias instituciones financieras, cada una con criterios distintos. Un asesor revisa tu caso y te dice qué opciones aplican, sin compromiso.'],
  ['¿Qué pasa si tengo un problema después de comprar?', 'Nuestro acompañamiento no termina con la entrega. Contáctanos por WhatsApp y te orientamos sobre los siguientes pasos.'],
  ['¿Atienden fuera de Santo Domingo?', 'Sí, tenemos presencia en Santo Domingo, San Francisco de Macorís y Nagua. Escríbenos y coordinamos según tu ubicación.'],
  ['¿Cuánto tiempo toma todo el proceso?', 'Depende de la aprobación de la institución financiera, pero la simulación y la solicitud inicial toman solo minutos.']
];

function injectFaqSchema() {
  if (document.getElementById(FAQ_JSONLD_ID)) return;
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = FAQ_JSONLD_ID;
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ENTRIES.map(([q, a]) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a }
    }))
  });
  document.head.appendChild(script);
}

function removeFaqSchema() {
  document.getElementById(FAQ_JSONLD_ID)?.remove();
}

function showEmpresaPage(sectionId, push = true) {
  const empresa = document.getElementById('empresa-page');
  const catalog = document.getElementById('catalog-view');
  if (!empresa || !catalog) return;
  // Asegurar que estamos en la vista principal (no ficha ni 404)
  document.getElementById('detail-page')?.classList.add('page-hidden');
  document.getElementById('not-found-page')?.classList.add('page-hidden');
  document.getElementById('main-page')?.classList.remove('page-hidden');
  catalog.classList.add('hidden');
  empresa.classList.remove('hidden');
  try {
    if (push && window.self === window.top && window.location.pathname !== `/empresa/${sectionId}`) {
      history.pushState({ empresa: sectionId }, '', `/empresa/${sectionId}`);
    }
  } catch (e) { /* iframe/sandbox — ignorar */ }
  const meta = EMPRESA_META[sectionId];
  setPageMeta({
    title: meta ? meta.title : 'Empresa | La Batalla Auto Import',
    description: meta ? meta.description : DEFAULT_META.description,
    canonical: `https://labatallaautoimport.netlify.app/empresa/${sectionId}`
  });
  injectFaqSchema();
  lucide.createIcons();
  // Scroll a la sección una vez visible
  requestAnimationFrame(() => {
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo(0, 0);
  });
}

function hideEmpresaPage(push = true) {
  const empresa = document.getElementById('empresa-page');
  const catalog = document.getElementById('catalog-view');
  if (!empresa || !catalog) return;
  empresa.classList.add('hidden');
  catalog.classList.remove('hidden');
  try {
    if (push && window.self === window.top && /^\/empresa\//.test(window.location.pathname)) {
      history.pushState(null, '', '/');
    }
  } catch (e) {}
  setPageMeta(DEFAULT_META);
  removeFaqSchema();
  window.scrollTo(0, 0);
  lucide.createIcons();
}

function initEmpresaRouting() {
  // Interceptar los enlaces del dropdown que apuntan a /empresa/*
  document.querySelectorAll('#nav-empresa-menu [data-nav-target]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      showEmpresaPage(a.dataset.navTarget);
    });
  });
  document.getElementById('empresa-back-btn')?.addEventListener('click', () => hideEmpresaPage(true));
  // Si el usuario está en una subpágina de Empresa y hace clic en una
  // categoría del nav (#sedanes, #suvs, #pickups), volvemos al catálogo
  // primero para que el ancla apunte a contenido visible.
  document.querySelectorAll('a.nav-cat-link[href^="#"]').forEach(a => {
    a.addEventListener('click', () => {
      if (!document.getElementById('empresa-page').classList.contains('hidden')) hideEmpresaPage(true);
    });
  });
}

// ============================================================
// SCROLL SPY — resalta en el dropdown Empresa la sección del bloque
// institucional que el usuario está viendo en ese momento
// ============================================================
function initScrollSpy() {
  const targets = ['por-que-elegirnos', 'quienes-somos', 'mision-vision', 'nuestros-valores'];
  const sections = targets.map(id => document.getElementById(id)).filter(Boolean);
  const navItems = Array.from(document.querySelectorAll('#nav-empresa-menu [data-nav-target]'));
  if (!sections.length || !navItems.length || !('IntersectionObserver' in window)) return;

  function setActive(id) {
    navItems.forEach(item => {
      const isActive = item.dataset.navTarget === id;
      item.classList.toggle('is-active', isActive);
      if (isActive) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
  }
  const io = new IntersectionObserver(entries => {
    const visible = entries.filter(en => en.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (visible.length) setActive(visible[0].target.id);
  }, { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
  sections.forEach(s => io.observe(s));
}

// ============================================================
// INIT
// ============================================================
// ============================================================
// FAB DE STARBLEX IA 1.0 — asistente automotriz accesible desde
// cualquier pantalla del sitio. Reemplaza al antiguo FAB de WhatsApp
// ("Escríbenos"). El chat en sí (starblex-chat.js) se inicializa bajo
// demanda: este botón solo se muestra/oculta y delega la apertura.
// ============================================================
function initFabStarblex() {
  const fab = document.getElementById('fab-starblex-btn');
  if (!fab) return;
  fab.addEventListener('click', () => {
    window.LB_STARBLEX?.open();
  });
  const hero = document.querySelector('header.relative.h-\\[70vh\\]');
  if (!hero || !('IntersectionObserver' in window)) { fab.classList.remove('hidden'); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => fab.classList.toggle('hidden', entry.isIntersecting));
  }, { threshold: 0.15 });
  io.observe(hero);
}

window.addEventListener('DOMContentLoaded', () => {
  updateAdminUI();
  populateYears('pub-year');
  initBrandSearch();
  initColorSearch();
  initCalcModalA11y();
  initFabCalc();
  initFabStarblex();
  initNavEmpresa();
  initEmpresaRouting();
  initScrollSpy();
  updateNavFavCount();
  lucide.createIcons();
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
    // Esperar a que los vehículos carguen de Firebase antes de buscar el slug
    const tryOpen = (attempts = 0) => {
      const v = findVehicleBySlug(slug);
      if (v) {
        openDetail(v.id);
      } else if (attempts < 20) {
        setTimeout(() => tryOpen(attempts + 1), 500);
      } else {
        // Vehículo no encontrado tras esperar 10s — mostrar 404 real
        // en vez de dejar al usuario esperando indefinidamente.
        console.warn('Vehículo no encontrado para el slug:', slug);
        showNotFound();
      }
    };
    setTimeout(() => tryOpen(0), 800);
  }
  checkPathVehicle();
  // Entrada directa a una subpágina de Empresa (/empresa/quienes-somos, etc.)
  const empInit = window.location.pathname.match(/^\/empresa\/([^\/]+)\/?$/);
  if (empInit) {
    const section = decodeURIComponent(empInit[1]);
    if (EMPRESA_SECTIONS.includes(section)) showEmpresaPage(section, false);
    else showNotFound();
  }
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
