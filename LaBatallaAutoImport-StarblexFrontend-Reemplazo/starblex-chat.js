// ============================================================
// STARBLEX-CHAT.JS — Interfaz de Starblex IA 1.0, asistente
// automotriz de La Batalla Auto Import.
//
// Este archivo NO contiene ninguna API key ni llama directo a ningún
// proveedor de IA — solo habla con el propio backend del sitio
// (/api/starblex, netlify/edge-functions/starblex.js), que es el único
// lugar donde vive la credencial. Ver ese archivo para la lógica de
// seguridad, límites y system prompt.
//
// Responsabilidad de este archivo: UI del chat + armar el payload con
// datos YA disponibles en el navegador (el vehículo en pantalla, si lo
// hay). No duplica lógica de auth ni de inventario — el inventario real
// lo obtiene el backend directamente de Firestore.
//
// Historial: varias conversaciones pueden convivir dentro de la MISMA
// sesión de navegador (memoria de este módulo) — permite nueva
// conversación, cambiar entre ellas, renombrar y eliminar. Se pierden
// todas al recargar o cerrar la pestaña: a propósito no se persiste
// nada en localStorage/sessionStorage. Lo que se envía al backend en
// cada mensaje nunca supera los últimos STARBLEX_MAX_HISTORY_TURNS
// turnos, sin importar cuán larga sea la conversación visible.
//
// PENDIENTES DE BACKEND (documentados, no simulados):
//   - Feedback (👍/👎): la UI existe y cambia de estado localmente,
//     pero no hay endpoint que reciba ni guarde ese dato todavía.
//   - Resumen automático de conversaciones muy largas: no implementado
//     (requeriría una llamada real a un modelo para resumir). Lo único
//     que ya limita el costo es que el backend jamás recibe más de
//     STARBLEX_MAX_HISTORY_TURNS turnos, sin importar el historial
//     visible en pantalla.
//   - Persistencia de conversaciones entre sesiones: no existe; es una
//     decisión de privacidad, no una limitación a resolver.
// ============================================================

const STARBLEX_ENDPOINT = '/api/starblex';
const STARBLEX_MAX_MESSAGE_CHARS = 800;
const STARBLEX_MAX_HISTORY_TURNS = 6; // mismo límite que el backend
const STARBLEX_LOGO = '/logo-labatalla.png';

const STARBLEX_WELCOME =
  'Hola, soy Starblex IA 1.0, el asistente de inteligencia artificial de La Batalla Auto Import. Puedo ayudarte a conocer vehículos, resolver dudas, entender posibles problemas, comparar opciones y evaluar una compra.';

// ------------------------------------------------------------
// Estado — varias conversaciones en memoria, ninguna persistida.
// ------------------------------------------------------------
let _sbConversations = []; // [{id, title, renamed, messages:[{role,content}], dismissedVehicleId}]
let _sbActiveId = null;
let _sbPanelEl = null;
let _sbBusy = false;

function sbNewConversation() {
  const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
  const conv = { id, title: 'Nueva conversación', renamed: false, messages: [], dismissedVehicleId: null };
  _sbConversations.unshift(conv);
  _sbActiveId = id;
  return conv;
}
function sbActiveConversation() {
  return _sbConversations.find((c) => c.id === _sbActiveId) || null;
}
function sbSetTitleFromFirstMessage(conv, text) {
  if (conv.renamed) return;
  conv.title = text.length > 42 ? text.slice(0, 42).trim() + '…' : text;
}

function sbCurrentVehicle() {
  return (typeof currentDetailVehicle !== 'undefined' && currentDetailVehicle) ? currentDetailVehicle : null;
}
function sbVehicleIdForRequest(conv) {
  const v = sbCurrentVehicle();
  if (!v || typeof v.id !== 'string') return undefined;
  if (conv.dismissedVehicleId === v.id) return undefined; // el usuario lo quitó de contexto
  return v.id;
}

function sbSuggestions() {
  const v = sbCurrentVehicle();
  const base = ['¿Qué vehículos tienen disponibles?', '¿Cuál SUV me recomiendas?'];
  if (v) base.splice(1, 0, 'Explícame este vehículo');
  else base.push('¿Qué diferencia hay entre un sedán y una SUV?');
  return base;
}

