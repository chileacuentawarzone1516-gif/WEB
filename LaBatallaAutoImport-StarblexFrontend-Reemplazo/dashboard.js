const DB_RECENT_KEY = 'labatalla_recent_views_v1';
function dbGetRecentViews() {
  try { return JSON.parse(localStorage.getItem(DB_RECENT_KEY) || '[]'); } catch (e) { return []; }
}
function dbTrackView(id) {
  try {
    let list = dbGetRecentViews().filter(x => x.id !== id);
    list.unshift({ id, ts: Date.now() });
    list = list.slice(0, 12);
    localStorage.setItem(DB_RECENT_KEY, JSON.stringify(list));
  } catch (e) {}

  // Fase 1.3: además del localStorage (funciona sin sesión), si hay
  // usuario logueado se guarda también en Firestore para que el
  // historial sobreviva a un cierre de sesión / cambio de dispositivo.
  try {
    const { user } = typeof getCurrentUser === 'function' ? getCurrentUser() : {};
    if (user && typeof addHistoryEntry === 'function') addHistoryEntry(id).catch(() => {});
  } catch (e) {}
}

const DB_LAST_ACCESS_KEY = 'labatalla_last_access_v1';
function dbTouchLastAccess() {
  let prev = null;
  try { prev = localStorage.getItem(DB_LAST_ACCESS_KEY); } catch (e) {}
  try { localStorage.setItem(DB_LAST_ACCESS_KEY, String(Date.now())); } catch (e) {}
  return prev ? Number(prev) : null;
}

