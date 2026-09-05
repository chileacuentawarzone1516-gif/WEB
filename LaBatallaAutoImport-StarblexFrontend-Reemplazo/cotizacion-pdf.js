// ============================================================
// cotizacion-pdf.js — Documento PDF de cotización de financiamiento
// ------------------------------------------------------------
// Construye la cotización profesional de La Batalla Auto Import con
// el generador propio de pdf-core.js. Se carga BAJO DEMANDA desde
// calculadora.js (import dinámico) para no penalizar el arranque del
// sitio: quien nunca pide su cotización no descarga ni un byte.
//
// El módulo es puro respecto al DOM salvo por la carga del logo, y no
// depende de variables globales de app.js: todo lo que necesita entra
// por el objeto `datos`. Así puede reutilizarse tal cual desde el
// dashboard, un correo o cualquier otra vista futura.
// ============================================================
import { PDFDocument, loadImageAsJpeg } from './pdf-core.js';

// ------------------------------------------------------------
// Identidad visual — mismos tonos que el sitio (styles.css)
// ------------------------------------------------------------
const BRAND = {
  navy:     '#0F2038', // fondo de cabecera y banda destacada
  navySoft: '#1B3358',
  sky:      '#38BDF8',
  skyInk:   '#0369A1',
  ink:      '#0F172A',
  body:     '#334155',
  muted:    '#64748B',
  hair:     '#E3EBF4',
  panel:    '#F3F8FD',
  zebra:    '#F8FAFC',
  noteBg:   '#FFF8E8',
  noteEdge: '#EFD9A6',
  noteInk:  '#8A6410',
  white:    '#FFFFFF',
};

const EMPRESA = {
  nombre: 'LA BATALLA AUTO IMPORT',
  tagline: 'Importaciones Premium de Vehículos',
  telefono: '(809) 775-9771',
  instagram: '@jmsanchez1015',
  sitio: 'labatallaautoimport.netlify.app',
  logo: '/logo-labatalla.png',
};

// El logotipo del sitio lleva el nombre de la empresa incrustado bajo el
// emblema; a tamaño de membrete ese texto resulta ilegible y compite con
// el nombre en tipografía real. Se recorta solo el emblema (fracciones
// medidas sobre logo-labatalla.png). Si se sustituye el archivo del logo,
// basta con reajustar estos cuatro valores.
const LOGO_CROP = { x: 0.145, y: 0.135, w: 0.715, h: 0.545 };
const LOGO_BOX = { w: 78, h: 59 };

// Márgenes y retícula del documento (A4, en puntos)
const PAGE = { w: 595.28, h: 841.89 };
const M = { left: 42, right: 42 };
const CONTENT_W = PAGE.w - M.left - M.right;
const RIGHT_EDGE = PAGE.w - M.right;

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// El logo es el mismo en todos los documentos: se carga una vez por
// sesión. Sin esto, cada regeneración (y la calculadora regenera en
// segundo plano al cambiar cualquier parámetro) repetía descarga,
// decodificación y recodificación a JPEG.
let _logoPromise = null;
function cargarLogo() {
  if (!_logoPromise) {
    _logoPromise = loadImageAsJpeg(EMPRESA.logo, { maxSize: 320, quality: 0.94, crop: LOGO_CROP })
      .catch(() => null);
  }
  return _logoPromise;
}

const fmtRD = n => 'RD$ ' + Math.round(Number(n) || 0).toLocaleString('es-DO');
// ¿Hay un número utilizable? Distingue "0" (válido) de ausente.
const hayNumero = n => typeof n === 'number' && isFinite(n) && n >= 0;
const fmtFechaLarga = d => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
const pad2 = n => String(n).padStart(2, '0');

/**
 * Folio legible y razonablemente único: fecha + 4 dígitos aleatorios.
 * No es un identificador fiscal, solo una referencia para que el
 * cliente y el asesor hablen del mismo documento por WhatsApp.
 */
