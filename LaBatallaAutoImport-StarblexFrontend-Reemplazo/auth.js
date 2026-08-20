// ============================================================
// AUTH.JS — Capa de autenticación, SOLO lógica. Cero DOM.
//
// API PÚBLICA:
//   registerUser(email, password, name, remember?)
//   loginUser(email, password, remember?)
//   loginWithGoogle(remember?)
//   logoutUser()
//   updateUserProfile(fields)         → edición de perfil (Problema 6)
//   changePassword(currentPw, newPw)  → cambio de contraseña (Fase 1.5)
//   toggleFavoriteRemote(vehicleId, isFav)  → favoritos sincronizados
//   getFavoritesRemote()
//   addHistoryEntry(vehicleId)        → historial sincronizado
//   getHistoryRemote()
//   deleteHistoryEntry(entryId)
//   saveQuote(quoteData)              → cotizaciones (Fase 1.4)
//   getQuotesRemote()
//   deleteQuote(quoteId)
//   savePreferences(prefs)            → preferencias (Fase 1.6)
//   getPreferences()
//   sendResetPassword(email)          → vía mailer (Fase 8)
//   sendVerificationEmail()           → vía mailer (Fase 8)
//   refreshCurrentUser()
//   getCurrentUser()
//   waitForAuthReady(timeoutMs?)
//   onUserChanged(callback)
//
// ⚠️ EVENTOS: registerUser/loginUser/loginWithGoogle actualizan
// authState pero NO notifican — onAuthStateChanged es la ÚNICA fuente
// de eventos de sesión (evita doble render). refreshCurrentUser() SÍ
// notifica (su cambio viene de Firestore, no de Auth).
//
// NO tocar desde otros archivos: authState, _authListeners,
// _authUnsubscribe. Todo pasa por la API pública.
// ============================================================

// ============================================================
// INSTRUMENTACIÓN TEMPORAL DE QA — apagada por defecto (cero impacto,
// cero console.log en producción). Activar desde la consola del
// navegador: localStorage.setItem('auth_debug','1') y recargar.
// Para retirarla del todo: eliminar este bloque y las llamadas a
// authLog()/countFirestoreOp() — todas usan estos mismos nombres,
// fáciles de ubicar con grep.
// ============================================================
const AUTH_DEBUG = (() => { try { return localStorage.getItem('auth_debug') === '1'; } catch (e) { return false; } })();
const authDebugStats = { firestoreReads: 0, firestoreWrites: 0 };
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '(sin correo)';
  const [user, domain] = email.split('@');
  const visible = user.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}
function authLog(...args) { if (AUTH_DEBUG) console.log('%c[AUTH-QA]', 'color:#38bdf8;font-weight:bold', ...args); }
function countFirestoreOp(kind) {
  if (!AUTH_DEBUG) return; // inerte por completo cuando la instrumentación está apagada
  if (kind === 'read') authDebugStats.firestoreReads++;
  if (kind === 'write') authDebugStats.firestoreWrites++;
  authLog(`Firestore ${kind} #${kind === 'read' ? authDebugStats.firestoreReads : authDebugStats.firestoreWrites}`);
}
// Consulta manual desde la consola: window.__authDebugStats()
if (AUTH_DEBUG) window.__authDebugStats = () => ({ ...authDebugStats });

const authState = { ready: false, initialized: false, user: null, profile: null };
let _authUnsubscribe = null;
let _authListeners = [];

const AUTH_PROVIDERS = Object.freeze({ PASSWORD: 'password', GOOGLE: 'google.com' });