function dbComputeRecommendations(limit = 4) {
  const favIds = getFavorites();
  const viewedIds = dbGetRecentViews().map(x => x.id);
  const excludeIds = new Set([...favIds, ...viewedIds]);
  const interacted = [...favIds, ...viewedIds].map(id => vehicles.find(v => v.id === id)).filter(Boolean);
  if (interacted.length === 0) {
    return [...vehicles].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
  }
  const catCount = {}, brandCount = {};
  interacted.forEach(v => {
    if (v.category) catCount[v.category] = (catCount[v.category] || 0) + 1;
    if (v.brand) brandCount[v.brand] = (brandCount[v.brand] || 0) + 1;
  });
  const topCats = Object.keys(catCount).sort((a, b) => catCount[b] - catCount[a]);
  const topBrands = Object.keys(brandCount).sort((a, b) => brandCount[b] - brandCount[a]);
  const scored = vehicles.filter(v => !excludeIds.has(v.id)).map(v => {
    let score = 0;
    if (topBrands.includes(v.brand)) score += 3;
    if (topCats.includes(v.category)) score += 2;
    return { v, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const result = scored.slice(0, limit).map(x => x.v);
  if (result.length < limit) {
    const fill = [...vehicles].filter(v => !excludeIds.has(v.id) && !result.includes(v)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    result.push(...fill.slice(0, limit - result.length));
  }
  return result;
}

function dbToMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  return null;
}
function dbFormatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' });
}
function dbFormatRelative(ts) {
  if (!ts) return '—';
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'Justo ahora';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Hace ${diffH} h`;
  return `Hace ${Math.floor(diffH / 24)} d`;
}
function dbThumb(v) {
  const raw = v.media && v.media.length > 0
    ? (typeof v.media[0] === 'string' ? v.media[0] : (v.media[0].src || v.img || ''))
    : (v.img || 'https://placehold.co/120x120/1e293b/38bdf8?text=Auto');
  return cldOptimize(raw, 120);
}
function dbGetInitials(name) {
  if (!name) return '👤';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || '👤';
}
function dbGreetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
function dbProfileCompletion() {
  let checks = 0;
  if (getFavorites().length > 0) checks++;
  if (dbGetRecentViews().length > 0) checks++;
  return Math.round((checks / 2) * 100);
}

function dbRenderProfile(user, profile, lastAccessPrev) {
  const avatar = document.getElementById('db-avatar');
  if (profile.photoURL) {
    avatar.innerHTML = `<img src="${escapeAttr(profile.photoURL)}" alt="" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } else {
    avatar.textContent = dbGetInitials(profile.name);
  }
  document.getElementById('db-greeting').textContent = dbGreetingWord() + ',';
  document.getElementById('db-name').textContent = profile.name || 'Cliente';

  const emailBadge = document.getElementById('db-email-badge');
  emailBadge.className = user.emailVerified ? 'db-badge db-badge--ok' : 'db-badge db-badge--warn';
  emailBadge.innerHTML = `<i data-lucide="mail"></i> ${escapeHtml(profile.email)} · ${user.emailVerified ? 'verificado' : 'no verificado — toca para reenviar'}`;
  emailBadge.style.cursor = user.emailVerified ? 'default' : 'pointer';
  emailBadge.onclick = user.emailVerified ? null : () => handleResendVerification();

  const pct = dbProfileCompletion();
  document.getElementById('db-progress-pct').textContent = pct + '%';
  document.getElementById('db-progress-fill').style.width = pct + '%';

  document.getElementById('db-last-access').textContent = lastAccessPrev ? dbFormatRelative(lastAccessPrev) : 'Primera visita';
  document.getElementById('db-since').textContent = dbFormatDate(dbToMillis(profile.createdAt));
  lucide.createIcons();
}

function dbRenderPerfil(user, profile) {
  document.getElementById('db-profile-email').textContent = profile.email || '—';
  document.getElementById('db-profile-uid').textContent = user.uid;
  document.getElementById('db-profile-provider').textContent = profile.provider === 'google.com' ? 'Google' : 'Correo y contraseña';
  document.getElementById('db-profile-created').textContent = dbFormatDate(dbToMillis(profile.createdAt));
  document.getElementById('db-profile-lastlogin').textContent = profile.lastLogin ? dbFormatRelative(dbToMillis(profile.lastLogin)) : '—';

  document.getElementById('db-profile-name').value = profile.name || '';
  document.getElementById('db-profile-lastname').value = profile.lastName || '';
  document.getElementById('db-profile-username').value = profile.username || '';
  document.getElementById('db-profile-city').value = profile.city || '';
  document.getElementById('db-profile-phone').value = profile.phone || '';
  document.getElementById('db-profile-photo').value = profile.photoURL || '';
  document.getElementById('db-profile-address').value = profile.address || '';
  document.getElementById('db-profile-country').value = profile.country || '';
}

let dbProfileSaveBusy = false;
async function handleSaveProfile() {
  if (dbProfileSaveBusy) return;
  const errorEl = document.getElementById('db-profile-error');
  errorEl.classList.add('hidden');

  const name = document.getElementById('db-profile-name').value.trim();
  if (!name) {
    errorEl.textContent = 'El nombre no puede quedar vacío.';
    errorEl.classList.remove('hidden');
    return;
  }

  const fields = {
    name,
    lastName: document.getElementById('db-profile-lastname').value.trim(),
    username: document.getElementById('db-profile-username').value.trim(),
    city: document.getElementById('db-profile-city').value.trim(),
    phone: document.getElementById('db-profile-phone').value.trim(),
    photoURL: document.getElementById('db-profile-photo').value.trim(),
    address: document.getElementById('db-profile-address').value.trim(),
    country: document.getElementById('db-profile-country').value.trim(),
  };

  dbProfileSaveBusy = true;
  const btn = document.getElementById('db-profile-save-btn');
  setBtnBusy(btn, true, '⏳ Guardando...', 'Guardar cambios');
  try {
    const result = await updateUserProfile(fields);
    if (!result.success) {
      errorEl.textContent = result.message || 'No se pudo guardar. Intenta de nuevo.';
      errorEl.classList.remove('hidden');
      return;
    }
    const { user, profile } = getCurrentUser();
    dbRenderProfile(user, profile, _dbPrevAccessCache);
    dbRenderPerfil(user, profile);
    showToast('✅ Perfil actualizado');
  } finally {
    dbProfileSaveBusy = false;
    setBtnBusy(btn, false, '', 'Guardar cambios');
  }
}

let dbPasswordChangeBusy = false;
async function handleChangePassword() {
  if (dbPasswordChangeBusy) return;
  const errorEl = document.getElementById('db-password-error');
  errorEl.classList.add('hidden');

  const current = document.getElementById('db-current-password').value;
  const next = document.getElementById('db-new-password').value;
  const confirm = document.getElementById('db-confirm-password').value;

  if (!current) { errorEl.textContent = 'Ingresa tu contraseña actual.'; errorEl.classList.remove('hidden'); return; }
  if (!next || next.length < 8) { errorEl.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; errorEl.classList.remove('hidden'); return; }
  if (next !== confirm) { errorEl.textContent = 'Las contraseñas nuevas no coinciden.'; errorEl.classList.remove('hidden'); return; }

  dbPasswordChangeBusy = true;
  const btn = document.getElementById('db-change-password-btn');
  setBtnBusy(btn, true, '⏳ Actualizando...', 'Cambiar contraseña');
  try {
    const result = await changePassword(current, next);
    if (!result.success) {
      errorEl.textContent = result.message || 'No se pudo cambiar la contraseña.';
      errorEl.classList.remove('hidden');
      return;
    }
    document.getElementById('db-current-password').value = '';
    document.getElementById('db-new-password').value = '';
    document.getElementById('db-confirm-password').value = '';
    showToast('✅ Contraseña actualizada correctamente');
  } finally {
    dbPasswordChangeBusy = false;
    setBtnBusy(btn, false, '', 'Cambiar contraseña');
  }
}

// ============================================================
// FASE 1 — Favoritos (pestaña dedicada, datos remotos de Firestore)
// ============================================================
async function dbRenderFavoritos() {
  const wrap = document.getElementById('db-fav-content');
  wrap.innerHTML = dbSkeletonList(3);
  const remote = await getFavoritesRemote();
  const ids = remote.success ? remote.ids : getFavorites();
  const favVehicles = ids.map(id => vehicles.find(v => v.id === id)).filter(Boolean);

  if (favVehicles.length === 0) {
    wrap.innerHTML = `<div class="db-empty"><i data-lucide="heart"></i><p>Aún no tienes favoritos. Toca el corazón en cualquier vehículo para guardarlo aquí.</p></div>`;
    lucide.createIcons();
    return;
  }

  wrap.innerHTML = favVehicles.map(v => `
    <div class="db-hist-item" data-veh-id="${escapeAttr(v.id)}">
      <img src="${escapeAttr(dbThumb(v))}" alt="${escapeAttr(v.name)}" onerror="this.src='https://placehold.co/80x80/1e293b/38bdf8?text=Auto'">
      <div style="flex:1;min-width:0;"><p class="db-hist-item-name">${escapeHtml(v.name)}</p><p class="db-hist-item-meta">${escapeHtml(fmtPrice(v.price, v))}</p></div>
      <button type="button" class="db-remove-btn" data-remove-fav="${escapeAttr(v.id)}" aria-label="Quitar de favoritos"><i data-lucide="trash-2"></i></button>
    </div>`).join('');

  wrap.querySelectorAll('[data-veh-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-remove-fav]')) return;
      closeDashboardPage(); window.scrollTo(0, 0); openDetail(el.dataset.vehId);
    });
  });
  wrap.querySelectorAll('[data-remove-fav]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.removeFav;
      if (!confirm('¿Quitar este vehículo de tus favoritos?')) return;
      toggleFavorite(id); // ya sincroniza con Firestore internamente
      showToast('💔 Quitado de favoritos');
      dbRenderFavoritos();
      dbRenderCards();
    });
  });
  lucide.createIcons();
}

