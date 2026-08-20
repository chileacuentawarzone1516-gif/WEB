// ============================================================
// CLOUDINARY-SIGN WORKER
// ------------------------------------------------------------
// Firma subidas a Cloudinary para dos propósitos distintos, cada uno
// con su propia autorización y carpeta — ambas 100% decididas por el
// servidor, nunca por el cliente:
//
//   purpose: "vehicle" (por defecto) → requiere role: admin|editor y
//   status: active. Carpeta fija: "labatalla".
//
//   purpose: "profile" → cualquier usuario con status: active (sin
//   importar su role) puede subir SU PROPIA foto de perfil. Carpeta
//   fija: "labatalla/perfiles", con public_id = uid del token
//   verificado — así cada usuario solo puede sobrescribir su propia
//   foto (Cloudinary reemplaza el archivo anterior automáticamente al
//   subir con el mismo public_id, sin necesitar un endpoint de borrado
//   aparte ni exponer una superficie nueva de eliminación).
//
// Seguridad:
// - Verificación completa del Firebase ID Token (RS256 + JWKS de Google)
// - uid extraído SOLO del token verificado (nunca del cliente)
// - Autorización delegada a Firestore Rules (lectura con el propio ID Token)
// - CORS restringido por whitelist (ALLOWED_ORIGINS)
// - El cliente SOLO puede elegir "purpose" de una lista cerrada de 2
//   valores — jamás folder, cloudName, apiKey, uid, role, status ni
//   public_id directamente. Todo lo demás sale del servidor.
// ============================================================

// ------------------------------------------------------------
// Configuración fija (no configurable por el cliente)
// ------------------------------------------------------------
const UPLOAD_FOLDER = 'labatalla';
const PROFILE_PHOTO_FOLDER = 'labatalla/perfiles';
const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const FIREBASE_ISSUER_PREFIX = 'https://securetoken.google.com/';
const REQUIRED_ENV_VARS = Object.freeze([
  'FIREBASE_PROJECT_ID',
  'ALLOWED_ORIGINS',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
]);
// Roles autorizados a firmar subidas. Se define aquí (en vez de dentro
// de isUserAuthorized) para no recrear el array en cada invocación.
const ALLOWED_ROLES = Object.freeze(['admin', 'editor']);

// ------------------------------------------------------------
// Errores tipados: permiten mapear cada fallo a un status HTTP
// concreto sin filtrar detalles internos al cliente.
// ------------------------------------------------------------
class TokenVerificationError extends Error {}

