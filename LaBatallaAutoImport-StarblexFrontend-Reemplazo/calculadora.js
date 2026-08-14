// ============================================================
// calculadora.js — Módulo independiente de la calculadora financiera
// (modal único reutilizable) + botón flotante (FAB). Se carga con
// <script defer src="/calculadora.js"></script> DESPUÉS de app.js en
// index.html (usa fmtPrice, showToast, vehicles, que ya son
// globales en app.js).
// ============================================================
// ============================================================
// CALCULADORA FINANCIERA — Motor de cálculo (amortización francesa)
// ============================================================
// El usuario NUNCA ingresa una tasa de interés. Cada institución tiene
// una tasa anual estimada fija, diferenciada por tipo de vehículo
// (Nuevo/0km vs Usado/Seminuevo). Son valores referenciales de mercado
// dominicano — el asesor confirma la tasa real al momento de aprobar.
const LB_CALC = {
  instituciones: {
    // Bancos múltiples
    'Banreservas':             { tipo: 'banco',       tasaNuevo: 11.50, tasaUsado: 13.50 },
    'Banco Popular':           { tipo: 'banco',       tasaNuevo: 12.00, tasaUsado: 14.00 },
    'Banco BHD':               { tipo: 'banco',       tasaNuevo: 11.95, tasaUsado: 13.95 },
    'Scotiabank':              { tipo: 'banco',       tasaNuevo: 12.25, tasaUsado: 14.25 },
    'Banco Santa Cruz':        { tipo: 'banco',       tasaNuevo: 12.50, tasaUsado: 14.50 },
    'Banco Caribe':            { tipo: 'banco',       tasaNuevo: 12.75, tasaUsado: 14.75 },
    'Banco Promerica':         { tipo: 'banco',       tasaNuevo: 12.90, tasaUsado: 14.90 },
    'Banesco':                 { tipo: 'banco',       tasaNuevo: 12.95, tasaUsado: 14.95 },
    'Banco Ademi':             { tipo: 'banco',       tasaNuevo: 13.25, tasaUsado: 15.25 },
    'Banco Vimenca':           { tipo: 'banco',       tasaNuevo: 13.50, tasaUsado: 15.50 },
    'Banco BDI':               { tipo: 'banco',       tasaNuevo: 13.25, tasaUsado: 15.25 },
    'Banco Lafise':            { tipo: 'banco',       tasaNuevo: 13.00, tasaUsado: 15.00 },
    // Asociaciones de Ahorros y Préstamos
    'APAP':                    { tipo: 'asociacion',  tasaNuevo: 12.25, tasaUsado: 14.25 },
    'ACAP':                    { tipo: 'asociacion',  tasaNuevo: 12.50, tasaUsado: 14.50 },
    'ALNAP':                   { tipo: 'asociacion',  tasaNuevo: 12.75, tasaUsado: 14.75 },
    // Financieras especializadas en vehículos
    'Motor Crédito':           { tipo: 'financiera',  tasaNuevo: 14.50, tasaUsado: 17.00 },
    'Confisa':                 { tipo: 'financiera',  tasaNuevo: 15.00, tasaUsado: 17.50 },
    'Fihogar':                 { tipo: 'financiera',  tasaNuevo: 14.75, tasaUsado: 17.25 },
    // Cooperativas con presencia nacional
    'Cooperativa San José':    { tipo: 'cooperativa', tasaNuevo: 13.00, tasaUsado: 15.00 },
    'Cooperativa Vega Real':   { tipo: 'cooperativa', tasaNuevo: 13.25, tasaUsado: 15.25 },
    'Cooperativa La Altagracia': { tipo: 'cooperativa', tasaNuevo: 13.50, tasaUsado: 15.50 },
  },
  // Devuelve la tasa anual (%) estimada según institución + tipo de vehículo
  getTasaAnual(institucion, tipoVehiculo) {
    const inst = this.instituciones[institucion];
    if (!inst) return 14; // fallback de seguridad
    return tipoVehiculo === 'usado' ? inst.tasaUsado : inst.tasaNuevo;
  },
  // Cuota mensual por amortización francesa (capital + interés fijo)
  // M = P * [ i(1+i)^n ] / [ (1+i)^n - 1 ]
  calcularCuota(montoFinanciado, tasaAnual, plazoMeses) {
    const i = (tasaAnual / 100) / 12; // tasa mensual
    if (i === 0) return montoFinanciado / plazoMeses;
    const factor = Math.pow(1 + i, plazoMeses);
    return montoFinanciado * (i * factor) / (factor - 1);
  },
  fmt(n) {
    return 'RD$ ' + Math.round(n).toLocaleString('es-DO');
  }
};
// ============================================================
// CALCULADORA — HOME (precio libre, elegido por el usuario)
// ============================================================
// ============================================================
// CALCULADORA — MODAL ÚNICO Y REUTILIZABLE
// Reemplaza las antiguas calc-home / calc-detail. Un solo estado,
// un solo set de funciones, dos modos:
//   - modo "libre": el usuario elige o busca cualquier vehículo
//   - modo "vehículo": precargada con el vehículo que está viendo
// ============================================================
// El vehículo es OBLIGATORIO en ambos modos: en modo "vehicle" viene
// precargado desde la ficha; en modo "free" el usuario debe elegirlo
// del inventario antes de poder calcular o enviar la solicitud.
const calcModalState = { mode: 'free', vehicle: null, tipo: 'nuevo', inicialPct: 20, plazo: 60, institucion: 'Banreservas' };
let calcModalLastFocused = null;
let currentDetailVehicle = null; // referencia al vehículo de la ficha actual, para el botón "Simular financiamiento"

