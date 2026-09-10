// ============================================================
// VEHICLE-OG.JS — Netlify Edge Function
// Dynamic Open Graph/Twitter metadata for /vehiculos/:slug
// and a real 404 when the requested vehicle does not exist.
//
// IMPORTANT:
// - Public inventory is read from Firestore REST; no privileged
//   credential is used here.
// - The browser SPA remains the source of the visible UI.
// - This function exists primarily for direct URLs + social bots.
// ============================================================

export const config = { path: '/vehiculos/*' };

const SITE_URL = 'https://labatallaautoimport.netlify.app';
const FIRESTORE_PROJECT_ID =
  Deno.env.get('FIREBASE_PROJECT_ID') || 'la-batalla-auto-import';
const FIREBASE_WEB_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || '';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;
const CACHE_TTL_MS = 60_000;

let vehicleCache = { data: null, fetchedAt: 0 };

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function firestoreValueToJs(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number.parseInt(value.integerValue, 10);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(firestoreValueToJs);
  }
  if ('mapValue' in value) return firestoreFieldsToJs(value.mapValue.fields || {});
  return null;
}

function firestoreFieldsToJs(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    out[key] = firestoreValueToJs(value);
  }
  return out;
}

function normalizeVehicle(raw, id) {
  if (!raw || typeof raw !== 'object' || !raw.name) return null;
  const media = Array.isArray(raw.media)
    ? raw.media
        .map((item) => typeof item === 'string' ? item : item?.src)
        .filter(Boolean)
    : [];

  return {
    id: String(id || raw.id || ''),
    slug: typeof raw.slug === 'string' && raw.slug.trim() ? raw.slug.trim() : '',
    name: String(raw.name).trim(),
    brand: typeof raw.brand === 'string' ? raw.brand.trim() : '',
    // El formulario de publicación guarda `year` como STRING (el value de
    // un <select>), así que los 37 vehículos reales lo tienen como texto y
    // Number.isFinite() lo descartaba: la descripción social perdía el año
    // en toda ficha cuyo nombre no lo incluyera ya. Se normaliza igual que
    // `mileage`, aceptando número o cadena y descartando solo lo vacío.
    year: (() => {
      const y = typeof raw.year === 'number' ? raw.year : String(raw.year ?? '').trim();
      return y === '' || y == null ? null : y;
    })(),
    price: Number.isFinite(raw.price) ? raw.price : null,
    priceDisplay: typeof raw.priceDisplay === 'string' ? raw.priceDisplay.trim() : '',
    condition: typeof raw.condition === 'string' ? raw.condition.trim() : '',
    mileage: raw.mileage == null ? '' : String(raw.mileage),
    color: typeof raw.color === 'string' ? raw.color.trim() : '',
    transmission: typeof raw.transmission === 'string' ? raw.transmission.trim() : '',
    img: typeof raw.img === 'string' ? raw.img.trim() : '',
    media: media.slice(0, 12),
  };
}

function computedSlug(vehicle, allVehicles) {
  if (vehicle.slug) return vehicle.slug;
  const base = slugify(vehicle.name);
  const collision = allVehicles.some(
    (other) => other.id !== vehicle.id && slugify(other.name) === base,
  );
  return collision ? `${base}-${vehicle.id.slice(-5)}` : base;
}