class ProfileAccessError extends Error {
  constructor(message, httpStatus) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

// ------------------------------------------------------------
// Helpers de respuesta — toda respuesta es JSON, nunca texto plano.
// ------------------------------------------------------------
function jsonSuccess(payload, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function jsonError(message, status, corsHeaders) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

// ------------------------------------------------------------
// Validación de entorno
// ------------------------------------------------------------
function findMissingEnvVars(env) {
  return REQUIRED_ENV_VARS.filter((key) => !env[key]);
}

// ------------------------------------------------------------
// CORS: whitelist estricta, sin comodines (nada de "*").
// ------------------------------------------------------------
function resolveOrigin(request, env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.get('Origin') || '';
  const isAllowed = allowedOrigins.includes(requestOrigin);
  return { isAllowed, origin: requestOrigin };
}

function buildCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ------------------------------------------------------------
// Utilidades Base64Url
// ------------------------------------------------------------
function base64UrlToUint8Array(base64Url) {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLength);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlToJson(base64Url) {
  const bytes = base64UrlToUint8Array(base64Url);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// ------------------------------------------------------------
// Claves públicas de Google (JWKS) — únicos datos cacheables.
// Roles, status y perfiles de Firestore NUNCA se cachean: un
// administrador puede revocar permisos y debe surtir efecto de
// inmediato en la siguiente petición.
// ------------------------------------------------------------
async function fetchGooglePublicKeys() {
  const cache = caches.default;
  const cacheKey = new Request(GOOGLE_JWKS_URL);

  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(GOOGLE_JWKS_URL, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok) {
      throw new Error('No se pudieron obtener las claves públicas de Google');
    }
    // El fetch ya fue exitoso: un fallo al escribir en caché (por ejemplo,
    // si Google cambiara las cabeceras Cache-Control a no-cacheables) no
    // debe impedir usar las claves ya obtenidas para verificar el token
    // de esta petición. Sin este aislamiento, un fallo de caché derribaría
    // la verificación de tokens para todos los usuarios.
    try {
      await cache.put(cacheKey, response.clone());
    } catch (cacheError) {
      console.error('No se pudo cachear el JWKS (se continúa sin caché):', cacheError.message);
    }
  }

  const { keys } = await response.json();
  return keys;
}

// ------------------------------------------------------------
// Verificación completa del Firebase ID Token
// ------------------------------------------------------------
function parseJwtParts(idToken) {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new TokenVerificationError('Formato de token inválido');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  return {
    headerB64,
    payloadB64,
    signatureB64,
    header: base64UrlToJson(headerB64),
    payload: base64UrlToJson(payloadB64),
  };
}

function validateTokenClaims(header, payload, projectId) {
  const now = Math.floor(Date.now() / 1000);

  if (header.alg !== 'RS256') {
    throw new TokenVerificationError('Algoritmo de firma no soportado');
  }
  if (!header.kid) {
    throw new TokenVerificationError('Token sin identificador de clave (kid)');
  }
  if (payload.iss !== FIREBASE_ISSUER_PREFIX + projectId) {
    throw new TokenVerificationError('Emisor del token inválido');
  }
  if (payload.aud !== projectId) {
    throw new TokenVerificationError('Audiencia del token inválida');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw new TokenVerificationError('Token expirado');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + 60) {
    throw new TokenVerificationError('Token emitido en el futuro');
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new TokenVerificationError('Token sin uid (sub)');
  }
  // auth_time: momento en que el usuario se autenticó por última vez.
  // Google lo incluye en la lista oficial de verificaciones recomendadas
  // para ID Tokens; debe ser numérico y no estar en el futuro.
  if (typeof payload.auth_time !== 'number' || payload.auth_time > now + 60) {
    throw new TokenVerificationError('auth_time inválido');
  }
}

async function verifySignature(headerB64, payloadB64, signatureB64, kid) {
  const keys = await fetchGooglePublicKeys();
  const jwk = keys.find((key) => key.kid === kid);
  if (!jwk) {
    throw new TokenVerificationError('Clave pública no encontrada para este token');
  }

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(signatureB64);
  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    signatureBytes,
    signedData
  );

  if (!isValid) {
    throw new TokenVerificationError('Firma del token inválida');
  }
}

async function verifyFirebaseIdToken(idToken, projectId) {
  const { headerB64, payloadB64, signatureB64, header, payload } = parseJwtParts(idToken);
  validateTokenClaims(header, payload, projectId);
  await verifySignature(headerB64, payloadB64, signatureB64, header.kid);
  return { uid: payload.sub };
}

// ------------------------------------------------------------
// Perfil de usuario en Firestore — lectura en vivo con el ID Token
// del propio usuario. La autorización real vive en Firestore Rules,
// no en este Worker: aquí solo interpretamos el resultado.
// ------------------------------------------------------------
async function fetchUserProfile(uid, idToken, projectId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (response.status === 404) {
    // El documento no existe: se trata como "no autorizado".
    return null;
  }
  if (response.status === 403) {
    // Firestore Rules denegaron la lectura: no autorizado.
    return null;
  }
  if (!response.ok) {
    throw new ProfileAccessError(`Firestore respondió ${response.status}`, 500);
  }

  const document = await response.json();
  const fields = document.fields || {};
  return {
    role: fields.role?.stringValue ?? null,
    status: fields.status?.stringValue ?? null,
  };
}

function isUserAuthorized(profile, purpose) {
  if (!profile || profile.status !== 'active') return false;
  if (purpose === 'profile') return true; // cualquier usuario activo puede subir SU propia foto
  return ALLOWED_ROLES.includes(profile.role); // "vehicle": solo staff
}

// ------------------------------------------------------------
// Firma de Cloudinary
// ------------------------------------------------------------
async function signCloudinaryUpload(env, purpose, uid) {
  const timestamp = Math.floor(Date.now() / 1000);

  // El orden alfabético de los parámetros a firmar es OBLIGATORIO para
  // Cloudinary. Para "profile" son 4 parámetros (folder, overwrite,
  // public_id, timestamp — ya alfabético); para "vehicle" siguen
  // siendo solo 2, exactamente como antes.
  const isProfile = purpose === 'profile';
  const sortedParamString = isProfile
    ? `folder=${PROFILE_PHOTO_FOLDER}&overwrite=true&public_id=${uid}&timestamp=${timestamp}`
    : `folder=${UPLOAD_FOLDER}&timestamp=${timestamp}`;

  const dataToHash = new TextEncoder().encode(sortedParamString + env.CLOUDINARY_API_SECRET);
  const hashBuffer = await crypto.subtle.digest('SHA-1', dataToHash);
  const signature = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  const payload = {
    signature,
    timestamp,
    apiKey: env.CLOUDINARY_API_KEY,
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    folder: isProfile ? PROFILE_PHOTO_FOLDER : UPLOAD_FOLDER,
  };
  if (isProfile) {
    payload.publicId = uid;
    payload.overwrite = true;
  }
  return payload;
}

// ------------------------------------------------------------
// Extracción del Bearer token
// ------------------------------------------------------------
function extractBearerToken(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  return match ? match[1] : null;
}

// ------------------------------------------------------------
// Validación de Content-Type: solo se exige si la petición trae
// cuerpo. Este endpoint no necesita body (todo el estado sale del
// servidor), pero si el cliente envía uno, debe declararse JSON.
// ------------------------------------------------------------
function hasInvalidContentType(request) {
  const contentLength = request.headers.get('Content-Length');
  const hasBody = contentLength && contentLength !== '0';
  if (!hasBody) return false;

  const contentType = request.headers.get('Content-Type') || '';
  return !contentType.toLowerCase().includes('application/json');
}

// ------------------------------------------------------------
// Handler principal
// ------------------------------------------------------------
export default {
  async fetch(request, env) {
    const { isAllowed, origin } = resolveOrigin(request, env);

    // Origen fuera de la whitelist: se corta aquí, sin CORS y sin
    // procesar nada más (ni token, ni Firestore, ni Cloudinary).
    if (!isAllowed) {
      return jsonError('Origen no permitido', 403, { 'Vary': 'Origin' });
    }

    const corsHeaders = buildCorsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    if (request.method !== 'POST') {
      return jsonError('Método no permitido', 405, corsHeaders);
    }

    const missingEnvVars = findMissingEnvVars(env);
    if (missingEnvVars.length > 0) {
      // El detalle (qué variable falta) solo va a los logs del servidor.
      // Al cliente se le da un mensaje genérico: listar nombres de
      // variables de entorno en la respuesta HTTP es una fuga de
      // información de configuración interna, explotable por cualquiera
      // que golpee el endpoint desde un origin permitido, sin necesidad
      // de token válido.
      console.error('Variables de entorno faltantes:', missingEnvVars.join(', '));
      return jsonError('Error de configuración del servidor', 500, corsHeaders);
    }

    if (hasInvalidContentType(request)) {
      return jsonError('Content-Type debe ser application/json', 415, corsHeaders);
    }

    // Único dato que se lee del cliente: "purpose", validado contra una
    // lista cerrada de 2 valores. Cualquier otra cosa en el body se
    // ignora — nunca decide folder, public_id, ni nada sensible.
    let purpose = 'vehicle';
    try {
      const rawBody = await request.text();
      if (rawBody) {
        const parsed = JSON.parse(rawBody);
        if (parsed && parsed.purpose === 'profile') purpose = 'profile';
      }
    } catch (error) {
      // Body inválido no es fatal: simplemente se ignora y se usa el
      // propósito por defecto ("vehicle"), igual que si no hubiera body.
      console.error('Body no parseable, se usa purpose por defecto:', error.message);
    }

    const idToken = extractBearerToken(request);
    if (!idToken) {
      return jsonError('Falta el token de autenticación', 401, corsHeaders);
    }

    let uid;
    try {
      ({ uid } = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID));
    } catch (error) {
      console.error('Fallo al verificar el token:', error.message);
      return jsonError('Token inválido o expirado', 401, corsHeaders);
    }

    let profile;
    try {
      profile = await fetchUserProfile(uid, idToken, env.FIREBASE_PROJECT_ID);
    } catch (error) {
      console.error('Fallo al leer el perfil en Firestore:', error.message);
      const status = error instanceof ProfileAccessError ? error.httpStatus : 500;
      return jsonError('No se pudo verificar tu perfil', status, corsHeaders);
    }

    if (!isUserAuthorized(profile, purpose)) {
      return jsonError('No autorizado para subir archivos', 403, corsHeaders);
    }

    try {
      const signedPayload = await signCloudinaryUpload(env, purpose, uid);
      return jsonSuccess(signedPayload, corsHeaders);
    } catch (error) {
      console.error('Fallo al generar la firma de Cloudinary:', error.message);
      return jsonError('Error generando firma', 500, corsHeaders);
    }
  },
};
