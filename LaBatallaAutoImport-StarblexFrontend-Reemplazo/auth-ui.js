// ============================================================
// AUTH-UI.JS — Toda la interfaz de autenticación. auth.js nunca toca
// el DOM; este archivo nunca llama directo a firebase.* — solo pasa
// por la API pública de auth.js.
// ============================================================

let authUiMode = 'login'; // 'login' | 'register'

function setAuthUiMode(mode) {
  authUiMode = mode;
  document.getElementById('auth-mode-login-btn').classList.toggle('active', mode === 'login');
  document.getElementById('auth-mode-register-btn').classList.toggle('active', mode === 'register');
  document.getElementById('auth-name-field').classList.toggle('hidden', mode !== 'register');
  document.getElementById('auth-confirm-field').classList.toggle('hidden', mode !== 'register');
  document.getElementById('auth-strength-wrap').classList.toggle('hidden', mode !== 'register');
  document.getElementById('auth-title').textContent = mode === 'register' ? 'Crea tu cuenta' : 'Bienvenido nuevamente';
  document.getElementById('auth-submit-btn').querySelector('.btn-label').textContent =
    mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión';
  hideAuthFormError();
}

function showAuthFormError(msg) {
  const el = document.getElementById('auth-form-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideAuthFormError() {
  document.getElementById('auth-form-error').classList.add('hidden');
}

function showAuthView(view) {
  document.getElementById('auth-form-view').classList.toggle('hidden', view !== 'form');
  document.getElementById('auth-reset-view').classList.toggle('hidden', view !== 'reset');
  document.getElementById('auth-logged-in-view').classList.toggle('hidden', view !== 'loggedIn');
  document.getElementById('auth-register-success-view').classList.toggle('hidden', view !== 'registerSuccess');
  document.getElementById('auth-login-success-view').classList.toggle('hidden', view !== 'loginSuccess');
}

function refreshAuthTabView() {
  const { user, profile } = getCurrentUser();
  if (user && profile) {
    document.getElementById('auth-logged-name').textContent = profile.name;
    document.getElementById('auth-logged-email').textContent = profile.email;
    renderAuthAvatar(document.getElementById('auth-logged-avatar'), profile);
    document.getElementById('auth-verify-banner').classList.toggle('hidden', !!user.emailVerified);
    showAuthView('loggedIn');
  } else {
    showAuthView('form');
  }
}

// Avatar: foto de Google si existe, iniciales si no (Fase 5).
function renderAuthAvatar(el, profile) {
  if (!el) return;
  if (profile.photoURL) {
    el.innerHTML = `<img src="${escapeAttr(profile.photoURL)}" alt="" referrerpolicy="no-referrer" class="w-full h-full object-cover rounded-full">`;
  } else {
    const initials = (profile.name || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
    el.textContent = initials || '👤';
  }
}

function openPasswordResetFlow() {
  openAccountModal('login');
  const { profile } = getCurrentUser();
  document.getElementById('auth-reset-email-input').value = profile?.email || '';
  showAuthView('reset');
}

// Mensaje de bienvenida moderno y personalizado (Correcciones
// pre-lanzamiento) — usado tanto por login con correo como con Google.
function setLoginSuccessMessage(profile, isNewUser) {
  const el = document.getElementById('auth-login-success-message');
  if (!el) return;
  el.textContent = isNewUser
    ? '¡Bienvenido a La Batalla Auto Import!'
    : `¡Bienvenido nuevamente, ${profile?.name || 'de vuelta'}!`;
}

// ————— Validación en tiempo real + medidor de contraseña (Fase 5) —————
function scorePassword(pw) {
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 10) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4); // 0-4
}
function updateStrengthMeter() {
  const pw = document.getElementById('auth-password-input').value;
  const fill = document.getElementById('auth-strength-fill');
  const label = document.getElementById('auth-strength-label');
  if (!pw) { fill.style.width = '0%'; label.textContent = ''; return; }
  const score = scorePassword(pw);
  const levels = [
    { w: '20%', c: '#ef4444', t: 'Muy débil' },
    { w: '40%', c: '#f97316', t: 'Débil' },
    { w: '65%', c: '#facc15', t: 'Aceptable' },
    { w: '85%', c: '#a3e635', t: 'Fuerte' },
    { w: '100%', c: '#34d399', t: 'Muy fuerte' },
  ];
  const lv = levels[score];
  fill.style.width = lv.w;
  fill.style.background = lv.c;
  label.textContent = lv.t;
  label.style.color = lv.c;
}

