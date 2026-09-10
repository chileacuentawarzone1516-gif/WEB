// ============================================================
// pdf-core.js — Generador de PDF mínimo, sin dependencias.
// ------------------------------------------------------------
// Escribe archivos PDF 1.4 válidos byte a byte. Se creó en lugar de
// cargar una librería externa (jsPDF ~350 KB) por tres razones:
//   1. Rendimiento: este módulo pesa ~9 KB y se carga bajo demanda
//      (import dinámico), solo cuando el usuario pide su cotización.
//   2. Seguridad: no añade orígenes nuevos a la Content-Security-Policy
//      ni dependencias de terceros que auditar/actualizar.
//   3. Control: el documento resultante usa exactamente la identidad
//      visual de La Batalla Auto Import.
//
// SISTEMA DE COORDENADAS
// El PDF nativo usa origen abajo-izquierda; este módulo expone un
// origen ARRIBA-izquierda (como CSS) y hace la conversión internamente.
// En `text()` la `y` es la línea base del texto medida desde arriba.
//
// FUENTES
// Helvetica / Helvetica-Bold son fuentes base del estándar PDF: no se
// incrustan (0 bytes) y todo visor las tiene. Con WinAnsiEncoding
// cubren el español completo (á é í ó ú ñ ü ¿ ¡ · — °).
//
// IMÁGENES
// Se aceptan JPEG (filtro DCTDecode), que es lo que produce
// canvas.toDataURL('image/jpeg'): permite incrustar el logo sin
// implementar un compresor Deflate.
// ============================================================

// ------------------------------------------------------------
// Codificación de texto → WinAnsi (Latin-1 + tramo 0x80-0x9F)
// ------------------------------------------------------------
// Caracteres tipográficos frecuentes que NO están en Latin-1 puro y sí
// en WinAnsiEncoding. Sin este mapa, una raya larga o unas comillas
// curvas romperían el texto del documento.
const UNICODE_TO_WINANSI = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};

// Convierte una cadena JS a códigos WinAnsi. Lo que no existe en la
// codificación (emojis, símbolos exóticos) se descarta en vez de
// producir un glifo corrupto.
function toWinAnsiCodes(str) {
  const out = [];
  for (const ch of String(str == null ? '' : str)) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0A || cp === 0x0D) continue;      // saltos: los maneja el layout
    if (cp === 0x09) { out.push(0x20); continue; } // tab → espacio
    if (cp < 0x20) continue;
    if (cp <= 0xFF) { out.push(cp); continue; }
    const mapped = UNICODE_TO_WINANSI[cp];
    if (mapped) out.push(mapped);
  }
  return out;
}

// ------------------------------------------------------------
// Métricas de Helvetica (AFM oficiales, en 1/1000 de em)
// ------------------------------------------------------------
// Solo se tabula el tramo ASCII imprimible: los glifos acentuados de
// Helvetica tienen exactamente el mismo avance que su letra base, así
// que se resuelven con un "proxy" en vez de duplicar la tabla.
const W_REGULAR = [
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,
];
const W_BOLD = [
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,
];
// Anchos explícitos del tramo WinAnsi 0x80-0x9F y símbolos Latin-1
// que no comparten avance con ninguna letra ASCII.
const W_HIGH = {
  0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350,
  0x96: 556, 0x97: 1000, 0xA0: 278, 0xA1: 333, 0xA9: 737, 0xAA: 370,
  0xAB: 556, 0xAE: 737, 0xB0: 400, 0xB7: 278, 0xBA: 365, 0xBB: 556,
  0xBF: 611, 0xD7: 584,
};
const W_HIGH_BOLD = { ...W_HIGH, 0xA1: 333, 0xBF: 611, 0x91: 278, 0x92: 278, 0x93: 500, 0x94: 500 };

// Letra ASCII cuyo avance coincide con el del carácter acentuado.
function accentProxy(code) {
  if (code >= 0xC0 && code <= 0xC5) return 65;                 // À-Å → A
  if (code === 0xC7) return 67;                                // Ç → C
  if (code >= 0xC8 && code <= 0xCB) return 69;                 // È-Ë → E
  if (code >= 0xCC && code <= 0xCF) return 73;                 // Ì-Ï → I
  if (code === 0xD1) return 78;                                // Ñ → N
  if ((code >= 0xD2 && code <= 0xD6) || code === 0xD8) return 79;
  if (code >= 0xD9 && code <= 0xDC) return 85;                 // Ù-Ü → U
  if (code === 0xDD) return 89;                                // Ý → Y
  if (code >= 0xE0 && code <= 0xE5) return 97;                 // à-å → a
  if (code === 0xE7) return 99;                                // ç → c
  if (code >= 0xE8 && code <= 0xEB) return 101;                // è-ë → e
  if (code >= 0xEC && code <= 0xEF) return 105;                // ì-ï → i
  if (code === 0xF1) return 110;                               // ñ → n
  if ((code >= 0xF2 && code <= 0xF6) || code === 0xF8) return 111;
  if (code >= 0xF9 && code <= 0xFC) return 117;                // ù-ü → u
  if (code === 0xFD || code === 0xFF) return 121;              // ý ÿ → y
  return 0;
}