// ============================================================
// FASE 1 — Cotizaciones (pestaña dedicada, Firestore)
// ============================================================
async function dbRenderCotizaciones() {
  const wrap = document.getElementById('db-quotes-content');
  wrap.innerHTML = dbSkeletonList(3);
  const result = await getQuotesRemote();

  if (!result.success || result.items.length === 0) {
    wrap.innerHTML = `<div class="db-empty"><i data-lucide="calculator"></i><p>Aún no has guardado ninguna cotización. Usa la calculadora de financiamiento para generar una.</p></div>`;
    lucide.createIcons();
    return;
  }

  wrap.innerHTML = result.items.map(q => `
    <div class="db-hist-item" data-quote-id="${escapeAttr(q.id)}">
      <div class="db-quote-icon"><i data-lucide="calculator"></i></div>
      <div style="flex:1;min-width:0;">
        <p class="db-hist-item-name">${escapeHtml(q.vehicleName)}</p>
        <p class="db-hist-item-meta">Cuota: ${escapeHtml(fmtPrice(q.monthlyPayment))} / mes · ${q.termMonths} meses · ${escapeHtml(dbFormatRelative(dbToMillis(q.createdAt)))}</p>
      </div>
      <button type="button" class="db-remove-btn" data-remove-quote="${escapeAttr(q.id)}" aria-label="Eliminar cotización"><i data-lucide="trash-2"></i></button>
    </div>`).join('');

  wrap.querySelectorAll('[data-remove-quote]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('¿Eliminar esta cotización guardada?')) return;
      const res = await deleteQuote(btn.dataset.removeQuote);
      if (res.success) { showToast('🗑️ Cotización eliminada'); dbRenderCotizaciones(); }
      else showToast('❌ No se pudo eliminar');
    });
  });
  lucide.createIcons();
}