function mapAuthError(code) {
  const messages = {
    'auth/email-already-in-use': 'Ese correo ya está registrado.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
    'auth/user-not-found': 'No existe una cuenta con ese correo.',
    'auth/wrong-password': 'Correo o contraseña incorrectos.',
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
    'auth/user-disabled': 'Esta cuenta fue deshabilitada.',
    'auth/network-request-failed': 'Sin conexión — verifica tu internet e intenta de nuevo.',
    'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
    'auth/popup-blocked': 'Tu navegador bloqueó la ventana emergente — permite pop-ups para este sitio.',
    'auth/account-exists-with-different-credential': 'Ese correo ya tiene cuenta con otro método de acceso.',
  };
  return messages[code] || 'Ocurrió un error. Intenta de nuevo.';
}
// Incluye el código técnico al final: convierte cada fallo en algo
// diagnosticable sin abrir la consola (Fase 1 — antes el mensaje
// genérico ocultaba si era permission-denied, unavailable, etc.).
function mapFirestoreError(code) {
  const messages = {
    'permission-denied': 'El servidor rechazó la operación — si acabas de registrarte, es probable que las reglas de Firestore desplegadas no incluyan la colección users.',
    'unavailable': 'Firestore no responde ahora mismo — intenta de nuevo.',
    'deadline-exceeded': 'La operación tardó demasiado — intenta de nuevo.',
    'aborted': 'La operación fue interrumpida — intenta de nuevo.',
  };
  const base = messages[code] || 'Ocurrió un error guardando tus datos. Intenta de nuevo.';
  return code ? `${base} (código: ${code})` : base;
}

function getCurrentUser() {
  return { user: authState.user, profile: authState.profile };
}
function notifyAuthListeners() {
  const state = getCurrentUser();
  for (const cb of [..._authListeners]) {
    try { cb(state); } catch (e) { console.error('Error en listener de onUserChanged:', e); }
  }
}

// ------------------------------------------------------------
// MAILER (Fase 8) — punto único de envío de correos. Hoy delega en
// los correos integrados de Firebase; para migrar a Resend/SendGrid/
// Brevo, se reemplaza el cuerpo de estas funciones (y se agrega la
// llamada al backend propio) sin tocar ningún otro archivo.
// ------------------------------------------------------------
const mailer = {
  async sendVerification(user) {
    await user.sendEmailVerification();
  },
  async sendPasswordReset(email) {
    await firebase.auth().sendPasswordResetEmail(email);
  },
  // Previsto para el futuro proveedor externo (bienvenida, notificaciones).
  async sendWelcome(/* user */) { /* pendiente de proveedor externo */ },
};

// ------------------------------------------------------------
// Persistencia: remember=true → sobrevive al cierre del navegador
// (LOCAL); remember=false → solo la pestaña actual (SESSION).
// ------------------------------------------------------------
async function applyPersistence(remember) {
  const mode = remember
    ? firebase.auth.Auth.Persistence.LOCAL
    : firebase.auth.Auth.Persistence.SESSION;
  try { await firebase.auth().setPersistence(mode); }
  catch (e) { console.error('No se pudo aplicar persistencia:', e); /* no bloquea el login */ }
}

// ------------------------------------------------------------
// Perfil (Firestore)
// ------------------------------------------------------------
const RETRYABLE_FIRESTORE_CODES = ['unavailable', 'deadline-exceeded', 'aborted'];

// Idempotente (transacción get+set atómica) y con UN reintento
// automático ante errores transitorios de red/servidor. Devuelve el
// documento releído tras escribir: dentro de la transacción createdAt
// aún es el sentinel serverTimestamp(), no un Timestamp usable.
async function createUserProfile(user, name, provider) {
  authLog('createUserProfile()', { uid: user.uid, provider });
  const ref = db.collection('users').doc(user.uid);
  const attempt = async () => {
    let created = false;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      countFirestoreOp('read');
      if (snap.exists) { created = false; return; }
      created = true;
      countFirestoreOp('write');
      tx.set(ref, {
        email: user.email,
        name: name,
        role: ROLES.CUSTOMER,
        status: STATUS.ACTIVE,
        provider: provider || AUTH_PROVIDERS.PASSWORD,
        photoURL: user.photoURL || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        schemaVersion: 1,
      });
    });
    const fresh = await ref.get();
    return { success: true, profile: fresh.data(), alreadyExisted: !created };
  };
  try {
    return await attempt();
  } catch (e) {
    if (RETRYABLE_FIRESTORE_CODES.includes(e.code)) {
      console.warn('createUserProfile: error transitorio, reintentando en 1s...', e.code);
      await new Promise(r => setTimeout(r, 1000));
      try { return await attempt(); } catch (e2) {
        console.error('Error creando perfil (tras reintento):', e2);
        return { success: false, code: e2.code, message: mapFirestoreError(e2.code) };
      }
    }
    console.error('Error creando perfil de usuario:', e);
    return { success: false, code: e.code, message: mapFirestoreError(e.code) };
  }
}