function generarFolio(fecha) {
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `LB-${fecha.getFullYear()}${pad2(fecha.getMonth() + 1)}${pad2(fecha.getDate())}-${rnd}`;
}

// Nombre de archivo seguro en Windows, macOS, Android e iOS.
function nombreArchivo(nombreVehiculo, folio) {
  const slug = String(nombreVehiculo || 'vehiculo')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 48);
  return `Cotizacion-LaBatalla-${slug || 'vehiculo'}-${folio}.pdf`;
}

// ============================================================
// Secciones del documento
// ============================================================

// Cabecera de marca: banda navy + logo + folio/fecha.
function dibujarCabecera(doc, { logo, folio, fecha }) {
  const H = 112;
  // El color de la banda se toma del propio logo para que la imagen
  // encaje sin recuadro visible aunque el logo cambie en el futuro.
  const fondo = logo?.edgeColor || BRAND.navy;
  doc.rect(0, 0, PAGE.w, H, { fill: fondo });
  doc.rect(0, H, PAGE.w, 4, { fill: BRAND.sky });

  let textoX = M.left;
  if (logo) {
    doc.image(logo, M.left, 26, LOGO_BOX.w, LOGO_BOX.h);
    textoX = M.left + LOGO_BOX.w + 16;
  }
  doc.text(EMPRESA.nombre, textoX, 54, { size: 15, bold: true, color: BRAND.white, charSpacing: 0.4 });
  doc.text(EMPRESA.tagline, textoX, 70, { size: 8.5, color: '#9FB4CC' });
  doc.text(`${EMPRESA.telefono}  ·  ${EMPRESA.instagram}`, textoX, 84, { size: 8, color: '#7E94AE' });

  doc.text('COTIZACIÓN DE FINANCIAMIENTO', RIGHT_EDGE, 48,
    { size: 8.5, bold: true, color: BRAND.sky, align: 'right', charSpacing: 0.6 });
  doc.text(`Folio ${folio}`, RIGHT_EDGE, 66, { size: 8.5, color: '#CBD8E6', align: 'right' });
  doc.text(fmtFechaLarga(fecha), RIGHT_EDGE, 80, { size: 8.5, color: '#9FB4CC', align: 'right' });
}

// Tarjeta del vehículo: nombre, condición y precio de lista.
function dibujarVehiculo(doc, y, v) {
  const meta = [v.condicionTexto, v.marca, v.anio].filter(Boolean).join('  ·  ');
  // Altura según lo que realmente haya: una cotización guardada de un
  // vehículo ya despublicado solo conserva el nombre, y una tarjeta con
  // el alto completo dejaría un hueco visible.
  const alto = v.url ? 94 : (meta ? 80 : 62);
  doc.roundedRect(M.left, y, CONTENT_W, alto, 12, { fill: BRAND.panel, stroke: BRAND.hair, lineWidth: 0.8 });

  const px = M.left + 20;
  doc.text('VEHÍCULO SELECCIONADO', px, y + 24, { size: 7.5, bold: true, color: BRAND.muted, charSpacing: 0.8 });

  // El precio se maqueta primero para reservarle ancho al nombre. Puede
  // faltar al regenerar una cotización guardada de un vehículo que ya
  // no está publicado: en ese caso el bloque simplemente no se dibuja.
  const precioTexto = v.precioTexto || (hayNumero(v.precio) ? fmtRD(v.precio) : '');
  let precioW = 0;
  if (precioTexto) {
    precioW = Math.max(doc.measure(precioTexto, 15, true), doc.measure('PRECIO', 7.5, true)) + 24;
    doc.text('PRECIO', RIGHT_EDGE - 20, y + 24, { size: 7.5, bold: true, color: BRAND.muted, align: 'right', charSpacing: 0.8 });
    doc.text(precioTexto, RIGHT_EDGE - 20, y + 48, { size: 15, bold: true, color: BRAND.skyInk, align: 'right' });
  }

  doc.text(v.nombre, px, y + 48, { size: 15.5, bold: true, color: BRAND.ink, maxWidth: CONTENT_W - 40 - precioW });

  if (meta) doc.text(meta, px, y + 66, { size: 9, color: BRAND.muted, maxWidth: CONTENT_W - 40 - precioW });
  if (v.url) doc.text(v.url, px, y + 82, { size: 8, color: BRAND.skyInk, maxWidth: CONTENT_W - 40 });

  return alto;
}