// ============================================================
// "MIS PUBLICACIONES" — solo admin/editor. Reutiliza `vehicles` (ya
// cargado por app.js, cero lecturas nuevas a Firestore),
// openPublishModal() y requestVehicleDelete()/#delete-modal tal cual
// existen. La visibilidad del tab es solo UX (ver openDashboardPage);
// la autorización real de editar/eliminar la sigue decidiendo
// firestore.rules, sin cambios.
// ============================================================
function dbCategoryLabel(cat) {
  return cat === 'sedanes' ? 'Sedán' : cat === 'suvs' ? 'SUV' : cat === 'pickups' ? 'Pickup' : (cat || '—');
}
function dbRenderPublicaciones() {
  const wrap = document.getElementById('db-pub-content');
  if (!wrap) return;

  if (!Array.isArray(vehicles) || vehicles.length === 0) {
    wrap.innerHTML = `<div class="db-empty"><i data-lucide="car"></i><p>Todavía no hay vehículos publicados.</p><span>Usa el botón "Publicar" del menú principal para crear el primero.</span></div>`;
    lucide.createIcons();
    return;
  }

  const total = vehicles.length;
  const nSedanes = vehicles.filter(v => v.category === 'sedanes').length;
  const nSuvs = vehicles.filter(v => v.category === 'suvs').length;
  const nPickups = vehicles.filter(v => v.category === 'pickups').length;

  const statsHtml = `
    <div class="db-badges" style="margin-bottom:16px;">
      <span class="db-badge">Total: ${total}</span>
      <span class="db-badge">Sedanes: ${nSedanes}</span>
      <span class="db-badge">SUVs: ${nSuvs}</span>
      <span class="db-badge">Pickups: ${nPickups}</span>
    </div>`;

  const listHtml = vehicles.map(v => `
    <div class="db-hist-item" data-veh-id="${escapeAttr(v.id)}">
      <img src="${escapeAttr(dbThumb(v))}" alt="${escapeAttr(v.name)}" onerror="this.src='https://placehold.co/80x80/1e293b/38bdf8?text=Auto'">
      <div style="flex:1;min-width:0;">
        <p class="db-hist-item-name">${escapeHtml(v.name)}</p>
        <p class="db-hist-item-meta">${escapeHtml(fmtPrice(v.price, v))} · ${escapeHtml(dbCategoryLabel(v.category))}</p>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button type="button" class="db-edit-btn" data-edit-veh="${escapeAttr(v.id)}" aria-label="Editar ${escapeAttr(v.name)}"><i data-lucide="pencil"></i></button>
        <button type="button" class="db-remove-btn" data-delete-veh="${escapeAttr(v.id)}" aria-label="Eliminar ${escapeAttr(v.name)}"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`).join('');

  wrap.innerHTML = statsHtml + listHtml;

  wrap.querySelectorAll('[data-edit-veh]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = vehicles.find(x => x.id === btn.dataset.editVeh);
      if (v) openPublishModal(v); // formulario existente, sin duplicar
    });
  });
  wrap.querySelectorAll('[data-delete-veh]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestVehicleDelete(btn.dataset.deleteVeh, 'dashboard'); // #delete-modal existente, sin duplicar
    });
  });
  lucide.createIcons();
}

// Skeleton de carga simple, reutilizado por favoritos y cotizaciones
// mientras esperan la respuesta de Firestore.
function dbSkeletonList(n) {
  return Array.from({ length: n }).map(() => `
    <div class="db-hist-item db-skeleton">
      <div class="db-skeleton-thumb"></div>
      <div style="flex:1;min-width:0;">
        <div class="db-skeleton-line" style="width:60%;"></div>
        <div class="db-skeleton-line" style="width:35%;margin-top:6px;"></div>
      </div>
    </div>`).join('');
}