function validateAuthFormLive() {
  const email = document.getElementById('auth-email-input').value.trim();
  const emailOk = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  document.getElementById('auth-email-input').classList.toggle('auth-input-error', !emailOk);
  if (authUiMode === 'register') {
    const pw = document.getElementById('auth-password-input').value;
    const confirm = document.getElementById('auth-confirm-input').value;
    const mismatch = confirm.length > 0 && pw !== confirm;
    document.getElementById('auth-confirm-input').classList.toggle('auth-input-error', mismatch);
    document.getElementById('auth-confirm-hint').classList.toggle('hidden', !mismatch);
  }
}

// ————— Submit —————
let authSubmitBusy = false;
async function handleAuthSubmit() {
  if (authSubmitBusy) return; // prevención de doble envío
  const email = document.getElementById('auth-email-input').value.trim();
  const password = document.getElementById('auth-password-input').value;
  const name = document.getElementById('auth-name-input').value.trim();
  const remember = document.getElementById('auth-remember-input').checked;

  hideAuthFormError();
  if (!email || !password) { showAuthFormError('Completa correo y contraseña.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showAuthFormError('El correo no tiene un formato válido.'); return; }
  if (authUiMode === 'register') {
    if (!name) { showAuthFormError('Completa tu nombre.'); return; }
    if (password.length < 6) { showAuthFormError('La contraseña debe tener al menos 6 caracteres.'); return; }
    const confirm = document.getElementById('auth-confirm-input').value;
    if (password !== confirm) { showAuthFormError('Las contraseñas no coinciden.'); return; }
  }

  authSubmitBusy = true;
  const btn = document.getElementById('auth-submit-btn');
  const idleLabel = authUiMode === 'register' ? 'Crear cuenta' : 'Iniciar sesión';
  setBtnBusy(btn, true, '⏳ Procesando...', idleLabel);

  let keepBusyForSuccessView = false;

  try {
    const result = authUiMode === 'register'
      ? await registerUser(email, password, name, remember)
      : await loginUser(email, password, remember);

    if (!result.success) {
      // Error: el modal permanece abierto mostrando el mensaje. Nunca se cierra aquí.
      showAuthFormError(result.message || 'Ocurrió un error. Intenta de nuevo.');
      return;
    }
    document.getElementById('auth-password-input').value = '';
    document.getElementById('auth-confirm-input').value = '';

    // authSubmitBusy se mantiene en true durante la vista de éxito para
    // que el listener onUserChanged (más abajo) no la pise llamando a
    // refreshAuthTabView() en cuanto Firebase confirme la sesión.
    keepBusyForSuccessView = true;

    if (authUiMode === 'register') {
      // Registro exitoso: el modal NO se cierra solo. Se muestra la vista
      // de éxito con acciones explícitas ("Ir a mi perfil" / "Seguir
      // navegando" / "Cerrar") — el usuario decide cuándo cerrarlo, y
      // esos botones son los que finalmente liberan authSubmitBusy.
      showAuthView('registerSuccess');
    } else {
      // Login exitoso: se muestra el mensaje de bienvenida personalizado
      // dentro del modal y luego se cierra automáticamente.
      setLoginSuccessMessage(result.profile, result.isNewUser);
      showAuthView('loginSuccess');
      setTimeout(() => {
        authSubmitBusy = false;
        closeAccountModal();
        showAuthView('form'); // deja el modal listo para la próxima apertura
      }, 1200);
    }
  } finally {
    setBtnBusy(btn, false, '', idleLabel);
    if (!keepBusyForSuccessView) authSubmitBusy = false;
  }
}

// ————— Google (Fase 3) —————
let googleBusy = false;
async function handleGoogleSignIn() {
  if (googleBusy || authSubmitBusy) return;
  googleBusy = true;
  const btn = document.getElementById('auth-google-btn');
  const remember = document.getElementById('auth-remember-input').checked;
  setBtnBusy(btn, true, '⏳ Conectando con Google...', 'Continuar con Google');
  let keepBusyForSuccessView = false;
  try {
    const result = await loginWithGoogle(remember);
    if (!result.success) {
      // Cierre voluntario del popup no es un error que gritar.
      if (result.code !== 'auth/popup-closed-by-user') showAuthFormError(result.message);
      return;
    }
    // Éxito: mismo tratamiento que el login por correo — mensaje de
    // bienvenida personalizado dentro del modal, luego cierre automático.
    // googleBusy se retiene (keepBusyForSuccessView) para que
    // onUserChanged no pise esta vista con refreshAuthTabView() en
    // cuanto Firebase confirme la sesión de Google.
    keepBusyForSuccessView = true;
    setLoginSuccessMessage(result.profile, result.isNewUser);
    showAuthView('loginSuccess');
    setTimeout(() => {
      googleBusy = false;
      closeAccountModal();
      showAuthView('form');
    }, 1200);
  } finally {
    setBtnBusy(btn, false, '', 'Continuar con Google');
    if (!keepBusyForSuccessView) googleBusy = false;
  }
}

// ————— Recuperación (Fase 7) —————
let resetSubmitBusy = false;
async function handleResetSubmit() {
  if (resetSubmitBusy) return;
  const email = document.getElementById('auth-reset-email-input').value.trim();
  if (!email) { showToast('⚠️ Escribe tu correo'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showToast('⚠️ El correo no tiene un formato válido'); return; }

  resetSubmitBusy = true;
  const btn = document.getElementById('auth-reset-submit-btn');
  setBtnBusy(btn, true, '⏳ Enviando...', 'Enviar enlace');
  try {
    const result = await sendResetPassword(email);
    if (!result.success) { showToast('❌ ' + (result.message || 'No se pudo enviar el correo')); return; }
    document.getElementById('auth-reset-success').classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('auth-reset-success').classList.add('hidden');
      showAuthView('form');
    }, 3500);
  } finally {
    resetSubmitBusy = false;
    setBtnBusy(btn, false, '', 'Enviar enlace');
  }
}

// ————— Verificación de correo (Fase 6) —————
let verifyBusy = false;
let verifyCooldownUntil = 0;
async function handleResendVerification() {
  if (verifyBusy) return;
  const now = Date.now();
  if (now < verifyCooldownUntil) {
    showToast(`⏳ Espera ${Math.ceil((verifyCooldownUntil - now) / 1000)}s para reenviar`);
    return;
  }
  verifyBusy = true;
  try {
    const result = await sendVerificationEmail();
    if (result.alreadyVerified) { showToast('✅ Tu correo ya está verificado'); refreshAuthTabView(); return; }
    if (!result.success) { showToast('❌ ' + (result.message || 'No se pudo reenviar')); return; }
    verifyCooldownUntil = Date.now() + 60000; // 60s de cooldown anti-spam
    showToast('📧 Correo de verificación reenviado — revisa tu bandeja');
  } finally {
    verifyBusy = false;
  }
}

// ————— Mostrar/ocultar contraseña + Caps Lock (Fase 5) —————
function togglePasswordVisibility(inputId, btnEl) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btnEl.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}" class="w-4 h-4"></i>`;
  if (window.lucide) window.lucide.createIcons();
}
function handleCapsLock(e) {
  const warn = document.getElementById('auth-capslock-warn');
  if (warn && typeof e.getModifierState === 'function') {
    warn.classList.toggle('hidden', !e.getModifierState('CapsLock'));
  }
}

