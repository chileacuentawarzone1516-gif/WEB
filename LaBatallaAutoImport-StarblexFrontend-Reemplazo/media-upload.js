// ============================================================
// MEDIA UPLOAD — compresión + subida firmada a Cloudinary
// ------------------------------------------------------------
// Módulo autocontenido, sin dependencias del resto del proyecto: recibe
// el ID Token de Firebase como parámetro y devuelve la URL final. Se
// extrajo de app.js porque allí eran 40 líneas sin tolerancia a fallos
// y porque el error real que se estaba viendo ("❌ Error subiendo
// fotos") nacía justo ahí.
//
// POR QUÉ FALLABA AL PUBLICAR DESDE EL TELÉFONO:
//
//   1. Se subía el archivo ORIGINAL de la cámara. Una foto de un móvil
//      actual pesa entre 3 y 12 MB; diez fotos son 40-90 MB subiendo por
//      datos móviles, en serie y sin reintentos. Basta un microcorte
//      (cambio de celda, ascensor, Wi-Fi que se cae) para tumbar toda la
//      publicación. Ahora cada imagen se redimensiona a 1920 px y se
//      recomprime en el navegador ANTES de salir: la misma tanda pasa de
//      decenas de MB a 2-4 MB.
//
//   2. `fetch` sin AbortController se queda colgado para siempre cuando
//      la radio del teléfono pierde la conexión sin cerrar el socket: el
//      botón se quedaba en "Subiendo foto 3 de 10…" indefinidamente.
//      Ahora hay un temporizador de inactividad que aborta y reintenta.
//
//   3. Sin reintentos: cualquier fallo puntual (5xx, 429, corte) era
//      definitivo. Ahora hay 3 intentos con espera exponencial.
//
//   4. Se pedía una firma nueva al Worker POR CADA archivo: 10 viajes de
//      ida y vuelta, 10 verificaciones de JWT y 10 lecturas de Firestore
//      para publicar un solo vehículo. La firma de Cloudinary es válida
//      una hora; se cachea 20 minutos y baja a UNA sola petición por
//      publicación (menos coste de Firestore y menos puntos de fallo).
//
//   5. El mensaje de error era siempre el mismo, así que era imposible
//      saber si el problema era la sesión, la conexión o un archivo
//      concreto. Ahora cada fallo se traduce a una causa concreta.
//
//   6. La pantalla se bloqueaba a mitad de la subida y el navegador
//      congelaba la petición. Se pide un Wake Lock mientras dura.
// ============================================================
(function () {
  'use strict';

  // ——— Compresión ———
  const MAX_DIMENSION = 1920;      // suficiente para ficha y lightbox
  const JPEG_QUALITY = 0.82;       // punto donde deja de notarse a simple vista
  const WEBP_QUALITY = 0.8;
  const SKIP_COMPRESSION_BYTES = 400 * 1024; // por debajo no compensa

  // ——— Red ———
  const MAX_ATTEMPTS = 3;
  const RETRY_BASE_MS = 1500;      // 1,5 s → 3 s → 6 s
  const STALL_TIMEOUT_MS = 45000;  // sin un solo byte de progreso durante 45 s
  const SIGNATURE_TTL_MS = 20 * 60 * 1000; // Cloudinary admite 1 h; 20 min sobra

  const SIGN_URL = 'https://labatalla-cloudinary-sign.chileacuentawarzone1516.workers.dev';

  // ============================================================
  // Errores tipados — permiten decidir si merece la pena reintentar y
  // qué explicarle a la persona que está publicando.
  // ============================================================
  class UploadError extends Error {
    constructor(message, { code, retryable = false, status = 0, stage = '', detail = '' } = {}) {
      super(message);
      this.name = 'UploadError';
      this.code = code;
      this.retryable = retryable;
      this.status = status;
      // `stage` distingue "no se pudo pedir la firma" de "se cayó la
      // transferencia del archivo". Sin esta distinción los dos fallos se
      // reportaban con el mismo texto ("se perdió la conexión") y era
      // imposible saber si el problema era la red del usuario o la
      // configuración del servidor de firma.
      this.stage = stage;          // 'sign' | 'upload'
      // Cuerpo real de la respuesta (recortado). Es lo único que permite
      // saber POR QUÉ rechazó Cloudinary o el Worker.
      this.detail = detail;
    }
  }

  // ============================================================
  // DIAGNÓSTICO — sin esto no hay forma de contestar "¿qué status HTTP
  // devolvió?" desde el móvil de quien publica, que es exactamente donde
  // ocurre el fallo y donde nadie tiene una consola abierta.
  //
  // Anillo acotado en memoria (no se persiste, no viaja a ningún sitio):
  // se vacía al recargar la página. Solo lo lee el modal de fallo, que
  // permite copiarlo para pegarlo en un mensaje.
  // ============================================================
  const DIAGNOSTICS_LIMIT = 40;
  const diagnostics = [];

  function recordDiagnostic(entry) {
    diagnostics.push({ at: new Date().toISOString(), ...entry });
    if (diagnostics.length > DIAGNOSTICS_LIMIT) diagnostics.shift();
  }

  function getDiagnostics() { return diagnostics.slice(); }

  // Informe en texto plano, listo para copiar y pegar. Deliberadamente NO
  // incluye el ID Token, la firma ni la api_key: el informe está pensado
  // para compartirse por WhatsApp o correo.
  function getDiagnosticsReport() {
    const head = [
      `La Batalla Auto Import — diagnóstico de subida`,
      `Fecha: ${new Date().toISOString()}`,
      `Origen: ${location.origin}`,
      `Servidor de firma: ${SIGN_URL}`,
      `Navegador: ${navigator.userAgent}`,
      `Conexión: ${navigator.onLine ? 'online' : 'offline'}` +
        (navigator.connection && navigator.connection.effectiveType
          ? ` (${navigator.connection.effectiveType})` : ''),
      '',
    ];
    if (diagnostics.length === 0) head.push('(sin incidencias registradas)');
    const body = diagnostics.map(d => {
      const parts = [
        d.at,
        `etapa=${d.stage || '—'}`,
        `codigo=${d.code || '—'}`,
        d.status ? `http=${d.status}` : 'http=(sin respuesta)',
        d.attempt ? `intento=${d.attempt}/${MAX_ATTEMPTS}` : '',
        d.file ? `archivo="${d.file.name}" ${Math.round((d.file.size || 0) / 1024)}KB ${d.file.type || 'sin tipo'}` : '',
        d.ms != null ? `${d.ms}ms` : '',
      ].filter(Boolean);
      const detail = d.detail ? `\n    respuesta: ${d.detail}` : '';
      return `  ${parts.join(' · ')}${detail}`;
    });
    return head.concat(body).join('\n');
  }

  // ============================================================
  // Detección de formatos
  // ============================================================
  function isVideoFile(file) {
    return !!file && (file.type || '').startsWith('video/');
  }

  // HEIC/HEIF: formato por defecto de la cámara del iPhone. Ni Chromium
  // ni Firefox lo decodifican, así que no se puede comprimir en el
  // navegador — se sube tal cual y Cloudinary lo convierte en servidor.
  function isHeic(file) {
    if (!file) return false;
    const type = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return type === 'image/heic' || type === 'image/heif' ||
      name.endsWith('.heic') || name.endsWith('.heif');
  }

  function isImageFile(file) {
    return !!file && ((file.type || '').startsWith('image/') || isHeic(file));
  }

  // GIF animado y SVG se dejan intactos: recomprimirlos en un <canvas>
  // destruiría la animación en el primero y rasterizaría el segundo.
  function isCompressible(file) {
    if (!isImageFile(file) || isHeic(file)) return false;
    const type = (file.type || '').toLowerCase();
    return type !== 'image/gif' && type !== 'image/svg+xml';
  }

  // ============================================================
  // Compresión en el navegador
  // ============================================================
  let webpSupport = null;
  function supportsWebp() {
    if (webpSupport !== null) return webpSupport;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      webpSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    } catch (e) {
      webpSupport = false;
    }
    return webpSupport;
  }

  // `imageOrientation: 'from-image'` es imprescindible: sin él, una foto
  // vertical tomada con el móvil se sube girada 90°, porque el canvas
  // ignora la orientación EXIF que el <img> sí respeta.
  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch (e) {
        try { return await createImageBitmap(file); } catch (e2) { /* fallback <img> */ }
      }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo decodificar la imagen')); };
      img.src = url;
    });
  }

  function scaledSize(width, height) {
    if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) return { width, height };
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(resolve => {
      try { canvas.toBlob(blob => resolve(blob), mime, quality); }
      catch (e) { resolve(null); }
    });
  }

  function replaceExtension(name, extension) {
    const base = (name || 'foto').replace(/\.[^./\\]+$/, '');
    return `${base}.${extension}`;
  }

  /**
   * Devuelve el archivo listo para subir. Nunca lanza: si la compresión
   * no es posible (formato exótico, memoria insuficiente, navegador
   * antiguo) se devuelve el original y Cloudinary hace su trabajo.
   */
  async function prepareForUpload(file) {
    if (!isCompressible(file)) return file;

    let bitmap = null;
    try {
      bitmap = await decodeImage(file);
      const sourceWidth = bitmap.width || bitmap.naturalWidth;
      const sourceHeight = bitmap.height || bitmap.naturalHeight;
      if (!sourceWidth || !sourceHeight) return file;

      const { width, height } = scaledSize(sourceWidth, sourceHeight);
      // Ni se reescala ni pesa lo suficiente: recomprimir solo añadiría
      // pérdida de calidad sin ganancia real.
      if (width === sourceWidth && height === sourceHeight && file.size <= SKIP_COMPRESSION_BYTES) return file;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return file;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);

      const useWebp = supportsWebp();
      const mime = useWebp ? 'image/webp' : 'image/jpeg';
      const blob = await canvasToBlob(canvas, mime, useWebp ? WEBP_QUALITY : JPEG_QUALITY);
      // Liberar el canvas cuanto antes: en móviles con poca RAM, diez
      // lienzos de 1920 px vivos a la vez provocan que el navegador mate
      // la pestaña justo cuando el usuario pulsa "Publicar".
      canvas.width = canvas.height = 0;

      if (!blob || blob.size >= file.size) return file; // no mejoró: original
      const name = replaceExtension(file.name, useWebp ? 'webp' : 'jpg');
      try {
        return new File([blob], name, { type: mime, lastModified: Date.now() });
      } catch (e) {
        blob.name = name; // navegadores sin constructor File
        return blob;
      }
    } catch (e) {
      console.warn('No se pudo comprimir la imagen, se sube el original:', e);
      return file;
    } finally {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    }
  }

  // ============================================================
  // Firma — cacheada por propósito mientras siga vigente.
  // ============================================================
  const signatureCache = new Map();

  function cacheKey(purpose, uid) { return `${purpose}:${uid || ''}`; }

  function invalidateSignatures() { signatureCache.clear(); }

  // ------------------------------------------------------------
  // SONDA DE ALCANCE — distingue "no hay red" de "el servidor está ahí
  // pero rechaza este origen".
  //
  // POR QUÉ HACE FALTA: cuando una petición cross-origin es rechazada por
  // CORS, el navegador NO entrega ni el status ni el cuerpo; `fetch`
  // lanza un TypeError idéntico al de una caída de red. Con esa única
  // señal, el mensaje que veía el usuario era siempre "se perdió la
  // conexión", aunque la conexión estuviera perfecta y el problema fuese
  // que el Worker no tiene este dominio en su whitelist ALLOWED_ORIGINS.
  //
  // Esta sonda envía una petición SIMPLE (sin cabeceras propias y con el
  // Content-Type por defecto), que por definición no dispara preflight y
  // que el navegador no bloquea: la respuesta llega opaca pero la promesa
  // se resuelve. Por tanto:
  //   resuelve  → el servidor CONTESTA; el fallo real es CORS/política.
  //   rechaza   → el host no se alcanza (DNS, red caída, CSP connect-src).
  // ------------------------------------------------------------
  async function probeSignEndpoint() {
    try {
      await fetch(SIGN_URL, { method: 'POST', mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Recorta el cuerpo de una respuesta para el informe: lo justo para leer
  // el mensaje de error del servidor sin volcar una página HTML entera.
  const MAX_DETAIL_CHARS = 300;
  function trimDetail(text) {
    if (typeof text !== 'string') return '';
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > MAX_DETAIL_CHARS ? `${clean.slice(0, MAX_DETAIL_CHARS)}…` : clean;
  }

  async function readBodyForDiagnostics(response) {
    try { return trimDetail(await response.text()); } catch (e) { return ''; }
  }

  async function getSignature({ idToken, purpose, uid, forceRefresh, fileInfo }) {
    const key = cacheKey(purpose, uid);
    const cached = signatureCache.get(key);
    if (!forceRefresh && cached && Date.now() - cached.at < SIGNATURE_TTL_MS) return cached.payload;

    const startedAt = Date.now();
    let response;
    try {
      response = await fetch(SIGN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({ purpose }),
      });
    } catch (e) {
      // El navegador no dice si fue CORS o red. Se pregunta a la sonda.
      const reachable = await probeSignEndpoint();
      const code = reachable ? 'sign_cors' : 'sign_unreachable';
      const detail = reachable
        ? 'El servidor de firma respondió a una petición simple pero el navegador bloqueó la petición real: falta la cabecera Access-Control-Allow-Origin para ' + location.origin + ' (whitelist ALLOWED_ORIGINS del Worker) o el Worker devolvió un error sin cabeceras CORS.'
        : 'El host del servidor de firma no se alcanzó (DNS, red o connect-src del CSP). Mensaje del navegador: ' + (e && e.message ? e.message : 'sin detalle');
      recordDiagnostic({ stage: 'sign', code, status: 0, detail, file: fileInfo, ms: Date.now() - startedAt });
      throw new UploadError(
        reachable ? 'El servidor de firma rechazó este origen (CORS)' : 'No se pudo contactar con el servidor de firma',
        // CORS no se arregla reintentando: es configuración. Se corta ya
        // en lugar de gastar 3 intentos por archivo (21 esperas con 7
        // fotos) para acabar en el mismo sitio.
        { code, retryable: !reachable, stage: 'sign', detail }
      );
    }

    const ms = Date.now() - startedAt;
    if (!response.ok) {
      const detail = await readBodyForDiagnostics(response);
      const isAuth = response.status === 401 || response.status === 403;
      const code = isAuth ? 'unauthorized' : 'sign_failed';
      recordDiagnostic({ stage: 'sign', code, status: response.status, detail, file: fileInfo, ms });
      throw new UploadError(
        isAuth ? 'No autorizado para subir archivos' : 'No se pudo firmar la subida',
        { code, status: response.status, retryable: !isAuth && response.status >= 500, stage: 'sign', detail }
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (e) {
      const detail = 'El servidor de firma respondió 200 con un cuerpo que no es JSON.';
      recordDiagnostic({ stage: 'sign', code: 'sign_failed', status: response.status, detail, file: fileInfo, ms });
      throw new UploadError('El servidor de firma devolvió una respuesta ilegible', { code: 'sign_failed', status: response.status, retryable: true, stage: 'sign', detail });
    }
    // Una firma incompleta produce un 401 de Cloudinary imposible de
    // diagnosticar desde el otro lado. Se detecta aquí, donde sí se sabe
    // qué falta.
    const missing = ['signature', 'timestamp', 'apiKey', 'cloudName', 'folder'].filter(k => !payload || !payload[k]);
    if (missing.length > 0) {
      const detail = `Faltan campos en la firma: ${missing.join(', ')}. Revisa las variables de entorno del Worker.`;
      recordDiagnostic({ stage: 'sign', code: 'sign_failed', status: response.status, detail, file: fileInfo, ms });
      throw new UploadError('La firma recibida está incompleta', { code: 'sign_failed', status: response.status, retryable: false, stage: 'sign', detail });
    }
    signatureCache.set(key, { payload, at: Date.now() });
    return payload;
  }

  // ============================================================
  // Subida — XHR en vez de fetch por dos motivos concretos:
  //   1. `fetch` no expone el progreso de SUBIDA; en móvil, una barra
  //      parada 40 s se lee como "se colgó" y el usuario recarga la
  //      página a mitad de la publicación.
  //   2. XHR permite un temporizador de INACTIVIDAD (abortar solo si no
  //      avanza ni un byte), mucho mejor que un timeout total fijo: una
  //      subida lenta pero viva no debe abortarse nunca.
  // ============================================================
  function xhrUpload(url, formData, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let stallTimer = null;

      const armStallTimer = () => {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => {
          xhr.abort();
          reject(new UploadError('La subida se quedó sin avanzar', { code: 'timeout', retryable: true }));
        }, STALL_TIMEOUT_MS);
      };

      xhr.open('POST', url, true);
      // Se deja `responseType` por defecto ('text') a propósito: con
      // responseType='json', leer `responseText` lanza InvalidStateError,
      // y ese texto es justo lo que hace falta para explicar POR QUÉ
      // Cloudinary rechazó un archivo.

      xhr.upload.addEventListener('progress', e => {
        armStallTimer();
        if (e.lengthComputable && typeof onProgress === 'function') {
          onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        }
      });
      // El servidor ya está procesando: sigue vivo aunque no haya más
      // bytes de subida que enviar.
      xhr.upload.addEventListener('load', armStallTimer);

      xhr.addEventListener('load', () => {
        clearTimeout(stallTimer);
        const status = xhr.status;
        if (status >= 200 && status < 300) {
          const data = safeParse(xhr.responseText);
          if (!data || !data.secure_url) {
            reject(new UploadError('Cloudinary respondió sin URL', {
              code: 'bad_response', status, retryable: true, stage: 'upload',
              detail: trimDetail(xhr.responseText),
            }));
            return;
          }
          resolve(data);
          return;
        }
        const detail = describeCloudinaryError(xhr);
        // Un 401/403 de CLOUDINARY (no del Worker) significa firma
        // inválida o caducada, no falta de permisos: se reintenta con una
        // firma nueva. Distinguirlo importa, porque el mensaje que ve el
        // usuario y la acción correcta son opuestos.
        const isSignatureRejected = status === 401 || status === 403;
        reject(new UploadError(detail, {
          code: isSignatureRejected ? 'signature_rejected' : 'http',
          status,
          stage: 'upload',
          detail: trimDetail(xhr.responseText),
          // 429 (límite de peticiones) y 5xx sí merecen reintento; un 400
          // por archivo inválido, no: reintentarlo daría el mismo error.
          retryable: isSignatureRejected || status === 429 || status >= 500,
        }));
      });

      xhr.addEventListener('error', () => {
        clearTimeout(stallTimer);
        // XHR tampoco distingue CORS de caída de red, pero aquí la
        // ambigüedad es menor: api.cloudinary.com sí devuelve CORS
        // abierto, así que un `error` en esta etapa es casi siempre
        // transferencia interrumpida. Se etiqueta como etapa 'upload'
        // para no confundirlo nunca con el fallo del servidor de firma.
        reject(new UploadError('Fallo de red durante la transferencia del archivo', {
          code: 'network', retryable: true, stage: 'upload',
          detail: 'La petición a api.cloudinary.com terminó sin respuesta HTTP (transferencia interrumpida o bloqueo del navegador).',
        }));
      });
      xhr.addEventListener('abort', () => {
        clearTimeout(stallTimer);
        reject(new UploadError('Subida cancelada', { code: 'aborted', retryable: false, stage: 'upload' }));
      });

      armStallTimer();
      xhr.send(formData);
    });
  }

  function safeParse(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function describeCloudinaryError(xhr) {
    let body = null;
    try { body = safeParse(xhr.responseText); } catch (e) { /* respuesta ilegible */ }
    const message = body && body.error && body.error.message;
    return message ? `Cloudinary: ${message}` : `Cloudinary respondió ${xhr.status}`;
  }

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  /**
   * Sube un archivo con firma, compresión y reintentos.
   * @param {File}   file
   * @param {Object} options
   * @param {Function} options.getIdToken  devuelve el ID Token (se vuelve
   *        a pedir en cada intento: Firebase lo renueva si caducó).
   * @param {string} options.purpose       'vehicle' | 'profile'
   * @param {string} options.uid           solo para cachear la firma
   * @param {Function} options.onProgress  (percent:number) => void
   */
  async function uploadFile(file, options) {
    const { getIdToken, purpose = 'vehicle', uid = '', onProgress } = options || {};
    if (!navigator.onLine) {
      throw new UploadError('Sin conexión a internet', { code: 'offline', retryable: false });
    }

    const prepared = await prepareForUpload(file);
    // Se registra el archivo YA PREPARADO (tras comprimir): es lo que de
    // verdad viaja, y su tamaño es el dato que importa cuando hay que
    // decidir si el problema es el peso o la red.
    const fileInfo = {
      name: (prepared && prepared.name) || (file && file.name) || 'archivo',
      size: (prepared && prepared.size) || 0,
      type: (prepared && prepared.type) || '',
    };
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const attemptStartedAt = Date.now();
      try {
        const idToken = await getIdToken();
        // Tras un fallo de autorización se descarta la firma cacheada por
        // si el problema era precisamente una firma vieja.
        const signed = await getSignature({
          idToken, purpose, uid, fileInfo,
          forceRefresh: !!lastError && lastError.code === 'signature_rejected',
        });

        const formData = new FormData();
        formData.append('file', prepared);
        formData.append('api_key', signed.apiKey);
        formData.append('timestamp', signed.timestamp);
        formData.append('signature', signed.signature);
        formData.append('folder', signed.folder);
        if (signed.publicId) formData.append('public_id', signed.publicId);
        if (typeof signed.overwrite !== 'undefined') formData.append('overwrite', String(signed.overwrite));

        const data = await xhrUpload(
          `https://api.cloudinary.com/v1_1/${signed.cloudName}/auto/upload`,
          formData,
          onProgress
        );
        if (typeof onProgress === 'function') onProgress(100);
        return { url: data.secure_url, type: isVideoFile(file) ? 'video' : 'image' };
      } catch (error) {
        lastError = error instanceof UploadError
          ? error
          : new UploadError(error.message || 'Error desconocido', { code: 'unknown', retryable: true });
        lastError.attempt = attempt;
        lastError.fileInfo = fileInfo;
        // Los fallos de la etapa de firma ya se registraron con su status
        // y su cuerpo dentro de getSignature. Aquí se registra el resto
        // (transferencia, respuesta de Cloudinary) para que el informe
        // recoja la cadena completa, no solo el último eslabón.
        if (lastError.stage !== 'sign') {
          recordDiagnostic({
            stage: lastError.stage || 'upload',
            code: lastError.code,
            status: lastError.status || 0,
            detail: lastError.detail || lastError.message,
            file: fileInfo,
            attempt,
            ms: Date.now() - attemptStartedAt,
          });
        }
        if (lastError.code === 'signature_rejected') invalidateSignatures();
        if (!lastError.retryable || attempt === MAX_ATTEMPTS) throw lastError;
        console.warn(`Subida fallida (intento ${attempt}/${MAX_ATTEMPTS}) [${lastError.stage}/${lastError.code}${lastError.status ? ' HTTP ' + lastError.status : ''}]: ${lastError.message}`, lastError.detail || '');
        await wait(RETRY_BASE_MS * Math.pow(2, attempt - 1));
      }
    }
    throw lastError;
  }

  // ============================================================
  // Wake Lock — impide que la pantalla se apague a mitad de la subida.
  // Sin esto, en Android la publicación se quedaba a medias al bloquear
  // el teléfono mientras se subían las diez fotos.
  // ============================================================
  let wakeLock = null;
  let wakeLockHolders = 0;

  async function acquireWakeLock() {
    wakeLockHolders++;
    if (wakeLock || !('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) {
      wakeLock = null; // permiso denegado o batería baja: no es crítico
    }
  }

  function releaseWakeLock() {
    wakeLockHolders = Math.max(0, wakeLockHolders - 1);
    if (wakeLockHolders > 0 || !wakeLock) return;
    try { wakeLock.release(); } catch (e) { /* ya liberado */ }
    wakeLock = null;
  }

  // Si el usuario cambia de app y vuelve, el Wake Lock se pierde: se
  // vuelve a pedir mientras siga habiendo una subida en curso.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && wakeLockHolders > 0 && !wakeLock) {
      wakeLockHolders--;          // acquireWakeLock vuelve a sumarlo
      acquireWakeLock();
    }
  });

  // ============================================================
  // Traducción de errores a algo accionable para quien publica.
  // ============================================================
  function describeError(error, context) {
    const position = context && context.index
      ? ` (archivo ${context.index} de ${context.total})`
      : '';
    switch (error && error.code) {
      case 'offline':
        return '❌ Sin conexión a internet — conéctate y vuelve a intentarlo';
      case 'unauthorized':
        return '❌ Tu sesión caducó o no tienes permiso — cierra sesión y vuelve a entrar';
      case 'signature_rejected':
        return `❌ La autorización de subida caducó${position} — vuelve a pulsar Publicar`;
      case 'timeout':
        return `❌ La conexión es demasiado lenta${position} — inténtalo con mejor señal o con menos fotos`;
      // Antes este mensaje ("se perdió la conexión") lo daban también los
      // fallos del servidor de firma, que NO son de conexión. Ahora solo
      // lo da la transferencia real del archivo.
      case 'network':
        return `❌ Se cortó la transferencia del archivo${position} — las fotos ya subidas se conservan, vuelve a pulsar Publicar`;
      case 'sign_unreachable':
        return '❌ No se pudo contactar con el servidor de subidas — comprueba tu conexión y vuelve a intentarlo';
      // Configuración, no conexión: reintentar no sirve de nada y decirle
      // al usuario que lo intente otra vez es mentirle.
      case 'sign_cors':
        return '❌ El servidor de subidas está rechazando este sitio — es un problema de configuración, no de tu conexión. Avisa al administrador (detalles técnicos abajo).';
      case 'http':
        return `❌ El servidor rechazó el archivo${position} — prueba con otra foto o vídeo`;
      case 'bad_response':
      case 'sign_failed':
        return `❌ El servidor de subidas no respondió correctamente${position} — inténtalo de nuevo`;
      default:
        return `❌ No se pudieron subir las fotos${position} — inténtalo de nuevo`;
    }
  }

  // Línea técnica de UN error, para listarlo junto al archivo que falló.
  // Es lo que convierte "no se pudo subir" en algo accionable.
  function describeTechnical(error) {
    if (!error) return 'Error desconocido';
    const stage = error.stage === 'sign' ? 'firma' : error.stage === 'upload' ? 'subida' : '—';
    const status = error.status ? `HTTP ${error.status}` : 'sin respuesta HTTP';
    return `[${stage} · ${error.code || 'desconocido'} · ${status}] ${error.detail || error.message || ''}`.trim();
  }

  window.LBMedia = {
    UploadError,
    isVideoFile,
    isImageFile,
    isHeic,
    prepareForUpload,
    uploadFile,
    invalidateSignatures,
    acquireWakeLock,
    releaseWakeLock,
    describeError,
    describeTechnical,
    getDiagnostics,
    getDiagnosticsReport,
  };
})();
