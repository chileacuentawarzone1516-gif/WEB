#!/usr/bin/env node
/**
 * Generate sitemap.xml from the public Firestore inventory.
 * Node 20+ only; uses native fetch and no external dependencies.
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const SITE_URL = (process.env.SITE_URL || 'https://labatallaautoimport.netlify.app').replace(/\/$/, '');
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'la-batalla-auto-import';
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || '';
const COLLECTION = 'vehicles';
const OUTPUT = path.resolve(process.cwd(), 'sitemap.xml');
const PAGE_SIZE = 1000;

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValueToJs);
  if ('mapValue' in value) return firestoreFieldsToJs(value.mapValue.fields || {});
  return null;
}

function firestoreFieldsToJs(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = firestoreValueToJs(value);
  return out;
}

function vehicleSlug(vehicle, allVehicles) {
  if (vehicle.slug) return vehicle.slug;
  const base = slugify(vehicle.name);
  const collision = allVehicles.some(
    (other) => other.id !== vehicle.id && slugify(other.name) === base,
  );
  return collision ? `${base}-${vehicle.id.slice(-5)}` : base;
}

function lastmodFor(vehicle) {
  const candidates = [vehicle.updatedAt, vehicle.createdAt];
  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

async function fetchVehicles() {
  const vehicles = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set('pageToken', pageToken);
    if (WEB_API_KEY) params.set('key', WEB_API_KEY);

    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(PROJECT_ID)}/databases/(default)/documents/${COLLECTION}?${params.toString()}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firestore HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const body = await response.json();
    for (const doc of body.documents || []) {
      const id = String(doc.name || '').split('/').pop();
      const data = firestoreFieldsToJs(doc.fields || {});
      if (!data.name) continue;
      vehicles.push({ ...data, id });
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);

  return vehicles;
}

// ============================================================
// A-4 — VALIDACIÓN ANTES DE ESCRIBIR
// ------------------------------------------------------------
// El sitemap comprometido en el repositorio llegó a anunciar 44 URLs
// cuando producción tenía 3 vehículos: 37 fichas borradas que la Edge
// Function responde con 404. Estas comprobaciones no habrían evitado
// aquello por sí solas (era un archivo viejo), pero sí garantizan que
// lo que este script escriba sea siempre un documento válido y
// coherente, y que un resultado absurdo falle en vez de publicarse.
// ============================================================
function validarSitemap(xml, totalUrls) {
  const problemas = [];
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) problemas.push('falta la declaración XML');
  if (!xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')) problemas.push('falta el urlset con su namespace');
  if (!xml.trimEnd().endsWith('</urlset>')) problemas.push('el documento no cierra en </urlset>');

  const aperturas = (xml.match(/<url>/g) || []).length;
  const cierres = (xml.match(/<\/url>/g) || []).length;
  if (aperturas !== cierres) problemas.push(`etiquetas <url> descompensadas (${aperturas} aperturas / ${cierres} cierres)`);
  if (aperturas !== totalUrls) problemas.push(`se esperaban ${totalUrls} URLs y hay ${aperturas}`);

  // Las páginas estáticas SIEMPRE deben estar, haya o no inventario. Si
  // alguna desaparece es que se rompió la generación, no que el negocio
  // se quedó sin vehículos.
  const obligatorias = [
    `${SITE_URL}/`,
    `${SITE_URL}/politica-privacidad.html`,
    `${SITE_URL}/terminos-y-condiciones.html`,
    `${SITE_URL}/empresa/por-que-elegirnos`,
    `${SITE_URL}/empresa/quienes-somos`,
    `${SITE_URL}/empresa/mision-vision`,
    `${SITE_URL}/empresa/nuestros-valores`,
  ];
  for (const u of obligatorias) {
    if (!xml.includes(`<loc>${u}</loc>`)) problemas.push(`falta la ruta estática ${u}`);
  }

  // Un & sin escapar es el error clásico que rompe el XML entero.
  const ampSueltos = (xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g) || []).length;
  if (ampSueltos > 0) problemas.push(`${ampSueltos} carácter(es) "&" sin escapar`);

  // El protocolo admite 50.000 URLs por archivo.
  if (aperturas > 50000) problemas.push(`${aperturas} URLs: por encima del límite de 50.000 del protocolo`);

  return problemas;
}

function urlEntry(loc, lastmod, changefreq, priority) {
  return [
    '  <url>',
    `    <loc>${xmlEscape(loc)}</loc>`,
    `    <lastmod>${xmlEscape(lastmod)}</lastmod>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ].join('\n');
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  let vehicles;
  try {
    vehicles = await fetchVehicles();
  } catch (error) {
    console.error('[sitemap] No se pudo consultar Firestore:', error.message);
    process.exitCode = 1;
    return;
  }

  const entries = [];
  entries.push(urlEntry(`${SITE_URL}/`, today, 'daily', '1.0'));
  entries.push(urlEntry(`${SITE_URL}/politica-privacidad.html`, today, 'yearly', '0.3'));
  entries.push(urlEntry(`${SITE_URL}/terminos-y-condiciones.html`, today, 'yearly', '0.3'));

  const empresa = [
    'por-que-elegirnos',
    'quienes-somos',
    'mision-vision',
    'nuestros-valores',
  ];
  for (const section of empresa) {
    entries.push(urlEntry(`${SITE_URL}/empresa/${section}`, today, 'monthly', '0.5'));
  }

  const seen = new Set();
  for (const vehicle of vehicles) {
    const slug = vehicleSlug(vehicle, vehicles);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    entries.push(urlEntry(
      `${SITE_URL}/vehiculos/${encodeURIComponent(slug)}`,
      lastmodFor(vehicle),
      'weekly',
      '0.8',
    ));
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries.join('\n'),
    '</urlset>',
    '',
  ].join('\n');

  // A-4: si el documento no es válido NO se escribe. Es preferible dejar
  // el sitemap anterior —que al menos es XML correcto— que publicar uno
  // roto, y el código de salida distinto de cero hace que el fallo se vea
  // en los registros en vez de pasar en silencio.
  const problemas = validarSitemap(xml, entries.length);
  if (problemas.length > 0) {
    console.error('[sitemap] XML inválido, no se escribe nada:');
    problemas.forEach(p => console.error('  - ' + p));
    process.exitCode = 1;
    return;
  }

  await fs.writeFile(OUTPUT, xml, 'utf8');
  const vehiculosEnSitemap = entries.length - 7; // 7 rutas estáticas fijas
  console.log(`[sitemap] Generado ${path.basename(OUTPUT)}: ${entries.length} URLs ` +
    `(7 estáticas + ${vehiculosEnSitemap} vehículos, de ${vehicles.length} leídos de Firestore).`);
  if (vehicles.length === 0) {
    // No es un error: el inventario puede estar vacío entre importaciones.
    // Se avisa porque un 0 inesperado suele significar que la consulta
    // falló silenciosamente, y conviene verlo en el registro del build.
    console.warn('[sitemap] Aviso: Firestore no devolvió ningún vehículo. ' +
      'El sitemap queda solo con las páginas estáticas.');
  }
}

main().catch((error) => {
  console.error('[sitemap] Error fatal:', error);
  process.exitCode = 1;
});