async function handleLogout() {
  const result = await logoutUser();
  if (!result.success) {
    showToast('❌ No se pudo cerrar sesión — sigues conectado');
    return;
  }
  closeAccountModal();
}

function initAuthUi() {
  document.getElementById('auth-mode-login-btn')?.addEventListener('click', () => setAuthUiMode('login'));
  document.getElementById('auth-mode-register-btn')?.addEventListener('click', () => setAuthUiMode('register'));
  document.getElementById('auth-submit-btn')?.addEventListener('click', handleAuthSubmit);
  document.getElementById('auth-google-btn')?.addEventListener('click', handleGoogleSignIn);

  ['auth-email-input', 'auth-password-input', 'auth-name-input', 'auth-confirm-input'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleAuthSubmit(); }
      handleCapsLock(e);
    });
    el?.addEventListener('input', validateAuthFormLive);
  });
  document.getElementById('auth-password-input')?.addEventListener('input', updateStrengthMeter);
  document.getElementById('auth-password-input')?.addEventListener('keyup', handleCapsLock);

  document.getElementById('auth-toggle-pw-btn')?.addEventListener('click', function() { togglePasswordVisibility('auth-password-input', this); });
  document.getElementById('auth-toggle-confirm-btn')?.addEventListener('click', function() { togglePasswordVisibility('auth-confirm-input', this); });

  document.getElementById('auth-reset-email-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); handleResetSubmit(); }
  });

  document.getElementById('auth-forgot-btn')?.addEventListener('click', () => {
    document.getElementById('auth-reset-email-input').value = document.getElementById('auth-email-input').value.trim();
    showAuthView('reset');
  });
  document.getElementById('auth-reset-back-btn')?.addEventListener('click', () => showAuthView('form'));
  document.getElementById('auth-reset-submit-btn')?.addEventListener('click', handleResetSubmit);
  document.getElementById('auth-resend-verify-btn')?.addEventListener('click', handleResendVerification);

  document.getElementById('auth-logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('auth-goto-dashboard-btn')?.addEventListener('click', () => {
    closeAccountModal();
    window.LB_DASHBOARD?.open();
  });

  // Vista de éxito de registro (Correcciones pre-lanzamiento): el usuario
  // decide explícitamente cómo continuar, el modal no se cierra solo.
  // Cada botón libera authSubmitBusy, retenido a propósito desde
  // handleAuthSubmit para blindar la vista contra onUserChanged.
  document.getElementById('auth-success-goto-profile-btn')?.addEventListener('click', () => {
    authSubmitBusy = false;
    closeAccountModal();
    showAuthView('form');
    window.LB_DASHBOARD?.open();
  });
  document.getElementById('auth-success-continue-btn')?.addEventListener('click', () => {
    authSubmitBusy = false;
    closeAccountModal();
    showAuthView('form');
  });
  document.getElementById('auth-success-close-btn')?.addEventListener('click', () => {
    authSubmitBusy = false;
    closeAccountModal();
    showAuthView('form');
  });

  onUserChanged(() => {
    if (authSubmitBusy || googleBusy) return; // evita parpadeos durante login en curso
    if (!document.getElementById('account-modal').classList.contains('hidden')) {
      refreshAuthTabView();
    }
  });

  // Salvaguarda: si el modal se cierra por CUALQUIER vía (X, click fuera,
  // Escape, o nuestro propio closeAccountModal) mientras authSubmitBusy o
  // googleBusy seguían en true (p. ej. el usuario cierra la vista de éxito
  // de registro sin usar sus botones), se liberan aquí. Sin esto, un cierre
  // "manual" en ese instante dejaría el formulario bloqueado para siempre.
  const accountModalEl = document.getElementById('account-modal');
  if (accountModalEl) {
    new MutationObserver(() => {
      if (accountModalEl.classList.contains('hidden')) {
        authSubmitBusy = false;
        googleBusy = false;
      }
    }).observe(accountModalEl, { attributes: true, attributeFilter: ['class'] });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuthUi);
} else {
  initAuthUi();
}