function calcModalUpdateSliderFill() {
  const inicialSlider = document.getElementById('calc-modal-inicial-pct');
  if (inicialSlider) {
    const pct = (inicialSlider.value - inicialSlider.min) / (inicialSlider.max - inicialSlider.min) * 100;
    inicialSlider.style.setProperty('--fill', pct + '%');
  }
}

function calcModalGetPrecio() {
  return calcModalState.vehicle ? (calcModalState.vehicle.price || 0) : 0;
}

// ¿Hay un vehículo válido seleccionado? Gate central de la calculadora.
function calcModalHasVehicle() {
  return !!(calcModalState.vehicle && calcModalState.vehicle.price > 0);
}

// Construye el resumen textual de la cotización actual (WhatsApp / compartir)
function calcModalBuildResumen() {
  const precio = calcModalGetPrecio();
  const montoInicial = Math.round(precio * (calcModalState.inicialPct / 100));
  const montoFinanciado = precio - montoInicial;
  const tasaAnual = LB_CALC.getTasaAnual(calcModalState.institucion, calcModalState.tipo);
  const cuota = LB_CALC.calcularCuota(montoFinanciado, tasaAnual, calcModalState.plazo);
  const v = calcModalState.vehicle;
  let msg = `*Cotización de Financiamiento — La Batalla Auto Import*\n\n`;
  msg += `🚗 *Vehículo:* ${v.name} — ${fmtPrice(v.price, v)}\n`;
  msg += `🔗 ${getVehicleUrl(v)}\n\n`;
  msg += `🏦 *Institución:* ${calcModalState.institucion}\n`;
  msg += `💵 *Inicial:* ${calcModalState.inicialPct}% (${LB_CALC.fmt(montoInicial)})\n`;
  msg += `📅 *Plazo:* ${calcModalState.plazo} meses\n`;
  msg += `📊 *Monto a financiar:* ${LB_CALC.fmt(montoFinanciado)}\n`;
  msg += `✅ *Cuota mensual estimada:* ${LB_CALC.fmt(cuota)}/mes`;
  return msg;
}

function calcModalRender() {
  const hasVehicle = calcModalHasVehicle();
  const precio = calcModalGetPrecio();
  const montoInicial = Math.round(precio * (calcModalState.inicialPct / 100));
  const montoFinanciado = precio - montoInicial;
  const tasaAnual = LB_CALC.getTasaAnual(calcModalState.institucion, calcModalState.tipo);
  const cuota = LB_CALC.calcularCuota(montoFinanciado, tasaAnual, calcModalState.plazo);

  // Gate visual: sin vehículo no hay resultados ni CTA habilitado
  const results = document.querySelector('#calc-modal .lb-calc-results');
  const submitBtn = document.getElementById('calc-modal-submit-btn');
  const requiredHint = document.getElementById('calc-modal-vehicle-required');
  if (results) results.classList.toggle('hidden', !hasVehicle);
  if (submitBtn) {
    submitBtn.disabled = !hasVehicle;
    submitBtn.classList.toggle('lb-calc-cta--disabled', !hasVehicle);
    submitBtn.setAttribute('aria-disabled', String(!hasVehicle));
  }
  if (requiredHint) requiredHint.classList.toggle('hidden', hasVehicle || calcModalState.mode === 'vehicle');

  document.getElementById('calc-modal-inicial-display').textContent = hasVehicle
    ? `${calcModalState.inicialPct}% · ${LB_CALC.fmt(montoInicial)}`
    : `${calcModalState.inicialPct}%`;
  if (hasVehicle) {
    document.getElementById('calc-modal-monto-financiado').textContent = LB_CALC.fmt(montoFinanciado);
    document.getElementById('calc-modal-cuota-mensual').textContent = LB_CALC.fmt(cuota) + '/mes';
    document.getElementById('calc-modal-tasa-info').textContent = `Tasa estimada ${tasaAnual.toFixed(1)}% anual — ${calcModalState.institucion}`;
  }
  calcModalUpdateSliderFill();

  const inicialInput = document.getElementById('calc-modal-inicial-input');
  if (inicialInput && document.activeElement !== inicialInput) {
    inicialInput.value = hasVehicle ? montoInicial.toLocaleString('es-DO') : '';
  }

  // Acciones posteriores al cálculo — solo con vehículo seleccionado
  const actions = document.getElementById('calc-modal-actions');
  const waBtn = document.getElementById('calc-modal-action-whatsapp');
  if (hasVehicle) {
    actions.classList.remove('hidden');
    waBtn.href = `https://wa.me/18097759771?text=${encodeURIComponent(calcModalBuildResumen())}`;
  } else {
    actions.classList.add('hidden');
  }
}

