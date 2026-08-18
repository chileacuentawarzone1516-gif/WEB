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

// Varios mensajes de bienvenida genéricos — se elige UNO por sesión de
// navegador (no uno distinto cada vez que se abre el panel, ni uno por
// mensaje: eso sería spam). El primero es el original, sin tocar; los
// demás son variantes cortas al estilo de asistentes modernos.
const STARBLEX_WELCOME_MESSAGES = [
  'Hola, soy Starblex IA 1.0, el asistente de inteligencia artificial de La Batalla Auto Import. Puedo ayudarte a conocer vehículos, resolver dudas, entender posibles problemas, comparar opciones y evaluar una compra.',
  '👋 ¡Hola! Soy Starblex IA. ¿Qué vehículo estás buscando hoy?',
  '🚗 ¿Buscas un vehículo para uso diario o algo más específico? Puedo ayudarte a elegir.',
  '💰 ¿Quieres saber cuánto pagarías al mes financiando un vehículo? Pregúntame.',
  '🔎 ¿Necesitas ayuda para comparar dos vehículos del inventario?',
  '🛠️ ¿Tienes una duda sobre mantenimiento o algún diagnóstico? Puedo orientarte.',
];

// ------------------------------------------------------------
// Estado — varias conversaciones en memoria, ninguna persistida.
// ------------------------------------------------------------
let _sbConversations = []; // [{id, title, renamed, messages:[{role,content}], dismissedVehicleId}]
let _sbActiveId = null;
let _sbPanelEl = null;
let _sbBusy = false;

function sbNewConversation() {
  const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
  const conv = { id, title: 'Nueva conversación', renamed: false, messages: [], dismissedVehicleId: null, contextVehicleId: null };
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

// Un mensaje de bienvenida fijo por sesión de navegador — se guarda en
// sessionStorage para que no cambie entre aperturas del panel dentro de
// la misma pestaña, pero sí pueda variar en una sesión nueva. Si
// sessionStorage no está disponible (modo privado estricto, etc.) no
// rompe nada: simplemente no persiste, elige uno al azar cada vez.
function sbGetWelcomeMessage() {
  const KEY = 'starblex_welcome_idx';
  try {
    const stored = sessionStorage.getItem(KEY);
    const parsed = stored !== null ? parseInt(stored, 10) : NaN;
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed < STARBLEX_WELCOME_MESSAGES.length) {
      return STARBLEX_WELCOME_MESSAGES[parsed];
    }
    const idx = Math.floor(Math.random() * STARBLEX_WELCOME_MESSAGES.length);
    sessionStorage.setItem(KEY, String(idx));
    return STARBLEX_WELCOME_MESSAGES[idx];
  } catch (e) {
    return STARBLEX_WELCOME_MESSAGES[Math.floor(Math.random() * STARBLEX_WELCOME_MESSAGES.length)];
  }
}

// Si hay un vehículo real en pantalla y no fue "quitado" de esta
// conversación (mismo criterio que ya usa sbUpdateContextBar), saluda
// mencionándolo por nombre en vez del mensaje genérico rotativo. El
// nombre viene del mismo objeto currentDetailVehicle que ya se muestra
// en la barra de contexto — ningún dato nuevo, ninguna fuente distinta.
function sbWelcomeMessageFor(conv) {
  const v = sbCurrentVehicle();
  if (v && conv && conv.dismissedVehicleId !== v.id) {
    return `👋 Veo que estás viendo el ${v.name || 'vehículo'}. ¿Qué quieres saber?`;
  }
  return sbGetWelcomeMessage();
}