// ------------------------------------------------------------
// Construcción del panel (una sola vez)
// ------------------------------------------------------------
function sbBuildPanel() {
  if (_sbPanelEl) return _sbPanelEl;

  const panel = document.createElement('div');
  panel.id = 'starblex-panel';
  panel.className = 'hidden fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'starblex-title');
  panel.tabIndex = -1;
  panel.innerHTML = `
    <div class="starblex-scrim" aria-hidden="true"></div>
    <div class="starblex-window" style="height:min(88vh,640px);">
      <header class="starblex-header">
        <div class="starblex-brand">
          <img src="${STARBLEX_LOGO}" alt="" class="starblex-avatar" onerror="this.style.display='none'">
          <div class="starblex-brand-text">
            <h2 id="starblex-title">Starblex <span>IA 1.0</span></h2>
            <p>Asistente automotriz de La Batalla Auto Import</p>
          </div>
        </div>
        <div class="starblex-header-actions">
          <button type="button" id="starblex-history-btn" class="starblex-icon-btn" aria-haspopup="true" aria-expanded="false" aria-controls="starblex-history-panel" aria-label="Ver conversaciones">
            <i data-lucide="history" class="w-4 h-4 pointer-events-none"></i>
          </button>
          <button type="button" id="starblex-new-btn" class="starblex-icon-btn" aria-label="Nueva conversación" title="Nueva conversación">
            <i data-lucide="plus" class="w-4 h-4 pointer-events-none"></i>
          </button>
          <button type="button" id="starblex-close-btn" class="starblex-icon-btn" aria-label="Cerrar Starblex IA">
            <i data-lucide="x" class="w-4 h-4 pointer-events-none"></i>
          </button>
        </div>
        <div id="starblex-history-panel" class="starblex-history-panel hidden" role="menu" aria-label="Conversaciones de esta sesión"></div>
      </header>

      <div id="starblex-ctx-bar" class="starblex-ctx-bar hidden">
        <span aria-hidden="true">🚗</span>
        <span id="starblex-ctx-text" class="starblex-ctx-text"></span>
        <button type="button" id="starblex-ctx-clear" aria-label="Quitar vehículo del contexto" title="Quitar del contexto">×</button>
      </div>

      <div id="starblex-messages-wrap" class="starblex-messages-wrap" aria-live="polite">
        <ol id="starblex-messages" class="starblex-messages"></ol>
        <div id="starblex-suggestions" class="starblex-suggestions"></div>
      </div>

      <div class="starblex-inputbar">
        <label for="starblex-input" class="sr-only">Escribe tu pregunta para Starblex IA</label>
        <textarea id="starblex-input" class="starblex-input" rows="1" maxlength="${STARBLEX_MAX_MESSAGE_CHARS}" placeholder="Pregúntale a Starblex…"></textarea>
        <button id="starblex-send-btn" type="button" class="starblex-send-btn" aria-label="Enviar mensaje">
          <i data-lucide="send" class="w-4 h-4 pointer-events-none"></i>
        </button>
      </div>
      <p class="starblex-disclaimer">Las respuestas técnicas no sustituyen una inspección profesional cuando corresponda.</p>
    </div>`;

  document.body.appendChild(panel);
  _sbPanelEl = panel;

  panel.querySelector('.starblex-scrim').addEventListener('click', closeStarblexPanel);
  document.getElementById('starblex-close-btn').addEventListener('click', closeStarblexPanel);
  document.getElementById('starblex-new-btn').addEventListener('click', sbStartNewConversation);
  document.getElementById('starblex-history-btn').addEventListener('click', sbToggleHistoryPanel);
  document.getElementById('starblex-ctx-clear').addEventListener('click', sbClearContext);

  const input = document.getElementById('starblex-input');
  const sendBtn = document.getElementById('starblex-send-btn');
  sendBtn.addEventListener('click', () => sbSubmitInput());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sbSubmitInput(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });

  if (typeof setupModalAccessibility === 'function') {
    setupModalAccessibility('starblex-panel', closeStarblexPanel);
  }
  return panel;
}