function initCalcModalVehicleSearch() {
  const searchInput = document.getElementById('calc-modal-vehicle-search');
  const dropdown = document.getElementById('calc-modal-vehicle-dropdown');
  const display = document.getElementById('calc-modal-vehicle-selected');
  if (!searchInput || !dropdown || searchInput.dataset.bound) return;
  searchInput.dataset.bound = '1';
  function renderDropdown(filter) {
    const f = (filter || '').toLowerCase().trim();
    const list = f
      ? vehicles.filter(v => v.name.toLowerCase().includes(f) || (v.brand || '').toLowerCase().includes(f))
      : vehicles.slice(0, 30);
    dropdown.innerHTML = '';
    if (list.length === 0) {
      dropdown.innerHTML = '<div class="px-3 py-2 text-slate-400 text-sm">No se encontraron vehículos</div>';
    } else {
      list.slice(0, 30).forEach(v => {
        const item = document.createElement('div');
        item.className = 'px-3 py-2 text-sm cursor-pointer hover:bg-slate-700 transition flex items-center justify-between gap-2';
        item.innerHTML = `<span class="text-white">${escapeHtml(v.name)}</span><span class="text-sky-400 font-bold text-xs whitespace-nowrap">${escapeHtml(fmtPrice(v.price, v))}</span>`;
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          searchInput.value = v.name;
          display.textContent = `✓ Financiando: ${v.name} — ${fmtPrice(v.price, v)}`;
          display.classList.remove('hidden');
          dropdown.classList.add('hidden');
          calcModalState.vehicle = v; // el vehículo es la fuente del precio
          calcModalState.tipo = v.condition === 'usado' ? 'usado' : 'nuevo';
          document.getElementById('calc-modal-tipo-nuevo')?.classList.toggle('active', calcModalState.tipo === 'nuevo');
          document.getElementById('calc-modal-tipo-usado')?.classList.toggle('active', calcModalState.tipo === 'usado');
          calcModalRender();
        });
        dropdown.appendChild(item);
      });
    }
    dropdown.classList.remove('hidden');
  }
  searchInput.addEventListener('input', () => {
    // Al modificar el texto se invalida la selección previa: obliga a
    // volver a elegir un vehículo real del inventario.
    if (calcModalState.mode === 'free') { calcModalState.vehicle = null; calcModalRender(); }
    display.classList.add('hidden');
    renderDropdown(searchInput.value);
  });
  searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
  searchInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.add('hidden'), 150));
}

