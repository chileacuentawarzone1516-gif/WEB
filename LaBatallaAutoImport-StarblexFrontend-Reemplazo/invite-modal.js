// ============================================================
// INVITE-MODAL.JS — Invitación OPCIONAL a crear cuenta / iniciar sesión.
//
// Objetivo: incentivar el registro (favoritos, historial, cotizaciones,
// preferencias) SIN bloquear nunca la navegación ni el contacto con el
// vendedor. Este archivo NO implementa autenticación: solo abre una
// puerta UX hacia el sistema de login/registro ya existente en
// auth.js / auth-ui.js (openAccountModal, setAuthUiMode, getCurrentUser,
// onUserChanged). Cero duplicación de lógica de auth.
//
// CUÁNDO APARECE:
//   El visitante hace clic en un enlace real de contacto por WhatsApp
//   con el vendedor (wa.me/<número del negocio>) — nunca al cargar la
//   página ni encima del hero/carrusel.
//
// CUÁNDO NO APARECE:
//   - Usuario con sesión iniciada (getCurrentUser().user).
//   - Usuario que ya se registró/inició sesión antes en este navegador
//     (señal local en localStorage; NO es un mecanismo de seguridad,
//     la autorización real siempre depende de Firebase Auth).
//   - Ya se mostró una vez durante la sesión actual del navegador
//     (sessionStorage) — evita interrumpir varias veces seguidas.
//
// SUPRESIÓN "ya registrado en este navegador":
//   Solo es posible detectar de forma local (este navegador/dispositivo).
//   Si la persona se registró desde otro dispositivo y ahora navega
//   desconectada desde este, no hay forma segura de saberlo sin pedirle
//   el correo — por diseño no se intenta adivinar eso.
// ============================================================

const LB_INVITE_EVER_KEY = 'labatalla_account_ever_v1';
const LB_INVITE_SESSION_KEY = 'labatalla_invite_shown_session_v1';
// Mismo número usado en el resto del sitio (tarjetas, ficha, CTA final,
// calculadora, FAB). Si cambia, ajustar aquí y en esos puntos.
const LB_WHATSAPP_NUMBER = '18097759771';

function inviteAlreadyRegisteredOnDevice() {
  try { return localStorage.getItem(LB_INVITE_EVER_KEY) === '1'; } catch (e) { return false; }
}
function markInviteAccountEver() {
  try { localStorage.setItem(LB_INVITE_EVER_KEY, '1'); } catch (e) {}
}
function inviteShownThisSession() {
  try { return sessionStorage.getItem(LB_INVITE_SESSION_KEY) === '1'; } catch (e) { return false; }
}
function markInviteShownThisSession() {
  try { sessionStorage.setItem(LB_INVITE_SESSION_KEY, '1'); } catch (e) {}
}

function shouldShowAccountInvite() {
  const { user } = (typeof getCurrentUser === 'function') ? getCurrentUser() : { user: null };
  if (user) return false;
  if (inviteAlreadyRegisteredOnDevice()) return false;
  if (inviteShownThisSession()) return false;
  return true;
}

let _inviteModalEl = null;
let _invitePendingAction = null;