async function getCurrentUserProfile(uid) {
  authLog('getCurrentUserProfile()', { uid });
  try {
    const docSnap = await db.collection('users').doc(uid).get();
    countFirestoreOp('read');
    if (!docSnap.exists) return { success: false, code: 'profile-not-found', message: 'No se encontró tu perfil.' };
    return { success: true, profile: docSnap.data() };
  } catch (e) {
    console.error('Error leyendo perfil de usuario:', e);
    return { success: false, code: e.code, message: mapFirestoreError(e.code) };
  }
}

async function refreshCurrentUser() {
  if (!authState.user) return { success: false, code: 'no-user', message: 'No hay sesión activa.' };
  const result = await getCurrentUserProfile(authState.user.uid);
  if (result.success) {
    authState.profile = result.profile;
    notifyAuthListeners();
  }
  return result;
}

// Carga el perfil, con recuperación automática si existe Auth pero no
// el documento (registro que falló a medias). Compartido por email y
// Google — una sola implementación (Fase 10). isNewUser distingue si
// este perfil se acaba de crear ahora mismo (para el mensaje de
// bienvenida) de si ya existía de antes.
async function resolveProfileOrRecover(user, fallbackName, provider) {
  let profileResult = await getCurrentUserProfile(user.uid);
  if (!profileResult.success && profileResult.code === 'profile-not-found') {
    const created = await createUserProfile(user, fallbackName, provider);
    if (!created.success) return created;
    return { success: true, profile: created.profile, isNewUser: !created.alreadyExisted };
  }
  return { success: true, profile: profileResult.profile, isNewUser: false };
}

// Rechaza cuentas disabled/pending con cierre de sesión inmediato —
// mejor un mensaje claro que entrar y que todo falle por permisos.
async function enforceActiveStatus(profile) {
  authLog('enforceActiveStatus()', { role: profile.role, status: profile.status });
  if (profile.status === STATUS.ACTIVE) return null;
  await firebase.auth().signOut();
  return {
    success: false,
    code: 'user-' + profile.status,
    message: profile.status === STATUS.DISABLED
      ? 'Esta cuenta fue deshabilitada. Contacta a soporte.'
      : 'Tu cuenta está pendiente de aprobación.'
  };
}

// ------------------------------------------------------------
// Sesión (Firebase Auth)
// ------------------------------------------------------------
async function registerUser(email, password, name, remember = true) {
  authLog('registerUser() — inicio', { email: maskEmail(email), remember });
  try {
    await applyPersistence(remember);
    const cred = await firebase.auth().createUserWithEmailAndPassword(email, password);
    const profileResult = await createUserProfile(cred.user, name, AUTH_PROVIDERS.PASSWORD);
    if (!profileResult.success) {
      await firebase.auth().signOut();
      return { success: false, code: profileResult.code || 'profile-creation-failed',
        message: profileResult.message || 'Tu cuenta se creó, pero hubo un problema guardando tu perfil. Intenta iniciar sesión de nuevo en unos segundos.' };
    }
    // Verificación de correo (Fase 6): se envía sin bloquear el registro —
    // si falla, el usuario puede reenviar desde su panel.
    try { await mailer.sendVerification(cred.user); }
    catch (e) { console.error('No se pudo enviar el correo de verificación:', e); }

    authState.user = cred.user;
    authState.profile = profileResult.profile;
    return { success: true, user: cred.user, profile: profileResult.profile, verificationSent: true, isNewUser: true };
  } catch (e) {
    console.error('Error registrando usuario:', e);
    return { success: false, code: e.code, message: mapAuthError(e.code) };
  }
}