// Banda destacada con la cuota mensual — el dato que el cliente busca.
function dibujarCuota(doc, y, f) {
  const alto = 84;
  doc.roundedRect(M.left, y, CONTENT_W, alto, 12, { fill: BRAND.navy });
  // Filete lateral de acento, coherente con las tarjetas del sitio.
  doc.rect(M.left, y + 18, 3.5, alto - 36, { fill: BRAND.sky });

  const px = M.left + 22;
  doc.text('CUOTA MENSUAL ESTIMADA', px, y + 24, { size: 8, bold: true, color: '#7DD3FC', charSpacing: 0.8 });
  doc.text(fmtRD(f.cuota), px, y + 56, { size: 26, bold: true, color: BRAND.white });
  doc.text('/ mes', px + doc.measure(fmtRD(f.cuota), 26, true) + 8, y + 56, { size: 11, color: '#9FB4CC' });
  doc.text(`Institución: ${f.institucion || 'Por confirmar con el asesor'}`, px, y + 72,
    { size: 8.5, color: '#9FB4CC', maxWidth: CONTENT_W * 0.55 });

  const rx = RIGHT_EDGE - 22;
  doc.text('PLAZO', rx, y + 24, { size: 7, bold: true, color: '#7E94AE', align: 'right', charSpacing: 0.7 });
  doc.text(`${f.plazo} meses`, rx, y + 39, { size: 12, bold: true, color: BRAND.white, align: 'right' });
  if (hayNumero(f.tasaAnual)) {
    doc.text('TASA ANUAL ESTIMADA', rx, y + 58, { size: 7, bold: true, color: '#7E94AE', align: 'right', charSpacing: 0.7 });
    doc.text(`${f.tasaAnual.toFixed(2)} %`, rx, y + 73, { size: 12, bold: true, color: BRAND.white, align: 'right' });
  }

  return alto;
}

// Título de sección con filete de acento.
function dibujarTituloSeccion(doc, y, texto) {
  doc.text(texto, M.left, y, { size: 12, bold: true, color: BRAND.ink });
  doc.rect(M.left, y + 5, 38, 2.5, { fill: BRAND.sky });
  return 20;
}

// Tabla clave/valor con filas cebra y énfasis en los totales.
function dibujarTabla(doc, y, filas) {
  const rowH = 23;
  const alto = filas.length * rowH;
  doc.roundedRect(M.left, y, CONTENT_W, alto, 10, { fill: BRAND.white, stroke: BRAND.hair, lineWidth: 0.8 });

  filas.forEach((fila, i) => {
    const top = y + i * rowH;
    // Las esquinas superior/inferior quedan cubiertas por el borde
    // redondeado, así que el cebreado solo se pinta en filas interiores.
    if (i % 2 === 1 && i !== filas.length - 1) {
      doc.rect(M.left + 1, top, CONTENT_W - 2, rowH, { fill: BRAND.zebra });
    }
    if (i > 0) doc.line(M.left + 14, top, RIGHT_EDGE - 14, top, { color: BRAND.hair, lineWidth: 0.6 });
    if (fila.destacada) {
      doc.rect(M.left + 1, top, 3, rowH, { fill: BRAND.sky });
    }
    const baseline = top + rowH / 2 + 3.2;
    doc.text(fila.label, M.left + 18, baseline,
      { size: 9.5, color: fila.destacada ? BRAND.ink : BRAND.body, bold: !!fila.destacada, maxWidth: CONTENT_W * 0.55 });
    doc.text(fila.valor, RIGHT_EDGE - 18, baseline,
      { size: 9.5, bold: true, color: fila.destacada ? BRAND.skyInk : BRAND.ink, align: 'right' });
  });

  return alto;
}