function sbSuggestions() {
  const v = sbCurrentVehicle();
  if (v) {
    const name = v.name || 'este vehículo';
    // Etiquetas cortas y escaneables en el botón; el mensaje real que se
    // envía al chat es una pregunta completa y natural — nunca se manda
    // el label tal cual, para que la respuesta del modelo sea igual de
    // buena que si la persona la hubiera escrito ella misma.
    return [
      { label: 'Motor y rendimiento', query: `¿Cómo es el motor y el rendimiento del ${name}?` },
      { label: 'Precio y financiamiento', query: `¿Cuánto cuesta el ${name} y cómo puedo financiarlo?` },
      { label: 'Consumo', query: `¿Cuánto consume el ${name}?` },
      { label: 'Problemas comunes', query: `¿Qué problemas comunes tiene el ${name}?` },
      { label: 'Compararla con otra', query: `Compara el ${name} con otras opciones similares del inventario` },
    ];
  }
  return [
    { label: '¿Qué vehículos tienen disponibles?', query: '¿Qué vehículos tienen disponibles?' },
    { label: '¿Cuál SUV me recomiendas?', query: '¿Cuál SUV me recomiendas?' },
    { label: '¿Sedán o SUV, cuál me conviene?', query: '¿Qué diferencia hay entre un sedán y una SUV?' },
  ];
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
    <div class="starblex-window" style="height:min(88vh,640px);height:min(88dvh,640px);">
      <!-- height se declara dos veces a propósito: vh como fallback universal,
           dvh después como mejora progresiva. Navegadores sin soporte para dvh
           ignoran esa segunda línea y se quedan con el vh de arriba — no hay
           forma de que esto rompa nada donde ya funcionaba. Donde sí hay
           soporte (iOS Safari 15.4+, Chrome/Android modernos), dvh sigue el
           viewport visual real y se recalcula cuando aparece el teclado, a
           diferencia de vh, que queda fijo al alto "completo" y puede dejar
           el input del chat tapado por el teclado. -->
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
    const cardV = sbVehicleCardFor(conv);
    conv.contextVehicleId = cardV ? cardV.id : null;
    sbAppendMessage('bot', sbWelcomeMessageFor(conv), { persist: false, vehicleCard: cardV });
  } else {
    conv.messages.forEach((m) => sbAppendMessage(m.role, m.content, { persist: false }));
    sbMaybeAnnounceContextChange(conv);
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
    btn.textContent = s.label; // textContent — nunca HTML
    btn.addEventListener('click', () => sbSendMessage(s.query));
    wrap.appendChild(btn);
  });
}

// ------------------------------------------------------------
// SUB-FASE 3 — Tarjeta visual del vehículo (100% frontend)
// ------------------------------------------------------------
// Ni escapeHtml() ni cldOptimize() (definidas en app.js, reutilizadas
// aquí) validan el ESQUEMA de una URL — escapeHtml solo escapa
// caracteres HTML, cldOptimize solo reconoce URLs de Cloudinary y
// devuelve cualquier otra cosa intacta. Si img/media trajera algo como
// "javascript:alert(1)", ninguna de las dos lo filtraría. Este chequeo
// es nuevo y específico para esta tarjeta: solo se aceptan esquemas
// http/https/data; cualquier otra cosa cae al fallback.
function sbSafeImageUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const resolved = new URL(url, window.location.origin);
    return (resolved.protocol === 'http:' || resolved.protocol === 'https:' || resolved.protocol === 'data:')
      ? url : null;
  } catch (e) {
    return null; // URL malformada — mismo trato que una URL peligrosa: se descarta
  }
}
const STARBLEX_CARD_FALLBACK_IMG = 'https://placehold.co/400x240/1e293b/38bdf8?text=Sin+imagen';
const STARBLEX_CARD_MAX_THUMBS = 4; // "cantidad razonable", no carrusel enorme

// Mismo criterio que app.js: v.media[] son {type,src} o strings; sin
// media válido cae a v.img; sin nada válido, fallback. Sin duplicados.
function sbBuildVehicleMediaList(v) {
  const list = [];
  if (Array.isArray(v.media)) {
    v.media.forEach((m) => {
      const src = typeof m === 'string' ? m : (m && m.src);
      const safe = sbSafeImageUrl(src);
      if (safe) list.push(safe);
    });
  }
  if (list.length === 0) {
    const safeImg = sbSafeImageUrl(v.img);
    if (safeImg) list.push(safeImg);
  }
  const unique = [...new Set(list)];
  return unique.length ? unique : [STARBLEX_CARD_FALLBACK_IMG];
}

// Única fuente de verdad de "hay vehículo válido en contexto para esta
// conversación" — mismo criterio exacto que ya usan sbWelcomeMessageFor
// y sbUpdateContextBar (vehículo real + no retirado). Se centraliza
// aquí para no duplicar la condición una tercera vez.
function sbVehicleCardFor(conv) {
  const v = sbCurrentVehicle();
  if (v && conv && v.id && conv.dismissedVehicleId !== v.id) return v;
  return null;
}

