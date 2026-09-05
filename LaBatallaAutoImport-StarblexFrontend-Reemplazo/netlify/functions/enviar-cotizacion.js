// ============================================================
// enviar-cotizacion.js — Netlify Function
// ------------------------------------------------------------
// Envía al asesor, por correo, el PDF de la cotización que el cliente
// acaba de solicitar. Se dispara junto al mensaje de WhatsApp: si el
// cliente cierra WhatsApp sin llegar a enviarlo, o el asesor lo pierde
// entre conversaciones, la solicitud sigue estando en su bandeja con el
// documento adjunto.
//
// DECISIONES DE SEGURIDAD (esta función es un endpoint público):
//
//  1. El DESTINATARIO nunca viene del cliente: se lee de la variable de
//     entorno COTIZACION_EMAIL_TO. Aceptarlo por petición convertiría la
//     función en un relay de spam abierto firmado con el dominio del
//     negocio.
//  2. Solo se acepta el MISMO ORIGEN: se compara el Origin con el host
//     de la propia petición, así que las previsualizaciones de despliegue
//     funcionan sin mantener una lista de dominios.
//  3. Límite de tamaño y de frecuencia por IP, para que nadie pueda
//     agotar la cuota de correo del negocio.
//  4. Todo texto del cliente se escapa antes de entrar en el HTML del
//     correo, y el adjunto se valida como PDF real por su firma.
//  5. Sin la configuración de correo responde 503 sin enviar nada: el
//     sitio sigue funcionando igual, solo no llega la copia por correo.
//
// CONFIGURACIÓN (Netlify → Site configuration → Environment variables):
//   RESEND_API_KEY        Clave de https://resend.com (plan gratuito:
//                         3.000 correos/mes).
//   COTIZACION_EMAIL_TO   Correo del asesor que recibe las solicitudes.
//   COTIZACION_EMAIL_FROM Remitente verificado en Resend. Mientras no
//                         haya dominio propio verificado, Resend permite
//                         "onboarding@resend.dev" para pruebas.
// ============================================================

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const MAX_BODY_BYTES = 4 * 1024 * 1024;   // el PDF ronda los 30 KB; margen amplio
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const MAX_TEXTO = 4000;

// Limitador de frecuencia por IP. Vive en la memoria del contenedor, así
// que se reinicia con cada arranque en frío: no es una defensa perfecta,
// pero corta las ráfagas, que es de lo que se trata. Uno persistente
// exigiría un almacén externo que hoy el proyecto no tiene.
const VENTANA_MS = 60 * 1000;
const MAX_POR_VENTANA = 5;
const golpes = new Map();

function excedeLimite(ip) {
  const ahora = Date.now();
  const previos = (golpes.get(ip) || []).filter(t => ahora - t < VENTANA_MS);
  previos.push(ahora);
  golpes.set(ip, previos);
  // Poda perezosa: evita que el mapa crezca sin límite en un contenedor
  // de larga vida.
  if (golpes.size > 500) {
    for (const [clave, marcas] of golpes) {
      if (!marcas.some(t => ahora - t < VENTANA_MS)) golpes.delete(clave);
    }
  }
  return previos.length > MAX_POR_VENTANA;
}

const respuesta = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