// ============================================================
// FASE 1 — Preferencias de búsqueda (dentro de la pestaña Perfil)
// ============================================================
async function dbRenderPreferencias() {
  const result = await getPreferences();
  const prefs = (result.success && result.prefs) || {};
  document.getElementById('db-pref-price-min').value = prefs.priceMin ?? '';
  document.getElementById('db-pref-price-max').value = prefs.priceMax ?? '';
  document.getElementById('db-pref-vehicle-type').value = prefs.vehicleType || '';
  document.getElementById('db-pref-transmission').value = prefs.transmission || '';
  document.getElementById('db-pref-fuel').value = prefs.fuel || '';
  document.getElementById('db-pref-brands').value = (prefs.brands || []).join(', ');
}

let dbPrefsSaveBusy = false;
async function handleSavePreferences() {
  if (dbPrefsSaveBusy) return;
  const btn = document.getElementById('db-pref-save-btn');
  dbPrefsSaveBusy = true;
  setBtnBusy(btn, true, '⏳ Guardando...', 'Guardar preferencias');
  try {
    const brandsRaw = document.getElementById('db-pref-brands').value.trim();
    const prefs = {
      priceMin: Number(document.getElementById('db-pref-price-min').value) || null,
      priceMax: Number(document.getElementById('db-pref-price-max').value) || null,
      vehicleType: document.getElementById('db-pref-vehicle-type').value,
      transmission: document.getElementById('db-pref-transmission').value,
      fuel: document.getElementById('db-pref-fuel').value,
      brands: brandsRaw ? brandsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20) : [],
    };
    const result = await savePreferences(prefs);
    if (!result.success) { showToast('❌ ' + (result.message || 'No se pudieron guardar las preferencias')); return; }
    showToast('✅ Preferencias guardadas');
  } finally {
    dbPrefsSaveBusy = false;
    setBtnBusy(btn, false, '', 'Guardar preferencias');
  }
}