function calcModalBindOnce() {
  if (calcModalBindOnce.done) return;
  calcModalBindOnce.done = true;

  initCalcModalVehicleSearch();

  document.getElementById('calc-modal-tipo-nuevo')?.addEventListener('click', () => {
    calcModalState.tipo = 'nuevo';
    document.getElementById('calc-modal-tipo-nuevo').classList.add('active');
    document.getElementById('calc-modal-tipo-usado').classList.remove('active');
    calcModalRender();
  });
  document.getElementById('calc-modal-tipo-usado')?.addEventListener('click', () => {
    calcModalState.tipo = 'usado';
    document.getElementById('calc-modal-tipo-usado').classList.add('active');
    document.getElementById('calc-modal-tipo-nuevo').classList.remove('active');
    calcModalRender();
  });

  const inicialSlider = document.getElementById('calc-modal-inicial-pct');
  const inicialInput = document.getElementById('calc-modal-inicial-input');
  inicialSlider?.addEventListener('input', () => { calcModalState.inicialPct = parseInt(inicialSlider.value); calcModalRender(); });
  inicialInput?.addEventListener('input', () => {
    const raw = parseInt(inicialInput.value.replace(/[^\d]/g, ''));
    const precio = calcModalGetPrecio();
    if (!isNaN(raw) && raw >= 0 && precio > 0) {
      let pct = (raw / precio) * 100;
      pct = Math.min(Math.max(pct, 20), 80);
      calcModalState.inicialPct = Math.round(pct);
      inicialSlider.value = calcModalState.inicialPct;
      calcModalRender();
    }
  });
  inicialInput?.addEventListener('blur', () => {
    const montoInicial = Math.round(calcModalGetPrecio() * (calcModalState.inicialPct / 100));
    inicialInput.value = montoInicial.toLocaleString('es-DO');
  });

  document.querySelectorAll('#calc-modal-plazo-grid .lb-plazo-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      calcModalState.plazo = parseInt(btn.dataset.plazo);
      document.querySelectorAll('#calc-modal-plazo-grid .lb-plazo-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      calcModalRender();
    });
  });

  const institucionSel = document.getElementById('calc-modal-institucion');
  institucionSel?.addEventListener('change', () => { calcModalState.institucion = institucionSel.value; calcModalRender(); });

  document.getElementById('calc-modal-submit-btn')?.addEventListener('click', () => {
    // Regla de negocio: sin vehículo seleccionado no se puede continuar
    if (!calcModalHasVehicle()) {
      showToast('⚠️ Primero selecciona un vehículo del inventario');
      document.getElementById('calc-modal-vehicle-search')?.focus();
      return;
    }
    const nombre = document.getElementById('calc-modal-nombre')?.value.trim();
    const telefono = document.getElementById('calc-modal-telefono')?.value.trim();
    if (!nombre || !telefono) { showToast('⚠️ Completa tu nombre y teléfono'); return; }

    // Fase 1.4: guardar automáticamente la cotización si hay sesión.
    // Silencioso si el usuario no está logueado — no interrumpe el flujo
    // de WhatsApp, que es la acción principal de este botón.
    try {
      const { user } = typeof getCurrentUser === 'function' ? getCurrentUser() : {};
      if (user && typeof saveQuote === 'function' && calcModalHasVehicle()) {
        const precio = calcModalGetPrecio();
        const montoInicial = Math.round(precio * (calcModalState.inicialPct / 100));
        const montoFinanciado = precio - montoInicial;
        const tasaAnual = LB_CALC.getTasaAnual(calcModalState.institucion, calcModalState.tipo);
        const cuota = LB_CALC.calcularCuota(montoFinanciado, tasaAnual, calcModalState.plazo);
        saveQuote({
          vehicleId: calcModalState.vehicle?.id || '',
          vehicleName: calcModalState.vehicle?.name || 'Vehículo',
          downPayment: montoInicial,
          termMonths: calcModalState.plazo,
          monthlyPayment: cuota,
        }).catch(() => {});
      }
    } catch (e) { /* auth.js aún no listo — no crítico */ }

    const msg = calcModalBuildResumen().replace('*Cotización de', '*Solicitud de')
      + `\n\n👤 *Nombre:* ${nombre}\n📱 *Teléfono:* ${telefono}`;
    const waUrl = `https://wa.me/18097759771?text=${encodeURIComponent(msg)}`;
    // Este punto de contacto no es un <a> (es un window.open() disparado
    // por el submit del formulario), así que el listener delegado de
    // invite-modal.js no lo detecta. Se engancha aquí explícitamente
    // para mantener el mismo criterio en los 5 puntos de contacto.
    if (window.LB_INVITE?.shouldShow()) {
      window.LB_INVITE.open(() => window.open(waUrl, '_blank'));
    } else {
      window.open(waUrl, '_blank');
    }
  });

  // "Compartir cotización" — Web Share API con fallback a portapapeles.
  // Permite al usuario enviarse la cuota o consultarla con su familia:
  // valor real, a diferencia del antiguo "Solicitar más información".
  document.getElementById('calc-modal-action-share')?.addEventListener('click', async () => {
    if (!calcModalHasVehicle()) { showToast('⚠️ Selecciona un vehículo primero'); return; }
    const texto = calcModalBuildResumen().replace(/\*/g, ''); // sin markdown de WhatsApp
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Cotización — La Batalla Auto Import', text: texto });
      } else {
        await navigator.clipboard.writeText(texto);
        showToast('📋 Cotización copiada al portapapeles');
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // usuario canceló el share
      try { await navigator.clipboard.writeText(texto); showToast('📋 Cotización copiada al portapapeles'); }
      catch (e2) { showToast('No se pudo compartir la cotización'); }
    }
  });
}