function glyphWidth(code, bold) {
  if (code >= 32 && code <= 126) return (bold ? W_BOLD : W_REGULAR)[code - 32];
  const high = (bold ? W_HIGH_BOLD : W_HIGH)[code];
  if (high) return high;
  const proxy = accentProxy(code);
  if (proxy) return (bold ? W_BOLD : W_REGULAR)[proxy - 32];
  return bold ? 611 : 556; // avance medio: no deja huecos visibles
}

// ------------------------------------------------------------
// Utilidades de bytes / color
// ------------------------------------------------------------
function asciiBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}

// '#0f2038' | '0f2038' | [r,g,b] → "0.059 0.125 0.220"
function colorOps(color) {
  let r, g, b;
  if (Array.isArray(color)) { [r, g, b] = color; }
  else {
    const hex = String(color).replace('#', '');
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    r = parseInt(full.slice(0, 2), 16);
    g = parseInt(full.slice(2, 4), 16);
    b = parseInt(full.slice(4, 6), 16);
  }
  const n = v => (Math.max(0, Math.min(255, v)) / 255).toFixed(4);
  return `${n(r)} ${n(g)} ${n(b)}`;
}

// Escapa una cadena ya convertida a códigos WinAnsi como literal PDF.
// Todo lo no imprimible se emite en octal para que el flujo de
// contenido siga siendo ASCII puro (evita problemas de transporte).
function pdfString(codes) {
  let out = '(';
  for (const c of codes) {
    if (c === 0x28) out += '\\(';
    else if (c === 0x29) out += '\\)';
    else if (c === 0x5C) out += '\\\\';
    else if (c >= 32 && c <= 126) out += String.fromCharCode(c);
    else out += '\\' + c.toString(8).padStart(3, '0');
  }
  return out + ')';
}