async function fetchAllVehicles() {
  const now = Date.now();
  if (Array.isArray(vehicleCache.data) && now - vehicleCache.fetchedAt < CACHE_TTL_MS) {
    return vehicleCache.data;
  }

  const vehicles = [];
  let pageToken = '';

  try {
    do {
      const params = new URLSearchParams({ pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      if (FIREBASE_WEB_API_KEY) params.set('key', FIREBASE_WEB_API_KEY);

      const response = await fetch(`${FIRESTORE_BASE}/vehicles?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.error('vehicle-og: Firestore HTTP', response.status);
        return Array.isArray(vehicleCache.data) ? vehicleCache.data : [];
      }

      const body = await response.json();
      for (const doc of body.documents || []) {
        const id = String(doc.name || '').split('/').pop();
        const plain = firestoreFieldsToJs(doc.fields || {});
        const vehicle = normalizeVehicle(plain, id);
        if (vehicle) vehicles.push(vehicle);
      }
      pageToken = body.nextPageToken || '';
    } while (pageToken);

    vehicleCache = { data: vehicles, fetchedAt: now };
    return vehicles;
  } catch (error) {
    console.error('vehicle-og: Firestore fetch failed', error);
    return Array.isArray(vehicleCache.data) ? vehicleCache.data : [];
  }
}

// Inserta f_auto,q_auto en las URLs de Cloudinary — misma transformación que
// aplica app.js (cldOptimize) al og:image del lado del cliente. El comentario
// de app.js afirmaba usar "el mismo criterio que la Edge Function", pero aquí
// no se aplicaba ninguna: se publicaba el original tal cual.
//
// No es cosmético. El inventario real ya tiene una imagen .avif, y las fotos
// subidas desde un iPhone llegan a Cloudinary como .heic. Ni WhatsApp ni
// Facebook renderizan AVIF o HEIC en las tarjetas de enlace: la vista previa
// salía en blanco. Con f_auto, Cloudinary sirve JPEG/PNG a esos rastreadores.
function cldOptimize(url, width, height) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const size = height ? `c_fill,w_${width},h_${height}` : `c_fill,w_${width}`;
  return url.replace('/upload/', `/upload/f_auto,q_auto,${size}/`);
}

// Medidas del og:image. Se declaran SOLO cuando se conocen de verdad:
//   - Cloudinary: las fija la propia transformación. `c_fill` recorta a las
//     dos dimensiones dadas, así que la imagen sale exactamente a
//     1200x630 — la proporción 1.91:1 que piden Facebook y WhatsApp.
//   - og-cover.jpg: es un archivo del repositorio, 1200x630 medidos.
//   - Cualquier otro origen (las fotos de Pexels del catálogo base): no se
//     conocen, y no se inventan.
//
// ⚠️ DEFECTO CORREGIDO (cierre de release). Antes se declaraba 1200x1200
// para TODAS las fichas. No era cierto en ninguna: `c_fill,w_1200` sin
// altura conserva la proporción original (nunca sale cuadrada), y las
// fotos de Pexels ni siquiera pasan por Cloudinary — llegan a 800px de
// ancho. Facebook usa estos valores para reservar el hueco de la tarjeta
// antes de descargar la imagen, así que la vista previa se maquetaba con
// una proporción que no correspondía a la foto. Comprobado ejecutando esta
// misma función contra el Firestore real de producción.
const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
// Imagen de marca de respaldo. Antes era /preview.jpg (1204x644), que
// llevaba incrustado el emblema ANTIGUO: un vehículo sin fotos compartía
// el logo viejo. Ahora es el mismo archivo que declara index.html, así que
// la identidad al compartir es una sola en todo el sitio.
const FALLBACK_IMAGE = `${SITE_URL}/og-cover.jpg`;
const FALLBACK_WIDTH = 1200;
const FALLBACK_HEIGHT = 630;

function pickImage(vehicle) {
  // `normalizeVehicle` ya deja `media` como array de cadenas, pero el
  // acceso directo a media[0] daba `undefined` en un vehículo sin fotos y
  // dependía de que esa normalización nunca cambiara. Se comprueba aquí.
  const first = Array.isArray(vehicle.media) && vehicle.media.length > 0 ? vehicle.media[0] : '';
  const candidate = (typeof first === 'string' && first) ? first
    : (typeof vehicle.img === 'string' && vehicle.img ? vehicle.img : FALLBACK_IMAGE);
  if (!/^https?:\/\//i.test(candidate)) {
    return { url: FALLBACK_IMAGE, width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT, type: 'image/jpeg' };
  }
  const optimized = cldOptimize(candidate, OG_IMAGE_WIDTH, OG_IMAGE_HEIGHT);
  if (optimized !== candidate) {
    // f_auto negocia el formato con el rastreador (JPEG, PNG o WebP según
    // lo que acepte), así que declarar un og:image:type fijo sería mentir.
    return { url: optimized, width: OG_IMAGE_WIDTH, height: OG_IMAGE_HEIGHT, type: null };
  }
  if (candidate === FALLBACK_IMAGE) {
    return { url: candidate, width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT, type: 'image/jpeg' };
  }
  return { url: candidate, width: null, height: null, type: null };
}

function formatPrice(vehicle) {
  if (vehicle.priceDisplay) return vehicle.priceDisplay;
  if (Number.isFinite(vehicle.price)) {
    return `RD$ ${vehicle.price.toLocaleString('es-DO')}`;
  }
  return 'Precio a consultar';
}

function isLikelyBot(request) {
  const ua = request.headers.get('user-agent') || '';
  return /(bot|crawler|spider|facebookexternalhit|facebot|twitterbot|linkedinbot|whatsapp|slackbot|telegrambot|discordbot|google-inspectiontool)/i.test(ua);
}

function buildMeta(vehicle, requestedSlug) {
  const canonical = `${SITE_URL}/vehiculos/${encodeURIComponent(requestedSlug)}`;
  const title = `${vehicle.name} — ${formatPrice(vehicle)} | La Batalla Auto Import`;
  // El año se añade solo si el nombre no lo lleva ya: de los 37 vehículos
  // reales, 33 lo incluyen en el propio nombre ("RAM 1500 Rebel 2024") y
  // repetirlo daba "RAM 1500 Rebel 2024 2024".
  const yearSuffix = vehicle.year && !String(vehicle.name).includes(String(vehicle.year))
    ? ` ${vehicle.year}` : '';
  const description = [
    `${vehicle.name}${yearSuffix}`,
    vehicle.condition ? `· ${vehicle.condition}` : '',
    vehicle.mileage ? `· ${vehicle.mileage} km` : '',
    vehicle.transmission ? `· ${vehicle.transmission}` : '',
    '· La Batalla Auto Import',
  ].filter(Boolean).join(' ');
  const image = pickImage(vehicle);

  return {
    canonical, title, description,
    image: image.url,
    imageWidth: image.width,
    imageHeight: image.height,
    imageType: image.type,
    imageAlt: `${vehicle.name} en La Batalla Auto Import`,
  };
}

function injectMeta(html, meta) {
  const replacements = [
    [/<title>[^<]*<\/title>/i, `<title>${htmlEscape(meta.title)}</title>`],
    [/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${htmlEscape(meta.description)}">`],
    [/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${htmlEscape(meta.canonical)}">`],
    [/<meta\s+property=["']og:title["'][^>]*>/i, `<meta property="og:title" content="${htmlEscape(meta.title)}">`],
    [/<meta\s+property=["']og:description["'][^>]*>/i, `<meta property="og:description" content="${htmlEscape(meta.description)}">`],
    [/<meta\s+property=["']og:url["'][^>]*>/i, `<meta property="og:url" content="${htmlEscape(meta.canonical)}">`],
    [/<meta\s+property=["']og:image["'][^>]*>/i, `<meta property="og:image" content="${htmlEscape(meta.image)}">`],
    // og:image:secure_url y og:image:alt NO se reescribían. Desde que
    // index.html los declara, un vehículo compartido habría mostrado la
    // portada genérica del sitio en vez de su foto: WhatsApp y Facebook
    // dan prioridad a secure_url cuando existe. Se inyectan siempre junto
    // a og:image para que las tres etiquetas describan la MISMA imagen.
    [/<meta\s+property=["']og:image:secure_url["'][^>]*>/i, `<meta property="og:image:secure_url" content="${htmlEscape(meta.image)}">`],
    [/<meta\s+property=["']og:image:alt["'][^>]*>/i, `<meta property="og:image:alt" content="${htmlEscape(meta.imageAlt)}">`],
    [/<meta\s+name=["']twitter:image:alt["'][^>]*>/i, `<meta name="twitter:image:alt" content="${htmlEscape(meta.imageAlt)}">`],
    // El tipo solo se declara cuando se conoce de verdad (la imagen de
    // marca). Con f_auto, Cloudinary sirve el formato que acepte cada
    // rastreador, así que la etiqueta se retira en vez de inventarla.
    [/<meta\s+property=["']og:image:type["'][^>]*>/i,
      meta.imageType ? `<meta property="og:image:type" content="${meta.imageType}">` : ''],
    [/<meta\s+name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${htmlEscape(meta.title)}">`],
    [/<meta\s+name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${htmlEscape(meta.description)}">`],
    [/<meta\s+name=["']twitter:image["'][^>]*>/i, `<meta name="twitter:image" content="${htmlEscape(meta.image)}">`],
    // og:image:width/height quedaban con las medidas de preview.jpg
    // (1204x644) aunque la imagen inyectada sea la foto del vehículo, que
    // tiene otra proporción. Facebook usa esos valores para reservar el
    // hueco de la tarjeta y recortaba mal la vista previa. Ahora se
    // declaran las medidas REALES de la imagen inyectada (ver pickImage);
    // cuando no se conocen, las dos etiquetas se retiran y es el propio
    // rastreador quien mide el archivo.
    [/<meta\s+property=["']og:image:width["'][^>]*>/i,
      meta.imageWidth ? `<meta property="og:image:width" content="${meta.imageWidth}">` : ''],
    [/<meta\s+property=["']og:image:height["'][^>]*>/i,
      meta.imageHeight ? `<meta property="og:image:height" content="${meta.imageHeight}">` : ''],
  ];

  let output = html;
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(output)) output = output.replace(pattern, replacement);
  }
  return output;
}

// Página 404 para un vehículo que ya no existe (enlace viejo de WhatsApp,
// vehículo vendido y retirado). La versión anterior devolvía HTML pelado:
// sin viewport, sin estilos, sin marca y —lo importante— SIN NINGÚN ENLACE
// de vuelta. Como el 404 se devuelve antes de distinguir bot de persona, un
// cliente real que tocaba un enlace caducado acababa en una página blanca
// sin salida. Ahora mantiene la marca y ofrece dos salidas claras.
function notFoundResponse() {
  const html = `<!doctype html><html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vehículo no encontrado | La Batalla Auto Import</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="${SITE_URL}/">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:rgb(15,23,42);color:#f1f5f9;font-family:'DM Sans',system-ui,-apple-system,sans-serif;padding:24px}
  .card{max-width:420px;text-align:center}
  h1{font-size:22px;font-weight:800;margin:0 0 10px}
  p{color:#94a3b8;font-size:14.5px;line-height:1.6;margin:0 0 24px}
  .actions{display:flex;flex-direction:column;gap:10px}
  a{display:block;padding:13px 22px;border-radius:12px;font-weight:800;font-size:14.5px;text-decoration:none;min-height:44px;line-height:1.3}
  .primary{background:#38bdf8;color:#042c53}
  .secondary{background:rgba(148,163,184,0.14);color:#cbd5e1;border:1px solid rgba(255,255,255,0.1)}
  a:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}
</style></head><body>
<div class="card">
  <div style="font-size:44px;line-height:1;margin-bottom:14px" aria-hidden="true">🚗</div>
  <h1>Este vehículo ya no está disponible</h1>
  <p>Puede que se haya vendido o que el enlace esté caducado. Mira el resto del inventario — recibimos vehículos nuevos cada semana.</p>
  <div class="actions">
    <a class="primary" href="${SITE_URL}/">Ver el catálogo completo</a>
    <a class="secondary" href="https://wa.me/18097759771?text=${encodeURIComponent('Hola, vi un vehículo en la web que ya no está disponible. ¿Tienen algo parecido?')}" rel="noopener noreferrer">Escribir por WhatsApp</a>
  </div>
</div></body></html>`;
  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60, must-revalidate',
    },
  });
}

export default async (request, context) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/vehiculos\/([^/]+)\/?$/);
  if (!match) return context.next();

  const requestedSlug = decodeURIComponent(match[1]);
  const vehicles = await fetchAllVehicles();
  const vehicle = vehicles.find((candidate) => computedSlug(candidate, vehicles) === requestedSlug);

  if (!vehicle) return notFoundResponse();

  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  // Browsers should receive the normal SPA document. Bots get the same
  // document with server-side metadata injected for link previews.
  if (!isLikelyBot(request)) return response;

  const html = await response.text();
  const meta = buildMeta(vehicle, requestedSlug);
  const body = injectMeta(html, meta);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  headers.set('cache-control', 'public, max-age=60, must-revalidate');

  return new Response(body, { status: response.status, headers });
};