function dbRenderCards() {
  const grid = document.getElementById('db-grid');
  const favIds = getFavorites();
  const favVehicles = favIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean);
  const recent = dbGetRecentViews().map(x => vehicles.find(v => v.id === x.id)).filter(Boolean);
  const recommended = dbComputeRecommendations(4);

  const cards = [
    { icon: 'heart', title: 'Favoritos', count: favVehicles.length,
      sub: favVehicles.length ? 'Vehículos que guardaste' : 'Toca ❤️ en cualquier vehículo para guardarlo aquí',
      preview: favVehicles.slice(0, 3), cta: 'Ver todos', onClick: () => dbSetTab('favoritos') },
    { icon: 'eye', title: 'Vistos recientemente', count: recent.length,
      sub: recent.length ? 'Últimos vehículos que revisaste' : 'Explora el inventario para construir tu historial',
      preview: recent.slice(0, 3), cta: 'Ver historial',
      onClick: () => { dbSetTab('historial'); document.getElementById('db-hist-vistos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
    { icon: 'car', title: 'Recomendados para ti', count: recommended.length,
      sub: 'Según tus marcas y categorías de interés (reglas de negocio, sin IA)',
      preview: recommended.slice(0, 3), cta: 'Explorar',
      onClick: () => { closeDashboardPage(); window.scrollTo(0, 0); scrollToSection(recommended[0]?.category || 'sedanes'); } },
    { icon: 'file-text', title: 'Cotizaciones guardadas', count: _dbQuoteCountCache, sub: 'Simulaciones de la calculadora de financiamiento', onClick: () => dbSetTab('cotizaciones') },
    { icon: 'sliders-horizontal', title: 'Preferencias de búsqueda', count: 0, sub: 'Marcas, precio, transmisión y combustible favoritos', onClick: () => dbSetTab('perfil') }
  ];

  grid.innerHTML = cards.map((c, i) => `
    <div class="db-card" data-card-idx="${i}">
      <div class="db-card-head"><div class="db-card-icon"><i data-lucide="${c.icon}"></i></div><span class="db-card-count">${c.count}</span></div>
      <p class="db-card-title">${escapeHtml(c.title)}</p>
      <p class="db-card-sub">${escapeHtml(c.sub)}</p>
      ${c.preview && c.preview.length ? `<div class="db-card-preview">${c.preview.map(v => `<img class="db-mini-thumb" src="${escapeAttr(dbThumb(v))}" alt="${escapeAttr(v.name)}" onerror="this.src='https://placehold.co/80x80/1e293b/38bdf8?text=Auto'">`).join('')}</div>` : ''}
      <span class="db-card-cta">${escapeHtml(c.cta || 'Ver más')} <i data-lucide="arrow-right" style="width:13px;height:13px;"></i></span>
    </div>`).join('');
  grid.querySelectorAll('.db-card').forEach(el => el.addEventListener('click', () => cards[Number(el.dataset.cardIdx)].onClick()));
  lucide.createIcons();

  // El conteo real de cotizaciones se pide aparte (async) para no bloquear
  // el resto de la vista; se rellena solo el número cuando llega.
  getQuotesRemote().then(r => {
    _dbQuoteCountCache = r.success ? r.items.length : 0;
    const countEl = grid.querySelector('[data-card-idx="3"] .db-card-count');
    if (countEl) countEl.textContent = _dbQuoteCountCache;
  });
}
let _dbQuoteCountCache = 0;

async function dbRenderHistory() {
  const wrap = document.getElementById('db-history-content');
  const favIds = getFavorites();
  const favVehicles = favIds.map(id => vehicles.find(v => v.id === id)).filter(Boolean);

  // Fase 1.3: fusionar historial local (funciona sin sesión) con el
  // remoto de Firestore (sobrevive a cerrar sesión / cambiar de
  // dispositivo). Se dedupe por vehicleId, quedándose con la vista
  // más reciente de cada uno. remoteIdsByVehicle guarda TODOS los
  // documentos remotos de cada vehículo, para poder borrarlos todos
  // de una vez si el usuario elimina esa entrada del historial.
  const local = dbGetRecentViews().map(x => ({ id: x.id, ts: x.ts }));
  let combined = [...local];
  const remoteIdsByVehicle = {};
  if (typeof getHistoryRemote === 'function') {
    const remote = await getHistoryRemote();
    if (remote.success) {
      const remoteMapped = remote.items.map(it => ({ id: it.vehicleId, ts: dbToMillis(it.viewedAt) || Date.now() }));
      for (const it of remote.items) {
        (remoteIdsByVehicle[it.vehicleId] = remoteIdsByVehicle[it.vehicleId] || []).push(it.id);
      }
      const seen = new Map();
      for (const item of [...combined, ...remoteMapped]) {
        if (!seen.has(item.id) || seen.get(item.id).ts < item.ts) seen.set(item.id, item);
      }
      combined = Array.from(seen.values()).sort((a, b) => b.ts - a.ts).slice(0, 12);
    }
  }
  const recent = combined.map(x => ({ v: vehicles.find(v => v.id === x.id), ts: x.ts })).filter(x => x.v);

  const histItem = (v, metaText, removable) => `
    <div class="db-hist-item" ${removable ? `data-hist-veh-id="${escapeAttr(v.id)}"` : ''}>
      <img src="${escapeAttr(dbThumb(v))}" alt="${escapeAttr(v.name)}" onerror="this.src='https://placehold.co/80x80/1e293b/38bdf8?text=Auto'">
      <div style="flex:1;min-width:0;"><p class="db-hist-item-name">${escapeHtml(v.name)}</p><p class="db-hist-item-meta">${escapeHtml(metaText)}</p></div>
      ${removable ? `<button type="button" class="db-remove-btn" data-remove-hist="${escapeAttr(v.id)}" aria-label="Quitar del historial"><i data-lucide="trash-2"></i></button>` : ''}
    </div>`;
  const emptyBlock = (msg) => `<div class="db-empty"><i data-lucide="inbox"></i><p>${escapeHtml(msg)}</p></div>`;
  wrap.innerHTML = `
    <div class="db-hist-group" id="db-hist-vistos"><h3><i data-lucide="eye"></i> Vehículos vistos</h3>${recent.length ? recent.map(x => histItem(x.v, dbFormatRelative(x.ts), true)).join('') : emptyBlock('Aún no has visto ningún vehículo')}</div>
    <div class="db-hist-group"><h3><i data-lucide="heart"></i> Favoritos agregados</h3>${favVehicles.length ? favVehicles.map(v => histItem(v, 'En tus favoritos', false)).join('') : emptyBlock('Aún no tienes favoritos')}</div>
    <div class="db-hist-group"><h3><i data-lucide="file-text"></i> Cotizaciones realizadas</h3><p style="color:#64748b;font-size:12px;">Ver detalle completo en la pestaña "Cotizaciones".</p></div>`;
  wrap.querySelectorAll('.db-hist-item').forEach((el, idx) => {
    const allClickable = [...recent.map(x => x.v), ...favVehicles];
    const v = allClickable[idx];
    if (v) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-remove-hist]')) return;
        closeDashboardPage(); window.scrollTo(0, 0); openDetail(v.id);
      });
    }
  });
  wrap.querySelectorAll('[data-remove-hist]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const vehId = btn.dataset.removeHist;
      if (!confirm('¿Quitar este vehículo de tu historial?')) return;
      try {
        let list = dbGetRecentViews().filter(x => x.id !== vehId);
        localStorage.setItem(DB_RECENT_KEY, JSON.stringify(list));
      } catch (err) {}
      const remoteIds = remoteIdsByVehicle[vehId] || [];
      await Promise.all(remoteIds.map(id => deleteHistoryEntry(id).catch(() => {})));
      showToast('🗑️ Quitado del historial');
      dbRenderHistory();
    });
  });
  lucide.createIcons();
}