async function loginUser(email, password, remember = true) {
  authLog('loginUser() — inicio', { email: maskEmail(email), remember });
  try {
    await applyPersistence(remember);
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    const profileResult = await resolveProfileOrRecover(
      cred.user,
      cred.user.displayName || (cred.user.email ? cred.user.email.split('@')[0] : 'Cliente'),
      AUTH_PROVIDERS.PASSWORD
    );
    if (!profileResult.success) return profileResult;

    // Registra el momento de este login — no crítico: si falla, el
    // usuario igual entra (el dato de "último acceso" es informativo).
    try {
      await db.collection('users').doc(cred.user.uid).update({
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
      });
      countFirestoreOp('write');
      profileResult.profile = { ...profileResult.profile, lastLogin: firebase.firestore.Timestamp.now() };
    } catch (e) {
      console.error('No se pudo actualizar lastLogin (no crítico):', e);
    }

    const blocked = await enforceActiveStatus(profileResult.profile);
    if (blocked) return blocked;

    authState.user = cred.user;
    authState.profile = profileResult.profile;
    // isNewUser siempre false aquí: el formulario de login exige una
    // contraseña de una cuenta ya existente — incluso en el caso raro
    // de recuperación (Auth existe pero el doc de Firestore se perdió),
    // semánticamente el usuario YA nos conocía, no es su primera vez.
    return { success: true, user: cred.user, profile: profileResult.profile, isNewUser: false };
  } catch (e) {
    console.error('Error iniciando sesión:', e);
    return { success: false, code: e.code, message: mapAuthError(e.code) };
  }
}

// Fase 3: Google Sign-In. Si el perfil ya existe, NO se sobrescribe —
// solo se actualizan photoURL/provider si cambiaron (merge dirigido).
async function loginWithGoogle(remember = true) {
  authLog('loginWithGoogle() — inicio', { remember });
  try {
    await applyPersistence(remember);
    const provider = new firebase.auth.GoogleAuthProvider();
    // Fuerza SIEMPRE el selector de cuentas de Google, incluso si el
    // navegador ya tiene una sesión de Google activa. Sin esto, Google
    // puede reautenticar en silencio con la última cuenta usada y saltarse
    // la pantalla de selección — el usuario nunca puede elegir otra cuenta.
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await firebase.auth().signInWithPopup(provider);
    const user = cred.user;

    const profileResult = await resolveProfileOrRecover(
      user,
      user.displayName || (user.email ? user.email.split('@')[0] : 'Cliente'),
      AUTH_PROVIDERS.GOOGLE
    );
    if (!profileResult.success) return profileResult;

    // Merge dirigido para perfiles pre-existentes: lastLogin se
    // actualiza SIEMPRE (registro de acceso); photoURL, provider y name
    // solo si Google trae datos distintos a los guardados. email/role/
    // status/createdAt jamás se tocan aquí.
    const googleUpdates = { lastLogin: firebase.firestore.FieldValue.serverTimestamp() };
    if (user.photoURL && profileResult.profile.photoURL !== user.photoURL) {
      googleUpdates.photoURL = user.photoURL;
    }
    if (profileResult.profile.provider !== AUTH_PROVIDERS.GOOGLE) {
      googleUpdates.provider = AUTH_PROVIDERS.GOOGLE;
    }
    if (user.displayName && profileResult.profile.name !== user.displayName) {
      googleUpdates.name = user.displayName;
    }
    try {
      await db.collection('users').doc(user.uid).update(googleUpdates);
      countFirestoreOp('write');
      profileResult.profile = { ...profileResult.profile, ...googleUpdates, lastLogin: firebase.firestore.Timestamp.now() };
    } catch (e) {
      console.error('No se pudo actualizar metadatos de Google (no crítico):', e);
    }

    const blocked = await enforceActiveStatus(profileResult.profile);
    if (blocked) return blocked;

    authState.user = user;
    authState.profile = profileResult.profile;
    return { success: true, user, profile: profileResult.profile, isNewUser: profileResult.isNewUser };
  } catch (e) {
    console.error('Error con Google Sign-In:', e);
    return { success: false, code: e.code, message: mapAuthError(e.code) };
  }
}

async function logoutUser() {
  try {
    await firebase.auth().signOut();
    return { success: true };
  } catch (e) {
    console.error('Error cerrando sesión:', e);
    return { success: false, code: e.code, message: mapAuthError(e.code) };
  }
}

// Problema 6 / Auditoría 4: edición de perfil. Whitelist explícita —
// jamás incluye role/status/createdAt/schemaVersion/uid/provider/email,
// así que ni por error se podrían escalar permisos ni suplantar el
// email desde aquí, aunque además firestore.rules ya lo bloquea de
// forma independiente (defensa en profundidad: cliente Y servidor).
const EDITABLE_PROFILE_FIELDS = Object.freeze(['name', 'lastName', 'username', 'city', 'phone', 'photoURL', 'address', 'country']);