// PUNTO 5 (mensajes proactivos, causa raíz confirmada): si una
// conversación YA tiene mensajes, sbRenderMessages() nunca volvía a
// mostrar contexto -- sin importar si el vehículo cambió desde el
// último mensaje. Reproducido: vehículo A con conversación -> volver
// (SPA) -> vehículo B -> reabrir Starblex mostraba el historial viejo
// de A, sin ningún aviso de que ahora se está viendo B (aunque la
// barra de contexto sí se actualizaba correctamente).
//
// Estado explícito (conv.contextVehicleId), no un flag adicional: es
// el id del vehículo del que trató el último anuncio de contexto
// mostrado en ESTA conversación. Se compara contra sbVehicleCardFor()
// (misma función ya existente, sin duplicar su lógica de
// dismissedVehicleId). Si cambió de verdad, se agrega UN mensaje
// nuevo -- persistido en el historial, no reemplaza nada. Si no
// cambió, no hace nada (sin spam). Si el usuario volvió a Home
// (currentId null), tampoco anuncia nada -- un mensaje tipo "ya no
// estás viendo nada" no aporta valor y sería ruido.
function sbMaybeAnnounceContextChange(conv) {
  if (!conv || conv.messages.length === 0) return; // caso ya cubierto por la bienvenida inicial
  const v = sbVehicleCardFor(conv);
  const currentId = v ? v.id : null;
  if (currentId === conv.contextVehicleId) return; // sin cambio real
  conv.contextVehicleId = currentId;
  if (v) {
    sbAppendMessage('bot', `👋 Ahora estás viendo el ${v.name || 'vehículo'}. ¿Qué quieres saber sobre este?`, { vehicleCard: v });
  }
}