function buildInviteModal() {
  if (_inviteModalEl) return _inviteModalEl;

  const modal = document.createElement('div');
  modal.id = 'invite-modal';
  modal.className = 'hidden fixed inset-0 bg-black/70 z-50 flex items-start justify-center p-4 pt-10 overflow-y-auto';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'invite-modal-title');
  modal.tabIndex = -1;
  modal.innerHTML = `
    <div class="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm border border-slate-700">
      <div class="relative p-6 pb-5 text-center">
        <button id="invite-close-btn" type="button" aria-label="Cerrar aviso" class="absolute top-2 right-2 text-slate-400 hover:text-white p-1">
          <i data-lucide="x" class="w-5 h-5 pointer-events-none"></i>
        </button>

        <div class="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center overflow-hidden" style="background:#051d40;box-shadow:0 0 0 1px rgba(56,189,248,0.35), 0 8px 24px rgba(56,189,248,0.15);">
          <img src="/logo-labatalla.png" alt="La Batalla Auto Import" class="w-full h-full object-cover" width="240" height="240">
        </div>

        <h2 id="invite-modal-title" class="text-white font-black text-lg mb-2">¡Obtén más de tu experiencia!</h2>
        <p class="text-slate-400 text-sm leading-relaxed mb-4">Crea tu cuenta gratis y guarda todo para más tarde:</p>

        <ul class="text-left text-slate-300 text-xs space-y-2 mb-5 mx-auto" style="max-width:260px;">
          <li class="flex items-start gap-2"><i data-lucide="heart" class="w-4 h-4 text-sky-400 shrink-0 mt-1 pointer-events-none"></i><span>Guarda tus vehículos favoritos</span></li>
          <li class="flex items-start gap-2"><i data-lucide="history" class="w-4 h-4 text-sky-400 shrink-0 mt-1 pointer-events-none"></i><span>Retoma tu historial de vehículos vistos</span></li>
          <li class="flex items-start gap-2"><i data-lucide="file-text" class="w-4 h-4 text-sky-400 shrink-0 mt-1 pointer-events-none"></i><span>Recupera tus cotizaciones guardadas</span></li>
          <li class="flex items-start gap-2"><i data-lucide="sparkles" class="w-4 h-4 text-sky-400 shrink-0 mt-1 pointer-events-none"></i><span>Recibe una experiencia más personalizada</span></li>
        </ul>

        <button id="invite-register-btn" type="button" class="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2.5 rounded-xl transition text-sm mb-2">Crear cuenta</button>
        <button id="invite-login-btn" type="button" class="w-full border border-slate-600 text-slate-300 hover:text-white py-2.5 rounded-xl transition text-sm font-medium mb-3">Iniciar sesión</button>
        <button id="invite-continue-btn" type="button" class="w-full text-slate-500 hover:text-slate-300 text-xs font-medium py-1">Continuar sin registrarme</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  _inviteModalEl = modal;

  modal.addEventListener('click', (e) => { if (e.target.id === 'invite-modal') closeInviteModal(); });
  document.getElementById('invite-close-btn').addEventListener('click', closeInviteModal);

  document.getElementById('invite-register-btn').addEventListener('click', () => {
    _invitePendingAction = null; // el visitante eligió registrarse: la acción de contacto original no se ejecuta sola
    closeInviteModal();
    openAccountModal('login');
    setAuthUiMode('register');
  });
  document.getElementById('invite-login-btn').addEventListener('click', () => {
    _invitePendingAction = null;
    closeInviteModal();
    openAccountModal('login');
    setAuthUiMode('login');
  });
  document.getElementById('invite-continue-btn').addEventListener('click', () => {
    const action = _invitePendingAction;
    _invitePendingAction = null;
    closeInviteModal();
    if (typeof action === 'function') action();
  });

  if (typeof setupModalAccessibility === 'function') {
    setupModalAccessibility('invite-modal', closeInviteModal);
  }
  return modal;
}

/**
 * Abre la invitación opcional. `onContinueWithoutAccount` se ejecuta
 * solo si el visitante pulsa "Continuar sin registrarme" — nunca al
 * cerrar con X o clic afuera.
 */
function openInviteModal(onContinueWithoutAccount) {
  const modal = buildInviteModal();
  _invitePendingAction = typeof onContinueWithoutAccount === 'function' ? onContinueWithoutAccount : null;
  markInviteShownThisSession();
  modal.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}
function closeInviteModal() {
  if (_inviteModalEl) _inviteModalEl.classList.add('hidden');
}

// ============================================================
// PUERTA DE CONTACTO — intercepta ÚNICAMENTE los enlaces reales de
// contacto con el vendedor (wa.me/<número del negocio>). Deliberadamente
// NO intercepta los enlaces de "compartir" (wa.me/?text=... sin número,
// usados para reenviar una publicación a un contacto propio), porque
// esos no son una acción de contacto con La Batalla Auto Import.
// Delegado en document: cubre tarjetas, ficha de vehículo, CTA final y
// la calculadora de financiamiento sin duplicar listeners por cada
// tarjeta renderizada dinámicamente.
// ============================================================
function initInviteContactGate() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest(`a[href*="wa.me/${LB_WHATSAPP_NUMBER}"]`);
    if (!link) return;
    if (!shouldShowAccountInvite()) return; // deja pasar el clic normalmente
    e.preventDefault();
    const url = link.href;
    const target = link.target || '_blank';
    openInviteModal(() => window.open(url, target, 'noopener'));
  });
}

// Recuerda (solo en este navegador) que ya hubo una sesión iniciada
// alguna vez, para no volver a mostrar la invitación a quien ya tiene
// cuenta aunque esté desconectado. NO sustituye a Firebase Auth.
function initInviteAccountSignal() {
  if (typeof onUserChanged === 'function') {
    onUserChanged(({ user } = {}) => { if (user) markInviteAccountEver(); });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initInviteContactGate();
  initInviteAccountSignal();
});

// Expuesto para que otros puntos de contacto que no son <a> (p. ej. el
// FAB de WhatsApp, que dispara window.open() desde un <button>) puedan
// pasar por la misma puerta sin duplicar la lógica de arriba.
window.LB_INVITE = { shouldShow: shouldShowAccountInvite, open: openInviteModal };