async function updateUserProfile(fields) {
  if (!authState.user) return { success: false, code: 'no-user', message: 'No hay sesión activa.' };

  const updates = {};
  for (const key of EDITABLE_PROFILE_FIELDS) {
    if (key in fields) updates[key] = typeof fields[key] === 'string' ? fields[key].trim() : fields[key];
  }
  if ('name' in updates && !updates.name) {
    return { success: false, code: 'invalid-name', message: 'El nombre no puede quedar vacío.' };
  }
  if ('photoURL' in updates && updates.photoURL && !/^https?:\/\//.test(updates.photoURL)) {
    return { success: false, code: 'invalid-photo-url', message: 'La foto debe ser un enlace http(s) válido.' };
  }
  if (Object.keys(updates).length === 0) {
    return { success: false, code: 'no-fields', message: 'No hay cambios para guardar.' };
  }

  try {
    await db.collection('users').doc(authState.user.uid).update(updates);
    countFirestoreOp('write');
    authState.profile = { ...authState.profile, ...updates };
    notifyAuthListeners(); // refresca cualquier UI que dependa del perfil (avatar, nombre, etc.)
    return { success: true, profile: authState.profile };
  } catch (e) {
    console.error('Error actualizando perfil:', e);
    return { success: false, code: e.code, message: mapFirestoreError(e.code) };
  }
}

async function sendResetPassword(email) {
  try {
    await mailer.sendPasswordReset(email);
    return { success: true };
  } catch (e) {
    console.error('Error enviando correo de recuperación:', e);
    return { success: false, code: e.code, message: mapAuthError(e.code) };
  }
}

// Fase 6: reenvío de verificación para el usuario con sesión activa.
async function sendVerificationEmail() {
  if (!authState.user) return { success: false, code: 'no-user', message: 'No hay sesión activa.' };
  if (authState.user.emailVerified) return { success: true, alreadyVerified: true };
  try {
    await mailer.sendVerification(authState.user);
    return { success: true };
  } catch (e) {
    console.error('Error enviando verificación:', e);
    return { success: false, code: e.code, message: mapAuthError(e.code) };
  }
}

// ------------------------------------------------------------
// Ciclo de vida / suscripción
// ------------------------------------------------------------
// ============================================================
// PASO 2 — Administradores por lista blanca de correo (Firebase Auth)
// ------------------------------------------------------------
// El acceso admin YA NO depende de ningún botón oculto ni variable
// local — depende exclusivamente de si el correo autenticado está en
// esta whitelist. Esta lista es solo el LADO CLIENTE (dispara el
// intento de auto-promoción); la autorización real y la que de verdad
// importa vive en firestore.rules, que tiene la MISMA whitelist
// hardcodeada del lado del servidor. Si alguien manipula esta
// constante desde la consola del navegador, Firestore rechaza el
// intento igual — el cliente nunca es la fuente de la verdad.
const ADMIN_EMAIL_WHITELIST = Object.freeze([
  'manuel15160410@gmail.com',
  'jose.10.manuel@hotmail.com',
]);

// Si el correo autenticado está en la whitelist y su perfil todavía no
// es admin, intenta promoverlo. Es un no-op seguro para todos los demás
// usuarios (nunca se envía nada a Firestore si el correo no califica).
// Falla en silencio y de forma segura (fail-closed): si Firestore
// rechaza el intento (por ejemplo, si la whitelist del servidor no
// coincide con esta), el usuario simplemente sigue como estaba.
async function maybePromoteToAdmin(profile, uid) {
  if (!profile || !profile.email || profile.role === ROLES.ADMIN) return profile;
  const email = profile.email.toLowerCase().trim();
  if (!ADMIN_EMAIL_WHITELIST.includes(email)) return profile;
  try {
    await db.collection('users').doc(uid).update({ role: ROLES.ADMIN });
    countFirestoreOp('write');
    authLog('maybePromoteToAdmin() — promovido a admin', { email });
    return { ...profile, role: ROLES.ADMIN };
  } catch (e) {
    console.error('No se pudo promover a admin (revisa que firestore.rules tenga este correo en su whitelist):', e);
    return profile;
  }
}