// Datos de contacto de quien solicita (solo si los completó).
function dibujarSolicitante(doc, y, s) {
  const alto = 56;
  doc.roundedRect(M.left, y, CONTENT_W, alto, 10, { fill: BRAND.panel, stroke: BRAND.hair, lineWidth: 0.8 });
  doc.text('DATOS DEL SOLICITANTE', M.left + 18, y + 20, { size: 7.5, bold: true, color: BRAND.muted, charSpacing: 0.8 });
  const mitad = M.left + CONTENT_W / 2;
  doc.text('Nombre', M.left + 18, y + 35, { size: 8.5, color: BRAND.muted });
  doc.text(s.nombre, M.left + 18, y + 48, { size: 10.5, bold: true, color: BRAND.ink, maxWidth: CONTENT_W / 2 - 30 });
  doc.text('Teléfono / WhatsApp', mitad, y + 35, { size: 8.5, color: BRAND.muted });
  doc.text(s.telefono, mitad, y + 48, { size: 10.5, bold: true, color: BRAND.ink, maxWidth: CONTENT_W / 2 - 30 });
  return alto;
}

// Aviso legal: deja explícito que la cotización es referencial.
function dibujarNota(doc, y) {
  const texto = 'Este documento es una simulación referencial calculada con el sistema de amortización francesa ' +
    'y tasas estimadas de mercado. La tasa definitiva, el plazo y la aprobación dependen de la evaluación ' +
    'crediticia de la institución financiera. No constituye una oferta de crédito ni un compromiso de venta.';
  const textoW = CONTENT_W - 44;
  const lineas = doc.wrap(texto, 8, false, textoW).length;
  const alto = lineas * 11 + 30;
  doc.roundedRect(M.left, y, CONTENT_W, alto, 10, { fill: BRAND.noteBg, stroke: BRAND.noteEdge, lineWidth: 0.8 });
  doc.rect(M.left + 1, y + 10, 3, alto - 20, { fill: '#E0A82E' });
  doc.text('IMPORTANTE', M.left + 20, y + 18, { size: 7.5, bold: true, color: BRAND.noteInk, charSpacing: 0.8 });
  doc.textBlock(texto, M.left + 20, y + 31, textoW, { size: 8, color: '#7A5A12', lineHeight: 11 });
  return alto;
}

// Marca de agua diagonal. Va DESPUÉS del resto para quedar por encima de
// las tarjetas opacas (si se dibujara primero, la taparían). El 6 % de
// opacidad la hace legible en papel sin estorbar la lectura: deja claro
// que el documento es una simulación y no una aprobación de crédito, por
// si alguien lo presentara en una institución financiera.
function dibujarMarcaDeAgua(doc) {
  doc.text('COTIZACIÓN REFERENCIAL', PAGE.w / 2, PAGE.h / 2 + 100, {
    size: 40, bold: true, color: BRAND.navy, align: 'center', rotate: 30, opacity: 0.06,
  });
}

// Pie institucional con los canales de contacto reales.
function dibujarPie(doc, fecha) {
  const y = PAGE.h - 46;
  doc.line(M.left, y, RIGHT_EDGE, y, { color: BRAND.hair, lineWidth: 0.8 });
  doc.text(`${EMPRESA.nombre}  ·  WhatsApp ${EMPRESA.telefono}  ·  Instagram ${EMPRESA.instagram}  ·  ${EMPRESA.sitio}`,
    PAGE.w / 2, y + 16, { size: 8, bold: true, color: BRAND.body, align: 'center' });
  doc.text(`Documento generado el ${fmtFechaLarga(fecha)} a las ${pad2(fecha.getHours())}:${pad2(fecha.getMinutes())}  ·  Página 1 de 1`,
    PAGE.w / 2, y + 28, { size: 7.5, color: BRAND.muted, align: 'center' });
}