function escapeHtml(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Recorta y limpia un texto del cliente antes de usarlo en el correo.
// Los caracteres de control se eliminan: son los que permitirían inyectar
// saltos en una cabecera o romper el asunto.
function texto(valor, max = 150) {
  return String(valor == null ? '' : valor)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

// ¿El Origin de la petición es el propio sitio? Comparar contra el host
// de la petición cubre producción, ramas y previsualizaciones sin lista.
function mismoOrigen(headers) {
  const origin = headers.origin || headers.Origin;
  const host = headers.host || headers.Host;
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; }
  catch (e) { return false; }
}

// Valida que el adjunto sea un PDF de verdad y no cualquier binario.
function pdfValido(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) return null;
  let bytes;
  try { bytes = Buffer.from(base64, 'base64'); }
  catch (e) { return null; }
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) return null;
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
  return bytes.toString('base64'); // re-serializado: sin espacios ni saltos
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return respuesta(405, { error: 'Método no permitido' });

  const headers = event.headers || {};
  if (!mismoOrigen(headers)) return respuesta(403, { error: 'Origen no permitido' });

  const apiKey = process.env.RESEND_API_KEY;
  const destino = process.env.COTIZACION_EMAIL_TO;
  const remitente = process.env.COTIZACION_EMAIL_FROM;
  if (!apiKey || !destino || !remitente) {
    // No es un error del cliente: el sitio funciona, solo falta configurar
    // el correo. Se registra para que aparezca en los logs de Netlify.
    console.warn('enviar-cotizacion: faltan RESEND_API_KEY, COTIZACION_EMAIL_TO o COTIZACION_EMAIL_FROM');
    return respuesta(503, { error: 'Envío de correo no configurado' });
  }

  const ip = headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || 'desconocida';
  if (excedeLimite(String(ip).split(',')[0].trim())) {
    return respuesta(429, { error: 'Demasiadas solicitudes seguidas' });
  }

  if (!event.body || Buffer.byteLength(event.body, event.isBase64Encoded ? 'base64' : 'utf8') > MAX_BODY_BYTES) {
    return respuesta(413, { error: 'Solicitud demasiado grande' });
  }

  let datos;
  try {
    datos = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body);
  } catch (e) {
    return respuesta(400, { error: 'Solicitud inválida' });
  }

  const adjunto = pdfValido(datos.pdfBase64);
  if (!adjunto) return respuesta(400, { error: 'Adjunto inválido' });

  const folio = texto(datos.folio, 40) || 'sin folio';
  const vehiculo = texto(datos.vehiculo, 150) || 'Vehículo';
  const nombre = texto(datos.nombre, 100) || 'No indicado';
  const telefono = texto(datos.telefono, 40) || 'No indicado';
  const institucion = texto(datos.institucion, 60) || 'No indicada';
  const cuota = texto(datos.cuota, 40) || '—';
  const plazo = texto(datos.plazo, 20) || '—';
  const enlace = /^https:\/\//.test(String(datos.url || '')) ? texto(datos.url, 300) : '';
  const resumen = texto(datos.resumen, MAX_TEXTO);
  // El nombre del archivo llega del cliente: se restringe a caracteres
  // seguros para que no pueda inyectar rutas ni cabeceras en el adjunto.
  const filename = (texto(datos.filename, 120).replace(/[^A-Za-z0-9._-]/g, '-') || 'Cotizacion')
    .replace(/\.pdf$/i, '') + '.pdf';

  const fila = (etiqueta, valor) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#64748b;font-size:13px;">${escapeHtml(etiqueta)}</td>` +
    `<td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(valor)}</td></tr>`;

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;">
  <h2 style="color:#0f2038;margin:0 0 4px;font-size:19px;">Nueva solicitud de financiamiento</h2>
  <p style="color:#64748b;margin:0 0 18px;font-size:13px;">Folio ${escapeHtml(folio)} · generada desde la calculadora del sitio</p>
  <table style="border-collapse:collapse;margin-bottom:18px;">
    ${fila('Cliente', nombre)}
    ${fila('Teléfono / WhatsApp', telefono)}
    ${fila('Vehículo', vehiculo)}
    ${fila('Institución', institucion)}
    ${fila('Cuota estimada', cuota)}
    ${fila('Plazo', plazo)}
  </table>
  ${enlace ? `<p style="margin:0 0 18px;"><a href="${escapeHtml(enlace)}" style="color:#0369a1;font-size:13px;">Ver la publicación del vehículo</a></p>` : ''}
  <p style="color:#475569;font-size:13px;margin:0;">La cotización completa va adjunta en PDF.</p>
</div>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: remitente,
        to: [destino],
        subject: `Solicitud de financiamiento — ${vehiculo} (${nombre})`,
        html,
        text: resumen || `Solicitud de ${nombre} (${telefono}) para ${vehiculo}.`,
        attachments: [{ filename, content: adjunto }],
      }),
    });
    if (!res.ok) {
      // El detalle del proveedor va al log, nunca a la respuesta.
      console.error('enviar-cotizacion: Resend respondió', res.status, await res.text());
      return respuesta(502, { error: 'No se pudo enviar el correo' });
    }
    return respuesta(200, { ok: true });
  } catch (e) {
    console.error('enviar-cotizacion: fallo de red al llamar a Resend', e);
    return respuesta(502, { error: 'No se pudo enviar el correo' });
  }
};