function initAuth() {
  if (authState.initialized) return;
  authState.initialized = true;

  _authUnsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
    // Evita una lectura redundante a Firestore: si registerUser()/
    // loginUser()/loginWithGoogle() ya cargaron el perfil de ESTE mismo
    // uid hace un instante, no lo volvemos a pedir — onAuthStateChanged
    // se dispara también tras esas llamadas, y sin este chequeo cada
    // login costaba 2 lecturas de Firestore en vez de 1.
    const yaTeniaEstePerfil = user && authState.user?.uid === user.uid && !!authState.profile;
    authLog('onAuthStateChanged()', { uid: user?.uid || null, yaTeniaEstePerfil });
    authState.user = user;
    if (user) {
      if (!yaTeniaEstePerfil) {
        const result = await getCurrentUserProfile(user.uid);
        authState.profile = result.success ? result.profile : null;
      }
      // Paso 2: si el correo autenticado está en la whitelist de admin
      // y aún no tiene ese role, se promueve aquí — cubre login por
      // correo, login con Google, y sesión persistente al recargar,
      // sin duplicar esta lógica en cada función de login por separado.
      if (authState.profile) {
        authState.profile = await maybePromoteToAdmin(authState.profile, user.uid);
      }
    } else {
      authState.profile = null;
    }
    authState.ready = true;
    notifyAuthListeners();
  });
}

function onUserChanged(callback) {
  _authListeners.push(callback);
  if (authState.ready) callback(getCurrentUser());
  return () => { _authListeners = _authListeners.filter(cb => cb !== callback); };
}