// ============================================================
// API pública
// ============================================================
/**
 * Genera la cotización en PDF.
 *
 * @param {object} datos
 * @param {object} datos.vehiculo   { nombre, precio, precioTexto, condicionTexto, marca, anio, url }
 * @param {object} datos.financiamiento { institucion, tipo, tasaAnual, inicialPct, montoInicial,
 *                                        montoFinanciado, plazo, cuota }
 * @param {object} [datos.solicitante]  { nombre, telefono }
 * @returns {Promise<{blob: Blob, filename: string, folio: string}>}
 */
export async function generarCotizacionPDF(datos) {
  const fecha = new Date();
  const folio = datos.folio || generarFolio(fecha);
  const v = datos.vehiculo || {};
  const f = datos.financiamiento || {};
  const s = datos.solicitante;

  // Totales derivados: aportan el valor real de una cotización formal
  // (cuánto se paga de más y cuánto cuesta el vehículo al final). Solo
  // se calculan si hay monto financiado — al regenerar una cotización
  // guardada de un vehículo ya despublicado puede no conocerse.
  const hayFinanciado = hayNumero(f.montoFinanciado);
  const totalCuotas = f.cuota * f.plazo;
  const totalIntereses = hayFinanciado ? Math.max(0, totalCuotas - f.montoFinanciado) : null;
  const totalPagar = hayNumero(f.montoInicial) ? totalCuotas + f.montoInicial : null;

  const doc = new PDFDocument({
    title: `Cotización de financiamiento — ${v.nombre || 'Vehículo'}`,
    author: 'La Batalla Auto Import',
    subject: `Folio ${folio}`,
    creator: 'labatallaautoimport.netlify.app',
  });

  // El logo es opcional: si falla su carga, el documento se genera igual.
  const logo = await cargarLogo();

  dibujarCabecera(doc, { logo, folio, fecha });

  let y = 146;
  y += dibujarVehiculo(doc, y, v) + 14;
  y += dibujarCuota(doc, y, f) + 22;
  y += dibujarTituloSeccion(doc, y, 'Detalle del financiamiento') + 6;

  // Una fila por dato disponible: las que no se conocen no se inventan
  // ni se pintan vacías, simplemente no aparecen.
  const filas = [];
  const fila = (label, valor, destacada) => { if (valor !== null && valor !== undefined && valor !== '') filas.push({ label, valor, destacada }); };
  fila('Institución financiera', f.institucion);
  fila('Tipo de vehículo', f.tipo ? (f.tipo === 'usado' ? 'Usado / Seminuevo' : 'Nuevo / 0 km') : '');
  fila('Precio del vehículo', v.precioTexto || (hayNumero(v.precio) ? fmtRD(v.precio) : ''));
  fila(hayNumero(f.inicialPct) ? `Inicial (${f.inicialPct}%)` : 'Inicial',
       hayNumero(f.montoInicial) ? fmtRD(f.montoInicial) : '');
  fila('Monto a financiar', hayFinanciado ? fmtRD(f.montoFinanciado) : '');
  fila('Plazo del financiamiento', `${f.plazo} meses`);
  fila('Tasa anual estimada', hayNumero(f.tasaAnual) ? `${f.tasaAnual.toFixed(2)} %` : '');
  fila('Cuota mensual estimada', `${fmtRD(f.cuota)} / mes`, true);
  fila('Total de intereses estimados', totalIntereses === null ? '' : fmtRD(totalIntereses));
  fila('Total a pagar (inicial + cuotas)', totalPagar === null ? '' : fmtRD(totalPagar), true);
  y += dibujarTabla(doc, y, filas) + 16;

  if (s && (s.nombre || s.telefono)) {
    y += dibujarSolicitante(doc, y, { nombre: s.nombre || '—', telefono: s.telefono || '—' }) + 14;
  }
  dibujarNota(doc, y);
  dibujarPie(doc, fecha);
  dibujarMarcaDeAgua(doc);

  return { blob: doc.toBlob(), filename: nombreArchivo(v.nombre, folio), folio };
}