// Abre el modal. Sin argumento = modo libre (home). Con vehículo = precargado.
function openCalcModal(vehicle) {
  calcModalBindOnce();
  const searchField = document.getElementById('calc-modal-search-field');
  const vehicleBox = document.getElementById('calc-modal-vehicle-box');
  const subtitle = document.getElementById('calc-modal-subtitle');

  if (vehicle) {
    calcModalState.mode = 'vehicle';
    calcModalState.vehicle = vehicle;
    calcModalState.tipo = vehicle.condition === 'usado' ? 'usado' : 'nuevo';
    document.getElementById('calc-modal-vehicle-name').textContent = vehicle.name;
    document.getElementById('calc-modal-vehicle-price').textContent = fmtPrice(vehicle.price, vehicle);
    vehicleBox.classList.remove('hidden');
    searchField.classList.add('hidden');
    subtitle.textContent = 'Calcula tu cuota mensual estimada para este vehículo';
  } else {
    calcModalState.mode = 'free';
    calcModalState.vehicle = null;
    calcModalState.tipo = 'nuevo';
    vehicleBox.classList.add('hidden');
    searchField.classList.remove('hidden');
    subtitle.textContent = 'Elige un vehículo del inventario y calcula tu cuota al instante';
    const searchInput = document.getElementById('calc-modal-vehicle-search');
    if (searchInput) searchInput.value = '';
    document.getElementById('calc-modal-vehicle-selected')?.classList.add('hidden');
  }
  calcModalState.inicialPct = 20;
  calcModalState.plazo = 60;
  calcModalState.institucion = 'Banreservas';
  document.getElementById('calc-modal-tipo-nuevo')?.classList.toggle('active', calcModalState.tipo === 'nuevo');
  document.getElementById('calc-modal-tipo-usado')?.classList.toggle('active', calcModalState.tipo === 'usado');
  const inicialSlider = document.getElementById('calc-modal-inicial-pct'); if (inicialSlider) inicialSlider.value = 20;
  document.querySelectorAll('#calc-modal-plazo-grid .lb-plazo-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.plazo) === 60));
  const institucionSel = document.getElementById('calc-modal-institucion'); if (institucionSel) institucionSel.value = 'Banreservas';
  const fn = document.getElementById('calc-modal-nombre'); if (fn) fn.value = '';
  const ft = document.getElementById('calc-modal-telefono'); if (ft) ft.value = '';

  calcModalRender();

  const overlay = document.getElementById('calc-modal-overlay');
  calcModalLastFocused = document.activeElement;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    document.getElementById('calc-modal-close')?.focus();
  });
}

function closeCalcModal() {
  const overlay = document.getElementById('calc-modal-overlay');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => overlay.classList.add('hidden'), 200);
  if (calcModalLastFocused && typeof calcModalLastFocused.focus === 'function') calcModalLastFocused.focus();
}

// Focus trap + cierre con Esc — accesibilidad estándar de cualquier modal
function initCalcModalA11y() {
  const overlay = document.getElementById('calc-modal-overlay');
  const modal = document.getElementById('calc-modal');
  document.getElementById('calc-modal-close')?.addEventListener('click', closeCalcModal);
  overlay?.addEventListener('mousedown', e => { if (e.target === overlay) closeCalcModal(); });
  document.addEventListener('keydown', e => {
    if (overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') { closeCalcModal(); return; }
    if (e.key === 'Tab') {
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

// Botón flotante — aparición inteligente: se mantiene oculto sobre el
// Hero y aparece apenas el usuario empieza a explorar el sitio, para
// no distraer en la primera pantalla.
function initFabCalc() {
  const fab = document.getElementById('fab-calc-btn');
  const hero = document.querySelector('header.relative.h-\\[70vh\\]');
  if (!fab) return;
  fab.addEventListener('click', () => openCalcModal(currentDetailVehicle));
  if (!hero || !('IntersectionObserver' in window)) { fab.classList.remove('hidden'); return; }
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => fab.classList.toggle('hidden', entry.isIntersecting));
  }, { threshold: 0.15 });
  io.observe(hero);
}