// ------------------------------------------------------------
// Historial de conversaciones (solo esta sesión)
// ------------------------------------------------------------
function sbToggleHistoryPanel() {
  const btn = document.getElementById('starblex-history-btn');
  const wrap = document.getElementById('starblex-history-panel');
  const willOpen = wrap.classList.contains('hidden');
  if (willOpen) sbRenderHistoryPanel();
  wrap.classList.toggle('hidden', !willOpen);
  btn.setAttribute('aria-expanded', String(willOpen));
}
function sbRenderHistoryPanel() {
  const wrap = document.getElementById('starblex-history-panel');
  wrap.innerHTML = '';
  if (_sbConversations.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'starblex-history-empty';
    empty.textContent = 'Todavía no hay conversaciones en esta sesión.';
    wrap.appendChild(empty);
    return;
  }
  _sbConversations.forEach((conv) => {
    const row = document.createElement('div');
    row.className = 'starblex-history-item' + (conv.id === _sbActiveId ? ' active' : '');

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'starblex-history-open';
    openBtn.textContent = conv.title; // textContent — nunca HTML del usuario
    openBtn.addEventListener('click', () => sbSwitchConversation(conv.id));
    row.appendChild(openBtn);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'starblex-history-action';
    renameBtn.setAttribute('aria-label', 'Renombrar conversación');
    renameBtn.title = 'Renombrar';
    renameBtn.textContent = '✎';
    renameBtn.addEventListener('click', () => sbRenameConversation(conv.id));
    row.appendChild(renameBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'starblex-history-action starblex-history-action--danger';
    delBtn.setAttribute('aria-label', 'Eliminar conversación');
    delBtn.title = 'Eliminar';
    delBtn.textContent = '🗑';
    delBtn.addEventListener('click', () => sbDeleteConversation(conv.id));
    row.appendChild(delBtn);

    wrap.appendChild(row);
  });
}
function sbRenameConversation(id) {
  const conv = _sbConversations.find((c) => c.id === id);
  if (!conv) return;
  const nuevo = window.prompt('Renombrar conversación:', conv.title);
  if (nuevo === null) return;
  const trimmed = nuevo.trim().slice(0, 60);
  if (!trimmed) return;
  conv.title = trimmed;
  conv.renamed = true;
  sbRenderHistoryPanel();
}
function sbDeleteConversation(id) {
  const idx = _sbConversations.findIndex((c) => c.id === id);
  if (idx === -1) return;
  _sbConversations.splice(idx, 1);
  if (_sbActiveId === id) {
    const next = _sbConversations[0];
    if (next) sbSwitchConversation(next.id);
    else { sbNewConversation(); sbRenderMessages(); }
  }
  sbRenderHistoryPanel();
}
function sbSwitchConversation(id) {
  const conv = _sbConversations.find((c) => c.id === id);
  if (!conv) return;
  _sbActiveId = id;
  sbRenderMessages();
  sbRenderHistoryPanel();
  document.getElementById('starblex-history-panel').classList.add('hidden');
  document.getElementById('starblex-history-btn').setAttribute('aria-expanded', 'false');
  sbUpdateContextBar();
}
function sbStartNewConversation() {
  sbNewConversation();
  sbRenderMessages();
  document.getElementById('starblex-history-panel').classList.add('hidden');
  sbUpdateContextBar();
  document.getElementById('starblex-input')?.focus();
}

// ------------------------------------------------------------
// Barra de contexto de vehículo
// ------------------------------------------------------------
function sbUpdateContextBar() {
  const bar = document.getElementById('starblex-ctx-bar');
  const text = document.getElementById('starblex-ctx-text');
  if (!bar || !text) return;
  const conv = sbActiveConversation();
  const v = sbCurrentVehicle();
  if (v && conv && conv.dismissedVehicleId !== v.id) {
    text.textContent = 'Vehículo en contexto: ' + (v.name || 'este vehículo'); // textContent
    bar.classList.remove('hidden');
  } else {
    bar.classList.add('hidden');
  }
}
function sbClearContext() {
  const conv = sbActiveConversation();
  const v = sbCurrentVehicle();
  if (conv && v) conv.dismissedVehicleId = v.id;
  sbUpdateContextBar();
}

// ------------------------------------------------------------
// Render de mensajes
// ------------------------------------------------------------
function sbRenderMessages() {
  const list = document.getElementById('starblex-messages');
  if (!list) return;
  list.innerHTML = '';
  const conv = sbActiveConversation();
  if (!conv) return;
  if (conv.messages.length === 0) {
    sbAppendMessage('bot', STARBLEX_WELCOME, { persist: false });
  } else {
    conv.messages.forEach((m) => sbAppendMessage(m.role, m.content, { persist: false }));
  }
  sbRenderSuggestions();
  sbScrollToBottom();
}
function sbRenderSuggestions() {
  const wrap = document.getElementById('starblex-suggestions');
  if (!wrap) return;
  const conv = sbActiveConversation();
  if (!conv || conv.messages.length > 0) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = '';
  sbSuggestions().forEach((s) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'starblex-suggestion';
    btn.textContent = s; // textContent — nunca HTML
    btn.addEventListener('click', () => sbSendMessage(s));
    wrap.appendChild(btn);
  });
}