function dbSetTab(tab) {
  document.querySelectorAll('.db-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('db-panel-resumen').classList.toggle('hidden', tab !== 'resumen');
  document.getElementById('db-panel-historial').classList.toggle('hidden', tab !== 'historial');
  document.getElementById('db-panel-perfil').classList.toggle('hidden', tab !== 'perfil');
  document.getElementById('db-panel-favoritos').classList.toggle('hidden', tab !== 'favoritos');
  document.getElementById('db-panel-cotizaciones').classList.toggle('hidden', tab !== 'cotizaciones');
  document.getElementById('db-panel-publicaciones')?.classList.toggle('hidden', tab !== 'publicaciones');
  if (tab === 'historial') dbRenderHistory();
  if (tab === 'favoritos') dbRenderFavoritos();
  if (tab === 'cotizaciones') dbRenderCotizaciones();
  if (tab === 'publicaciones') dbRenderPublicaciones();
  if (tab === 'perfil') {
    const { user, profile } = getCurrentUser();
    if (user && profile) { dbRenderPerfil(user, profile); dbRenderPreferencias(); }
  }
}

const DB_QUICK_ACTIONS = [
  { icon: 'user-cog', label: 'Editar perfil', action: () => dbSetTab('perfil') },
  { icon: 'key-round', label: 'Cambiar contraseña', action: () => { dbSetTab('perfil'); document.getElementById('db-password-section')?.scrollIntoView({ behavior: 'smooth' }); } },
  { icon: 'sliders-horizontal', label: 'Preferencias', action: () => { dbSetTab('perfil'); document.getElementById('db-preferences-section')?.scrollIntoView({ behavior: 'smooth' }); } },
  { icon: 'heart', label: 'Ver favoritos', action: () => dbSetTab('favoritos') },
  { icon: 'file-text', label: 'Ver cotizaciones', action: () => dbSetTab('cotizaciones') },
  { icon: 'eye', label: 'Vehículos vistos', action: () => { dbSetTab('historial'); document.getElementById('db-hist-vistos')?.scrollIntoView({ behavior: 'smooth' }); } },
  { icon: 'bot', label: 'Hablar con Starblex IA', action: () => document.getElementById('fab-starblex-btn')?.click() },
  { icon: 'car', label: 'Explorar inventario', action: () => { closeDashboardPage(); window.scrollTo(0, 0); } }
];
function dbRenderQuickActions() {
  const grid = document.getElementById('db-quick-grid');
  grid.innerHTML = DB_QUICK_ACTIONS.map((a, i) => `<button type="button" class="db-quick-btn" data-qa-idx="${i}"><i data-lucide="${a.icon}"></i><span>${escapeHtml(a.label)}</span></button>`).join('');
  grid.querySelectorAll('.db-quick-btn').forEach(btn => btn.addEventListener('click', () => DB_QUICK_ACTIONS[Number(btn.dataset.qaIdx)].action()));
  lucide.createIcons();
}

let _dbPrevAccessCache = null;
async function openDashboardPage(push = true) {
  let state;
  try { state = await waitForAuthReady(); }
  catch (e) { console.error('Timeout esperando sesión:', e); showToast('⚠️ No se pudo verificar tu sesión — intenta de nuevo'); return; }
  const { user, profile } = state;
  if (!user || !profile) { showToast('👋 Inicia sesión para ver tu panel personal'); openAccountModal('fav'); return; }

  const prevAccess = dbTouchLastAccess();
  _dbPrevAccessCache = prevAccess;
  document.getElementById('main-page').classList.add('page-hidden');
  document.getElementById('detail-page')?.classList.add('page-hidden');
  document.getElementById('not-found-page')?.classList.add('page-hidden');
  document.getElementById('dashboard-page').classList.remove('page-hidden');

  // Solo UX: decide si se ve el tab. La autorización real de
  // editar/eliminar sigue dependiendo de firestore.rules, no de esto.
  document.getElementById('db-tab-publicaciones')?.classList.toggle('hidden', !canManageVehicles());

  dbRenderProfile(user, profile, prevAccess);
  dbRenderQuickActions();
  dbRenderCards();
  dbSetTab('resumen');
  window.scrollTo(0, 0);
  try { if (push && window.self === window.top) history.pushState({ dashboard: true }, '', '/dashboard'); } catch (e) {}
}
function closeDashboardPage(push = true) {
  document.getElementById('dashboard-page').classList.add('page-hidden');
  document.getElementById('main-page').classList.remove('page-hidden');
  try { if (push && window.self === window.top) history.pushState(null, '', '/'); } catch (e) {}
}

window.LB_DASHBOARD = { trackView: dbTrackView, open: openDashboardPage, close: closeDashboardPage };

let dbPhotoUploadBusy = false;
async function handleProfilePhotoUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (dbPhotoUploadBusy) return;
  dbPhotoUploadBusy = true;
  const statusEl = document.getElementById('db-photo-upload-status');
  statusEl.textContent = '⏳ Subiendo foto...';
  statusEl.className = 'text-sky-400 text-[11px] mt-1';
  try {
    const url = await uploadProfilePhoto(file);
    document.getElementById('db-profile-photo').value = url;
    const result = await updateUserProfile({ photoURL: url });
    if (!result.success) {
      statusEl.textContent = '❌ ' + (result.message || 'No se pudo guardar la foto.');
      statusEl.className = 'text-red-400 text-[11px] mt-1';
      return;
    }
    const { user, profile } = getCurrentUser();
    dbRenderProfile(user, profile, _dbPrevAccessCache);
    statusEl.textContent = '✅ Foto actualizada';
    statusEl.className = 'text-emerald-400 text-[11px] mt-1';
    showToast('✅ Foto de perfil actualizada');
  } catch (err) {
    console.error('Error subiendo foto de perfil:', err);
    statusEl.textContent = '❌ ' + (err.message || 'No se pudo subir la foto.');
    statusEl.className = 'text-red-400 text-[11px] mt-1';
  } finally {
    dbPhotoUploadBusy = false;
    e.target.value = '';
  }
}

