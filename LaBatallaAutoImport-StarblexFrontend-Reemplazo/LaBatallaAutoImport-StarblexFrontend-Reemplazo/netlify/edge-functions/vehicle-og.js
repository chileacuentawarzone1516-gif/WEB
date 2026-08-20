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
    year: Number.isFinite(raw.year) ? raw.year : null,
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

function pickImage(vehicle) {
  const candidate = vehicle.media[0] || vehicle.img || `${SITE_URL}/preview.jpg`;
  return /^https?:\/\//i.test(candidate) ? candidate : `${SITE_URL}/preview.jpg`;
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
  const description = [
    `${vehicle.name}${vehicle.year ? ` ${vehicle.year}` : ''}`,
    vehicle.condition ? `· ${vehicle.condition}` : '',
    vehicle.mileage ? `· ${vehicle.mileage} km` : '',
    vehicle.transmission ? `· ${vehicle.transmission}` : '',
    '· La Batalla Auto Import',
  ].filter(Boolean).join(' ');
  const image = pickImage(vehicle);

  return { canonical, title, description, image };
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
    [/<meta\s+name=["']twitter:title["'][^>]*>/i, `<meta name="twitter:title" content="${htmlEscape(meta.title)}">`],
    [/<meta\s+name=["']twitter:description["'][^>]*>/i, `<meta name="twitter:description" content="${htmlEscape(meta.description)}">`],
    [/<meta\s+name=["']twitter:image["'][^>]*>/i, `<meta name="twitter:image" content="${htmlEscape(meta.image)}">`],
  ];

  let output = html;
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(output)) output = output.replace(pattern, replacement);
  }
  return output;
}

function notFoundResponse() {
  return new Response('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vehículo no encontrado | La Batalla Auto Import</title></head><body><h1>Vehículo no encontrado</h1><p>La ficha solicitada no existe.</p></body></html>', {
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