function sbAppendMessage(role, text, opts) {
  const persist = !opts || opts.persist !== false;
  const list = document.getElementById('starblex-messages');
  if (!list) return null;

  const li = document.createElement('li');
  li.className = 'starblex-msg starblex-msg--' + (role === 'user' ? 'user' : role === 'error' ? 'error' : 'bot');

  if (role === 'bot') {
    const avatar = document.createElement('img');
    avatar.src = STARBLEX_LOGO;
    avatar.alt = '';
    avatar.className = 'starblex-msg-avatar';
    avatar.onerror = function () { this.style.display = 'none'; };
    li.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'starblex-bubble';
  bubble.textContent = text; // SIEMPRE texto plano — la respuesta del backend es DATA, no HTML confiable
  li.appendChild(bubble);

  if (role === 'bot') {
    const fb = document.createElement('div');
    fb.className = 'starblex-feedback';
    fb.setAttribute('aria-label', 'Calificar esta respuesta');
    ['up', 'down'].forEach((kind) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'starblex-feedback-btn';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', kind === 'up' ? 'Respuesta útil' : 'Respuesta no útil');
      b.textContent = kind === 'up' ? '👍' : '👎';
      // PENDIENTE DE BACKEND: no existe endpoint de feedback en
      // /api/starblex todavía. Este botón solo cambia su propio estado
      // visual — no se envía ni se guarda nada.
      b.addEventListener('click', () => {
        const already = b.getAttribute('aria-pressed') === 'true';
        fb.querySelectorAll('.starblex-feedback-btn').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', String(!already));
      });
      fb.appendChild(b);
    });
    li.appendChild(fb);
  }

  list.appendChild(li);
  if (persist) {
    const conv = sbActiveConversation();
    if (conv && role !== 'error') conv.messages.push({ role: role === 'user' ? 'user' : 'assistant', content: text });
  }
  sbScrollToBottom();
  return bubble;
}

function sbScrollToBottom() {
  const wrap = document.getElementById('starblex-messages-wrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

function sbSetTyping(show) {
  const list = document.getElementById('starblex-messages');
  if (!list) return;
  let typing = document.getElementById('starblex-typing');
  if (show) {
    if (typing) return;
    typing = document.createElement('li');
    typing.id = 'starblex-typing';
    typing.className = 'starblex-msg starblex-msg--bot';
    const avatar = document.createElement('img');
    avatar.src = STARBLEX_LOGO;
    avatar.alt = '';
    avatar.className = 'starblex-msg-avatar';
    avatar.onerror = function () { this.style.display = 'none'; };
    typing.appendChild(avatar);
    const dots = document.createElement('div');
    dots.className = 'starblex-typing';
    dots.setAttribute('aria-label', 'Starblex IA está escribiendo');
    dots.innerHTML = '<span></span><span></span><span></span>';
    typing.appendChild(dots);
    list.appendChild(typing);
    sbScrollToBottom();
  } else if (typing) {
    typing.remove();
  }
}

function sbSetBusy(busy) {
  _sbBusy = busy;
  const input = document.getElementById('starblex-input');
  const sendBtn = document.getElementById('starblex-send-btn');
  if (input) input.disabled = busy;
  if (sendBtn) sendBtn.disabled = busy;
}

function sbSubmitInput() {
  const input = document.getElementById('starblex-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  sbSendMessage(text);
}

async function sbSendMessage(text) {
  if (_sbBusy) return;
  const message = String(text).trim().slice(0, STARBLEX_MAX_MESSAGE_CHARS);
  if (!message) return;
  const conv = sbActiveConversation();
  if (!conv) return;

  document.getElementById('starblex-suggestions').innerHTML = '';
  sbAppendMessage('user', message);
  sbSetTitleFromFirstMessage(conv, message);
  sbRenderHistoryPanel();

  sbSetBusy(true);
  sbSetTyping(true);

  // El backend obtiene el inventario REAL directamente de Firestore —
  // aquí solo indicamos, como mucho, cuál vehículo se está viendo (por
  // ID). Nunca se manda el objeto del vehículo ni el inventario
  // completo: el backend no los lee, son fuente no confiable.
  const vehicleId = sbVehicleIdForRequest(conv);
  const historyToSend = conv.messages
    .slice(0, -1) // sin el mensaje que se acaba de agregar
    .slice(-STARBLEX_MAX_HISTORY_TURNS);

  try {
    const res = await fetch(STARBLEX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: historyToSend, vehicleId }),
    });

    const data = await res.json().catch(() => ({}));
    sbSetTyping(false);

    if (!res.ok || !data.reply) {
      sbAppendMessage('error', data.error || 'Starblex IA no está disponible en este momento. Inténtalo nuevamente.');
      return;
    }
    sbAppendMessage('bot', data.reply);
  } catch (e) {
    sbSetTyping(false);
    sbAppendMessage('error', 'Starblex IA no está disponible en este momento. Inténtalo nuevamente.');
  } finally {
    sbSetBusy(false);
    document.getElementById('starblex-input')?.focus();
  }
}

// ------------------------------------------------------------
// Abrir / cerrar
// ------------------------------------------------------------
function openStarblexPanel() {
  const panel = sbBuildPanel();
  if (!sbActiveConversation()) sbNewConversation();
  sbRenderMessages();
  sbUpdateContextBar();
  panel.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
  setTimeout(() => document.getElementById('starblex-input')?.focus(), 50);
}
function closeStarblexPanel() {
  if (_sbPanelEl) _sbPanelEl.classList.add('hidden');
  document.getElementById('starblex-history-panel')?.classList.add('hidden');
}

window.LB_STARBLEX = { open: openStarblexPanel, close: closeStarblexPanel };