function waitForAuthReady(timeoutMs = 10000) {
  if (!authState.initialized) {
    return Promise.reject(new Error('Auth no está inicializado — llama a initAuth() primero.'));
  }
  if (authState.ready) return Promise.resolve(getCurrentUser());
  return Promise.race([
    new Promise((resolve) => {
      const unsubscribe = onUserChanged((state) => { unsubscribe(); resolve(state); });
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando a que Auth esté listo')), timeoutMs)),
  ]);
}

// ============================================================
// FASE 1 — Cambiar contraseña
// ============================================================
// Firebase exige reautenticación reciente para operaciones sensibles
// (updatePassword) — por eso se pide la contraseña actual primero,
// no se puede simplemente llamar updatePassword() con la sesión activa.
async function changePassword(currentPassword, newPassword) {
  if (!authState.user || !authState.user.email) {
    return { success: false, code: 'no-user', message: 'No hay sesión activa.' };
  }
  if (!newPassword || newPassword.length < 8) {
    return { success: false, code: 'weak-password', message: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  }
  try {
    const credential = firebase.auth.EmailAuthProvider.credential(authState.user.email, currentPassword);
    await authState.user.reauthenticateWithCredential(credential);
    await authState.user.updatePassword(newPassword);
    return { success: true };
  } catch (e) {
    console.error('Error cambiando contraseña:', e);
    let message = mapAuthError(e.code);
    if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
      message = 'La contraseña actual no es correcta.';
    }
    return { success: false, code: e.code, message };
  }
}

// ============================================================
// FASE 1 — Favoritos sincronizados (users/{uid}/favorites/{vehicleId})
// ============================================================
async function toggleFavoriteRemote(vehicleId, isFav) {
  if (!authState.user) return { success: false, code: 'no-user' };
  try {
    const ref = db.collection('users').doc(authState.user.uid).collection('favorites').doc(vehicleId);
    if (isFav) {
      await ref.set({ addedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } else {
      await ref.delete();
    }
    countFirestoreOp('write');
    return { success: true };
  } catch (e) {
    console.error('Error sincronizando favorito:', e);
    return { success: false, code: e.code, message: mapFirestoreError(e.code) };
  }
}

async function getFavoritesRemote() {
  if (!authState.user) return { success: false, code: 'no-user', ids: [] };
  try {
    const snap = await db.collection('users').doc(authState.user.uid).collection('favorites').get();
    countFirestoreOp('read');
    return { success: true, ids: snap.docs.map(d => d.id) };
  } catch (e) {
    console.error('Error leyendo favoritos remotos:', e);
    return { success: false, code: e.code, ids: [] };
  }
}

// ============================================================
// FASE 1 — Historial sincronizado (users/{uid}/history/{autoId})
// ============================================================
async function addHistoryEntry(vehicleId) {
  if (!authState.user) return { success: false, code: 'no-user' };
  try {
    await db.collection('users').doc(authState.user.uid).collection('history').add({
      vehicleId,
      viewedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    countFirestoreOp('write');
    return { success: true };
  } catch (e) {
    console.error('Error guardando historial:', e);
    return { success: false, code: e.code };
  }
}

async function getHistoryRemote(max = 30) {
  if (!authState.user) return { success: false, code: 'no-user', items: [] };
  try {
    const snap = await db.collection('users').doc(authState.user.uid).collection('history')
      .orderBy('viewedAt', 'desc').limit(max).get();
    countFirestoreOp('read');
    return { success: true, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.error('Error leyendo historial remoto:', e);
    return { success: false, code: e.code, items: [] };
  }
}

async function deleteHistoryEntry(entryId) {
  if (!authState.user) return { success: false, code: 'no-user' };
  try {
    await db.collection('users').doc(authState.user.uid).collection('history').doc(entryId).delete();
    countFirestoreOp('write');
    return { success: true };
  } catch (e) {
    console.error('Error borrando entrada de historial:', e);
    return { success: false, code: e.code };
  }
}

// ============================================================
// FASE 1 — Cotizaciones (users/{uid}/quotes/{autoId})
// ============================================================
async function saveQuote(quoteData) {
  if (!authState.user) return { success: false, code: 'no-user' };
  try {
    await db.collection('users').doc(authState.user.uid).collection('quotes').add({
      vehicleId: quoteData.vehicleId || '',
      vehicleName: quoteData.vehicleName || 'Vehículo',
      downPayment: Number(quoteData.downPayment) || 0,
      termMonths: Number(quoteData.termMonths) || 1,
      monthlyPayment: Number(quoteData.monthlyPayment) || 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    countFirestoreOp('write');
    return { success: true };
  } catch (e) {
    console.error('Error guardando cotización:', e);
    return { success: false, code: e.code };
  }
}

async function getQuotesRemote(max = 30) {
  if (!authState.user) return { success: false, code: 'no-user', items: [] };
  try {
    const snap = await db.collection('users').doc(authState.user.uid).collection('quotes')
      .orderBy('createdAt', 'desc').limit(max).get();
    countFirestoreOp('read');
    return { success: true, items: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
  } catch (e) {
    console.error('Error leyendo cotizaciones:', e);
    return { success: false, code: e.code, items: [] };
  }
}

async function deleteQuote(quoteId) {
  if (!authState.user) return { success: false, code: 'no-user' };
  try {
    await db.collection('users').doc(authState.user.uid).collection('quotes').doc(quoteId).delete();
    countFirestoreOp('write');
    return { success: true };
  } catch (e) {
    console.error('Error borrando cotización:', e);
    return { success: false, code: e.code };
  }
}

// ============================================================
// FASE 1 — Preferencias (users/{uid}/preferences/settings — doc único)
// ============================================================
async function savePreferences(prefs) {
  if (!authState.user) return { success: false, code: 'no-user' };
  const allowed = ['brands', 'priceMin', 'priceMax', 'vehicleType', 'transmission', 'fuel'];
  const data = {};
  for (const key of allowed) if (key in prefs) data[key] = prefs[key];
  try {
    await db.collection('users').doc(authState.user.uid).collection('preferences').doc('settings').set(data, { merge: true });
    countFirestoreOp('write');
    return { success: true };
  } catch (e) {
    console.error('Error guardando preferencias:', e);
    return { success: false, code: e.code, message: mapFirestoreError(e.code) };
  }
}

async function getPreferences() {
  if (!authState.user) return { success: false, code: 'no-user', prefs: null };
  try {
    const doc = await db.collection('users').doc(authState.user.uid).collection('preferences').doc('settings').get();
    countFirestoreOp('read');
    return { success: true, prefs: doc.exists ? doc.data() : null };
  } catch (e) {
    console.error('Error leyendo preferencias:', e);
    return { success: false, code: e.code, prefs: null };
  }
}

initAuth();