function sbBuildVehicleCard(v) {
  const media = sbBuildVehicleMediaList(v);
  const name = (typeof v.name === 'string' && v.name.trim()) ? v.name : 'Vehículo';
  const priceText = (typeof v.price === 'number' && Number.isFinite(v.price) && typeof fmtPrice === 'function')
    ? fmtPrice(v.price, v) : 'Precio a consultar';

  const card = document.createElement('div');
  card.className = 'starblex-vehicle-card';

  // Imagen principal
  const imgWrap = document.createElement('div');
  imgWrap.className = 'starblex-vehicle-card-img-wrap';
  const img = document.createElement('img');
  img.src = typeof cldOptimize === 'function' ? cldOptimize(media[0], 500) : media[0];
  img.alt = name; // propiedad .alt — nunca innerHTML
  img.loading = 'lazy';
  img.onerror = function () { this.onerror = null; this.src = STARBLEX_CARD_FALLBACK_IMG; };
  imgWrap.appendChild(img);
  card.appendChild(imgWrap);

  // Miniaturas — solo si hay más de 1 imagen válida
  if (media.length > 1) {
    const thumbs = document.createElement('div');
    thumbs.className = 'starblex-vehicle-card-thumbs';
    thumbs.setAttribute('role', 'tablist');
    thumbs.setAttribute('aria-label', `Fotos de ${name}`);
    media.slice(0, STARBLEX_CARD_MAX_THUMBS).forEach((src, i) => {
      const thumbBtn = document.createElement('button');
      thumbBtn.type = 'button';
      thumbBtn.className = 'starblex-vehicle-card-thumb' + (i === 0 ? ' active' : '');
      thumbBtn.setAttribute('role', 'tab');
      thumbBtn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      thumbBtn.setAttribute('aria-label', `Foto ${i + 1} de ${name}`);
      const thumbImg = document.createElement('img');
      thumbImg.src = typeof cldOptimize === 'function' ? cldOptimize(src, 100) : src;
      thumbImg.alt = '';
      thumbImg.loading = 'lazy';
      thumbImg.onerror = function () { this.onerror = null; this.src = STARBLEX_CARD_FALLBACK_IMG; };
      thumbBtn.appendChild(thumbImg);
      thumbBtn.addEventListener('click', () => {
        img.src = typeof cldOptimize === 'function' ? cldOptimize(src, 500) : src;
        thumbs.querySelectorAll('.starblex-vehicle-card-thumb').forEach((t) => {
          t.classList.remove('active'); t.setAttribute('aria-selected', 'false');
        });
        thumbBtn.classList.add('active');
        thumbBtn.setAttribute('aria-selected', 'true');
      });
      thumbs.appendChild(thumbBtn);
    });
    card.appendChild(thumbs);
  }

  // Info — solo campos reales, nada inventado
  const info = document.createElement('div');
  info.className = 'starblex-vehicle-card-info';
  const nameEl = document.createElement('p');
  nameEl.className = 'starblex-vehicle-card-name';
  nameEl.textContent = name;
  const priceEl = document.createElement('p');
  priceEl.className = 'starblex-vehicle-card-price';
  priceEl.textContent = priceText;
  info.appendChild(nameEl);
  info.appendChild(priceEl);

  const metaBits = [];
  if (v.year) metaBits.push(String(v.year));
  if (v.transmission) metaBits.push(v.transmission);
  if (v.mileage) metaBits.push(`${v.mileage} km`);
  if (v.condition) metaBits.push(v.condition === 'nuevo' ? 'Nuevo' : v.condition === 'importado' ? 'Recién importado' : 'Usado');
  if (metaBits.length) {
    const metaEl = document.createElement('p');
    metaEl.className = 'starblex-vehicle-card-meta';
    metaEl.textContent = metaBits.join(' · ');
    info.appendChild(metaEl);
  }
  card.appendChild(info);

  // Botones — funcionales, reutilizan las funciones reales del sitio
  const actions = document.createElement('div');
  actions.className = 'starblex-vehicle-card-actions';

  const viewBtn = document.createElement('a');
  viewBtn.className = 'starblex-vehicle-card-btn';
  viewBtn.href = typeof getVehiclePath === 'function' ? getVehiclePath(v) : '#';
  viewBtn.textContent = 'Ver vehículo';
  viewBtn.addEventListener('click', (e) => {
    if (typeof openDetail === 'function' && v.id) {
      e.preventDefault();
      closeStarblexPanel();
      window.scrollTo(0, 0);
      openDetail(v.id);
    }
    // si openDetail no está disponible por algún motivo, el href real
    // de arriba sigue funcionando como navegación normal de respaldo
  });
  actions.appendChild(viewBtn);

  const financeBtn = document.createElement('button');
  financeBtn.type = 'button';
  financeBtn.className = 'starblex-vehicle-card-btn starblex-vehicle-card-btn--primary';
  financeBtn.textContent = 'Financiar';
  financeBtn.setAttribute('aria-label', `Financiar ${name}`);
  financeBtn.addEventListener('click', () => {
    if (typeof openCalcModal === 'function') openCalcModal(v);
  });
  actions.appendChild(financeBtn);

  card.appendChild(actions);
  return card;
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

  // Tarjeta visual del vehículo — <li> hermano, no hijo del mensaje
  // (.starblex-msg es flex-row: meterla adentro la pondría al lado de
  // la burbuja, no debajo). Solo en respuestas del bot, y solo cuando
  // el llamador decide explícitamente que corresponde (ver
  // sbVehicleCardFor) — nunca se decide aquí adentro para mantener una
  // sola fuente de verdad del criterio "vehículo en contexto".
  if (role === 'bot' && opts && opts.vehicleCard) {
    const cardLi = document.createElement('li');
    cardLi.className = 'starblex-vehicle-card-wrap';
    cardLi.appendChild(sbBuildVehicleCard(opts.vehicleCard));
    list.appendChild(cardLi);
  }

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

  // DIAGNÓSTICO (Starblex intermitente, causa raíz confirmada): antes,
  // CUALQUIER fallo -- falta de API key, error del proveedor, timeout,
  // respuesta vacía, fallo de red, incluso una respuesta que no era
  // JSON válido -- terminaba mostrando el mismo texto genérico, sin
  // dejar rastro de cuál fue la causa real. Ahora se intenta UNA vez
  // más, solo para los 2 casos que sí son genuinamente transitorios
  // (timeout del proveedor, fallo de red/fetch) -- nunca para 429
  // (reintentar de inmediato empeora el rate limit), nunca para falta
  // de API key ni error del proveedor (reintentar no arregla una
  // configuración faltante ni un bug real). Máximo 1 reintento, sin
  // backoff exponencial (ya hay 20s de por medio en el propio timeout
  // del backend) y sin duplicar el mensaje del usuario en el historial.
  const RETRYABLE_REASONS = new Set(['timeout', 'network_error']);
  async function attemptSend() {
    try {
      const res = await fetch(STARBLEX_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: historyToSend, vehicleId }),
      });
      const data = await res.json().catch(() => ({ reason: 'json_parse_error' }));
      return { ok: res.ok && !!data.reply, data };
    } catch (e) {
      console.error('Starblex: fetch rechazado', e.name, e.message);
      return { ok: false, data: { reason: 'network_error' } };
    }
  }

  try {
    let { ok, data } = await attemptSend();
    if (!ok && RETRYABLE_REASONS.has(data.reason)) {
      console.warn(`Starblex: reintentando una vez (causa: ${data.reason})`);
      ({ ok, data } = await attemptSend());
    }
    sbSetTyping(false);

    if (!ok) {
      console.error('Starblex: fallo final tras el manejo de errores. Causa:', data.reason || 'desconocida (revisar respuesta HTTP)');
      sbAppendMessage('error', data.error || 'Starblex IA no está disponible en este momento. Inténtalo nuevamente.');
      return;
    }
    sbAppendMessage('bot', data.reply, { vehicleCard: sbVehicleCardFor(conv) });
  } catch (e) {
    sbSetTyping(false);
    console.error('Starblex: excepción inesperada en sbSendMessage', e);
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