function dbInit() {
  document.getElementById('db-back-btn')?.addEventListener('click', () => closeDashboardPage());
  document.getElementById('db-logout-btn')?.addEventListener('click', async () => {
    const result = await logoutUser();
    if (!result.success) { showToast('❌ No se pudo cerrar sesión — sigues conectado'); return; }
    // El listener onUserChanged de más abajo cierra el dashboard y muestra
    // el toast; no se duplica aquí para evitar doble notificación.
  });
  document.querySelectorAll('.db-tab').forEach(tab => tab.addEventListener('click', () => dbSetTab(tab.dataset.tab)));
  document.getElementById('db-profile-save-btn')?.addEventListener('click', handleSaveProfile);
  document.getElementById('db-change-password-btn')?.addEventListener('click', handleChangePassword);
  document.getElementById('db-pref-save-btn')?.addEventListener('click', handleSavePreferences);
  document.getElementById('db-profile-photo-file')?.addEventListener('change', handleProfilePhotoUpload);
  onUserChanged(({ user }) => {
    const dashboardVisible = !document.getElementById('dashboard-page').classList.contains('page-hidden');
    if (dashboardVisible && !user) { closeDashboardPage(); showToast('🔒 Tu sesión terminó'); }
  });
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', dbInit); } else { dbInit(); }