// Cadena de TEXTO del diccionario de metadatos. A diferencia del flujo
// de contenido —que se dibuja con fuentes declaradas en WinAnsiEncoding—
// las cadenas de /Info se leen como PDFDocEncoding salvo que empiecen
// por el BOM UTF-16BE. Sin este marcador, "—" o "ñ" aparecían como otro
// carácter en el título del visor. Se emite en hexadecimal, que es
// exactamente lo que espera el estándar para este caso.
function pdfUtf16String(str) {
  let hex = 'FEFF';
  for (const ch of String(str == null ? '' : str)) {
    let cp = ch.codePointAt(0);
    if (cp > 0xFFFF) { // fuera del BMP: par suplente
      cp -= 0x10000;
      hex += (0xD800 + (cp >> 10)).toString(16).padStart(4, '0');
      hex += (0xDC00 + (cp & 0x3FF)).toString(16).padStart(4, '0');
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return `<${hex.toUpperCase()}>`;
}

// Radio de bézier para esquinas redondeadas (constante de círculo).
const KAPPA = 0.5522847498;

// ============================================================
// PDFDocument
// ============================================================
export class PDFDocument {
  /**
   * @param {object} opts
   * @param {number} [opts.width]  Ancho en puntos (A4 por defecto).
   * @param {number} [opts.height] Alto en puntos.
   * @param {string} [opts.title]  Metadatos del documento.
   */
  constructor(opts = {}) {
    this.width = opts.width || 595.28;   // A4
    this.height = opts.height || 841.89;
    this.meta = {
      title: opts.title || 'Documento',
      author: opts.author || '',
      subject: opts.subject || '',
      creator: opts.creator || '',
    };
    this.pages = [];      // [{ ops: string[] }]
    this.images = [];     // [{ bytes, width, height }]
    // Opacidades usadas en el documento. En PDF la transparencia no es un
    // atributo del operador de dibujo: se declara en un ExtGState con /ca
    // (relleno) y /CA (trazo) y se activa con `gs`. Se registran aquí para
    // emitir un solo recurso por nivel de opacidad, no uno por llamada.
    this.alphas = new Map(); // valor (0-1) → nombre de recurso
    this.addPage();
  }

  addPage() {
    this.pages.push({ ops: [] });
    return this.pages.length;
  }

  get _page() { return this.pages[this.pages.length - 1]; }
  _push(op) { this._page.ops.push(op); }

  // Convierte una Y "desde arriba" a la Y nativa del PDF.
  _y(y) { return this.height - y; }

  // Devuelve el operador que activa una opacidad, registrándola si es
  // nueva. `null` cuando es opaca: así el caso normal no emite nada.
  _alphaOp(opacity) {
    if (opacity === undefined || opacity === null || opacity >= 1) return null;
    const value = Math.max(0, Math.min(1, opacity));
    const key = value.toFixed(3);
    if (!this.alphas.has(key)) this.alphas.set(key, `GS${this.alphas.size + 1}`);
    return `/${this.alphas.get(key)} gs`;
  }

  // ---------------- Medición ----------------
  /** Ancho en puntos que ocupará `text` con la fuente/tamaño dados. */
  measure(text, size, bold = false) {
    let total = 0;
    for (const code of toWinAnsiCodes(text)) total += glyphWidth(code, bold);
    return (total / 1000) * size;
  }

  /** Corta el texto con elipsis si excede `maxWidth`. */
  ellipsize(text, size, bold, maxWidth) {
    if (this.measure(text, size, bold) <= maxWidth) return text;
    let cut = String(text);
    while (cut.length > 1 && this.measure(cut + '…', size, bold) > maxWidth) {
      cut = cut.slice(0, -1);
    }
    return cut.trimEnd() + '…';
  }

  /** Divide `text` en líneas que caben en `maxWidth`. */
  wrap(text, size, bold, maxWidth) {
    const lines = [];
    for (const paragraph of String(text == null ? '' : text).split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const candidate = line + ' ' + words[i];
        if (this.measure(candidate, size, bold) <= maxWidth) line = candidate;
        else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    }
    return lines;
  }

  // ---------------- Dibujo ----------------
  rect(x, y, w, h, { fill, stroke, lineWidth = 1 } = {}) {
    const ops = ['q'];
    if (fill) ops.push(`${colorOps(fill)} rg`);
    if (stroke) ops.push(`${colorOps(stroke)} RG`, `${lineWidth} w`);
    ops.push(`${x} ${this._y(y + h)} ${w} ${h} re`);
    ops.push(fill && stroke ? 'B' : stroke ? 'S' : 'f');
    ops.push('Q');
    this._push(ops.join('\n'));
  }

  roundedRect(x, y, w, h, r, { fill, stroke, lineWidth = 1 } = {}) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    if (radius === 0) return this.rect(x, y, w, h, { fill, stroke, lineWidth });
    const y0 = this._y(y + h), y1 = this._y(y); // abajo, arriba
    const k = radius * KAPPA;
    const ops = ['q'];
    if (fill) ops.push(`${colorOps(fill)} rg`);
    if (stroke) ops.push(`${colorOps(stroke)} RG`, `${lineWidth} w`);
    ops.push(`${x + radius} ${y0} m`);
    ops.push(`${x + w - radius} ${y0} l`);
    ops.push(`${x + w - radius + k} ${y0} ${x + w} ${y0 + radius - k} ${x + w} ${y0 + radius} c`);
    ops.push(`${x + w} ${y1 - radius} l`);
    ops.push(`${x + w} ${y1 - radius + k} ${x + w - radius + k} ${y1} ${x + w - radius} ${y1} c`);
    ops.push(`${x + radius} ${y1} l`);
    ops.push(`${x + radius - k} ${y1} ${x} ${y1 - radius + k} ${x} ${y1 - radius} c`);
    ops.push(`${x} ${y0 + radius} l`);
    ops.push(`${x} ${y0 + radius - k} ${x + radius - k} ${y0} ${x + radius} ${y0} c`);
    ops.push('h', fill && stroke ? 'B' : stroke ? 'S' : 'f', 'Q');
    this._push(ops.join('\n'));
  }

  line(x1, y1, x2, y2, { color = '#000000', lineWidth = 0.5 } = {}) {
    this._push(['q', `${colorOps(color)} RG`, `${lineWidth} w`,
      `${x1} ${this._y(y1)} m`, `${x2} ${this._y(y2)} l`, 'S', 'Q'].join('\n'));
  }

  /**
   * Escribe una línea de texto. `y` es la LÍNEA BASE desde arriba.
   * @param {object} o
   * @param {number} [o.size=10]
   * @param {boolean} [o.bold=false]
   * @param {string} [o.color='#000000']
   * @param {'left'|'center'|'right'} [o.align='left']
   * @param {number} [o.maxWidth]  Recorta con elipsis si se excede.
   * @param {number} [o.charSpacing] Tracking en puntos (para versalitas).
   * @param {number} [o.rotate] Giro en grados, antihorario, sobre (x, y).
   * @param {number} [o.opacity] 0-1. Por debajo de 1 emite un ExtGState.
   */
  text(str, x, y, o = {}) {
    const size = o.size || 10;
    const bold = !!o.bold;
    let content = String(str == null ? '' : str);
    if (o.maxWidth) content = this.ellipsize(content, size, bold, o.maxWidth);
    const codes = toWinAnsiCodes(content);
    if (!codes.length) return;

    const spacing = o.charSpacing || 0;
    let width = (codes.reduce((a, c) => a + glyphWidth(c, bold), 0) / 1000) * size;
    if (spacing) width += spacing * (codes.length - 1);

    // Desplazamiento de alineación medido en el eje del propio texto, para
    // que siga siendo correcto cuando el texto va girado.
    let dx = 0;
    if (o.align === 'right') dx = -width;
    else if (o.align === 'center') dx = -width / 2;

    const rad = ((o.rotate || 0) * Math.PI) / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const tx = x + cos * dx;
    const ty = this._y(y) + sin * dx;

    const ops = ['q'];
    const alpha = this._alphaOp(o.opacity);
    if (alpha) ops.push(alpha);
    ops.push('BT', `${colorOps(o.color || '#000000')} rg`, `/${bold ? 'F2' : 'F1'} ${size} Tf`);
    if (spacing) ops.push(`${spacing} Tc`);
    ops.push(`${cos.toFixed(5)} ${sin.toFixed(5)} ${(-sin).toFixed(5)} ${cos.toFixed(5)} ` +
             `${tx.toFixed(2)} ${ty.toFixed(2)} Tm`, `${pdfString(codes)} Tj`);
    if (spacing) ops.push('0 Tc');
    ops.push('ET', 'Q');
    this._push(ops.join('\n'));
  }

  /**
   * Texto con ajuste automático de línea.
   * @returns {number} alto total consumido en puntos.
   */
  textBlock(str, x, y, width, o = {}) {
    const size = o.size || 10;
    const lineHeight = o.lineHeight || size * 1.4;
    const lines = this.wrap(str, size, !!o.bold, width);
    const max = o.maxLines && lines.length > o.maxLines ? o.maxLines : lines.length;
    for (let i = 0; i < max; i++) {
      let line = lines[i];
      if (o.maxLines && max < lines.length && i === max - 1) line = this.ellipsize(line + ' …', size, !!o.bold, width);
      this.text(line, x, y + i * lineHeight, { ...o, align: o.align, maxWidth: width });
    }
    return max * lineHeight;
  }

  /**
   * Incrusta una imagen JPEG.
   * @param {{bytes:Uint8Array,width:number,height:number}} jpeg
   */
  image(jpeg, x, y, w, h) {
    this.images.push(jpeg);
    const name = `Im${this.images.length}`;
    this._push(['q', `${w} 0 0 ${h} ${x} ${this._y(y + h)} cm`, `/${name} Do`, 'Q'].join('\n'));
  }

  // ---------------- Serialización ----------------
  toBytes() {
    const chunks = [];
    let length = 0;
    const write = data => {
      const bytes = typeof data === 'string' ? asciiBytes(data) : data;
      chunks.push(bytes); length += bytes.length;
      return length;
    };

    const objects = []; // { header:string, stream?:Uint8Array }
    const addObject = (body, stream) => { objects.push({ body, stream }); return objects.length; };

    // Reserva de ids: 1 catálogo, 2 árbol de páginas.
    const CATALOG_ID = 1, PAGES_ID = 2;
    objects.push(null, null); // placeholders

    const fontRegular = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const imageIds = this.images.map(img => addObject(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`,
      img.bytes
    ));

    // Los XObject se declaran por documento: una sola imagen del logo
    // reutilizada en todas las páginas (no se duplica el binario).
    const xobjects = imageIds.length
      ? `/XObject << ${imageIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>`
      : '';
    const extGState = this.alphas.size
      ? `/ExtGState << ${[...this.alphas].map(([value, name]) =>
          `/${name} << /Type /ExtGState /ca ${value} /CA ${value} >>`).join(' ')} >>`
      : '';
    const resources = `<< /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> ` +
      `${xobjects} ${extGState} /ProcSet [/PDF /Text /ImageC] >>`;

    const pageIds = [];
    for (const page of this.pages) {
      const content = asciiBytes(page.ops.join('\n'));
      const contentId = addObject(`<< /Length ${content.length} >>`, content);
      pageIds.push(addObject(
        `<< /Type /Page /Parent ${PAGES_ID} 0 R /MediaBox [0 0 ${this.width} ${this.height}] ` +
        `/Resources ${resources} /Contents ${contentId} 0 R >>`
      ));
    }

    const m = this.meta;
    const metaStr = (k, v) => (v ? ` /${k} ${pdfUtf16String(v)}` : '');
    const infoId = addObject(
      `<<${metaStr('Title', m.title)}${metaStr('Author', m.author)}` +
      `${metaStr('Subject', m.subject)}${metaStr('Creator', m.creator)}` +
      `${metaStr('Producer', 'La Batalla Auto Import')} /CreationDate (${pdfDate(new Date())}) >>`
    );

    objects[CATALOG_ID - 1] = { body: `<< /Type /Catalog /Pages ${PAGES_ID} 0 R >>` };
    objects[PAGES_ID - 1] = {
      body: `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`,
    };

    // --- Cuerpo del archivo ---
    write('%PDF-1.4\n');
    write(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // marca binaria
    const offsets = [];
    objects.forEach((obj, i) => {
      offsets[i] = length;
      write(`${i + 1} 0 obj\n${obj.body}\n`);
      if (obj.stream) { write('stream\n'); write(obj.stream); write('\nendstream\n'); }
      write('endobj\n');
    });

    // --- Tabla xref ---
    const xrefOffset = length;
    write(`xref\n0 ${objects.length + 1}\n`);
    write('0000000000 65535 f \n');
    offsets.forEach(off => write(`${String(off).padStart(10, '0')} 00000 n \n`));
    write(`trailer\n<< /Size ${objects.length + 1} /Root ${CATALOG_ID} 0 R /Info ${infoId} 0 R >>\n`);
    write(`startxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) { out.set(chunk, cursor); cursor += chunk.length; }
    return out;
  }

  toBlob() { return new Blob([this.toBytes()], { type: 'application/pdf' }); }
}

// Fecha en el formato de metadatos del estándar PDF: D:YYYYMMDDHHmmSS
function pdfDate(date) {
  const p = n => String(n).padStart(2, '0');
  return `D:${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
         `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

// ============================================================
// Carga de imágenes → JPEG apto para incrustar
// ============================================================
/**
 * Descarga una imagen del MISMO ORIGEN y la convierte a JPEG mediante
 * canvas. Devuelve además el color del píxel de la esquina, que el
 * documento usa para que la imagen encaje sin bordes visibles con la
 * banda de cabecera (si un día cambia el logo, el PDF se adapta solo).
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.maxSize=240]  Lado mayor del bitmap resultante.
 * @param {number} [opts.quality=0.92]
 * @param {{x:number,y:number,w:number,h:number}} [opts.crop]
 *        Recorte en FRACCIONES (0-1) de la imagen original. Permite
 *        quedarse solo con el emblema de un logotipo y descartar el
 *        texto que lleva incrustado, ilegible a tamaño de membrete.
 * @returns {Promise<{bytes:Uint8Array,width:number,height:number,edgeColor:string|null}|null>}
 */
export async function loadImageAsJpeg(url, opts = {}) {
  const { maxSize = 240, quality = 0.92, crop } = opts;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
      img.src = url;
    });

    const srcW = img.naturalWidth || img.width || maxSize;
    const srcH = img.naturalHeight || img.height || maxSize;
    const sx = crop ? crop.x * srcW : 0;
    const sy = crop ? crop.y * srcH : 0;
    const sw = crop ? crop.w * srcW : srcW;
    const sh = crop ? crop.h * srcH : srcH;

    // Se mantiene la proporción del recorte para no deformar el logo.
    const scale = maxSize / Math.max(sw, sh);
    const outW = Math.max(1, Math.round(sw * scale));
    const outH = Math.max(1, Math.round(sh * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // JPEG no tiene canal alfa: se compone sobre el color de fondo real
    // de la imagen (esquina) para que no aparezca un halo blanco.
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    let edgeColor = null;
    try {
      const d = ctx.getImageData(1, 1, 1, 1).data;
      edgeColor = `#${[d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    } catch (e) { /* canvas contaminado: se usará el color de marca por defecto */ }

    const base64 = canvas.toDataURL('image/jpeg', quality).split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, width: outW, height: outH, edgeColor };
  } catch (e) {
    return null; // el documento se genera igual, solo sin logo
  }
}
