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

// Fuente ÚNICA de los números de la cotización. Antes cada consumidor
// (render, resumen de WhatsApp, guardado en Firestore) repetía las
// mismas cuatro operaciones; ahora todos leen de aquí, así que no
// pueden divergir.
function calcModalGetCotizacion() {
  const precio = calcModalGetPrecio();
  const inicialPct = calcModalState.inicialPct;
  const montoInicial = Math.round(precio * (inicialPct / 100));
  const montoFinanciado = precio - montoInicial;
  const tasaAnual = LB_CALC.getTasaAnual(calcModalState.institucion, calcModalState.tipo);
  const cuota = LB_CALC.calcularCuota(montoFinanciado, tasaAnual, calcModalState.plazo);
  return {
    vehicle: calcModalState.vehicle,
    institucion: calcModalState.institucion,
    tipo: calcModalState.tipo,
    precio, inicialPct, montoInicial, montoFinanciado, tasaAnual,
    plazo: calcModalState.plazo, cuota,
  };
}

// Datos de contacto escritos en el formulario (pueden estar vacíos).
function calcModalGetSolicitante() {
  return {
    nombre: document.getElementById('calc-modal-nombre')?.value.trim() || '',
    telefono: document.getElementById('calc-modal-telefono')?.value.trim() || '',
  };
}

// Construye el resumen textual de la cotización actual (WhatsApp / compartir)
function calcModalBuildResumen() {
  const { montoInicial, montoFinanciado, cuota } = calcModalGetCotizacion();
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
  const { montoInicial, montoFinanciado, tasaAnual, cuota } = calcModalGetCotizacion();

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
  document.getElementById('calc-modal-actions')?.classList.toggle('hidden', !hasVehicle);
  document.getElementById('calc-modal-actions-hint')?.classList.toggle('hidden', !hasVehicle);
  // Deja el PDF listo por adelantado (ver calcModalPrepararPDF): es lo
  // que permite que "Compartir" funcione en iOS/Safari.
  if (hasVehicle) calcModalProgramarPreparacionPDF();
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

  // Nombre y teléfono aparecen impresos en el PDF, así que su edición
  // invalida el documento preparado igual que cualquier otro parámetro.
  ['calc-modal-nombre', 'calc-modal-telefono'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcModalProgramarPreparacionPDF);
  });

  document.getElementById('calc-modal-submit-btn')?.addEventListener('click', () => {
    // Regla de negocio: sin vehículo seleccionado no se puede continuar
    if (!calcModalHasVehicle()) {
      showToast('⚠️ Primero selecciona un vehículo del inventario');
      document.getElementById('calc-modal-vehicle-search')?.focus();
      return;
    }
    const { nombre, telefono } = calcModalGetSolicitante();
    if (!nombre || !telefono) { showToast('⚠️ Completa tu nombre y teléfono'); return; }

    // Fase 1.4: guardar automáticamente la cotización si hay sesión.
    // Silencioso si el usuario no está logueado — no interrumpe el flujo
    // de WhatsApp, que es la acción principal de este botón.
    try {
      const { user } = typeof getCurrentUser === 'function' ? getCurrentUser() : {};
      if (user && typeof saveQuote === 'function' && calcModalHasVehicle()) {
        const q = calcModalGetCotizacion();
        saveQuote({
          vehicleId: q.vehicle?.id || '',
          vehicleName: q.vehicle?.name || 'Vehículo',
          downPayment: q.montoInicial,
          termMonths: q.plazo,
          monthlyPayment: q.cuota,
          // Datos con los que el dashboard puede REGENERAR este PDF:
          // institución, tasa y monto financiado no se deducen del resto.
          vehiclePrice: q.precio,
          downPaymentPct: q.inicialPct,
          institution: q.institucion,
          annualRate: q.tasaAnual,
          vehicleType: q.tipo,
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
    // Copia al correo del asesor con el PDF adjunto. Va DESPUÉS de abrir
    // WhatsApp para no gastar la activación del gesto que necesita
    // window.open, y no se espera: es un canal secundario.
    calcModalEnviarAlAsesor(msg);
  });

  document.getElementById('calc-modal-action-pdf')?.addEventListener('click', () => calcModalDescargarPDF());
  document.getElementById('calc-modal-action-share')?.addEventListener('click', () => calcModalCompartir());
}

// ============================================================
// SERVICIO DE COTIZACIÓN EN PDF — window.LB_COTIZACION
// ------------------------------------------------------------
// API pública compartida por el modal de la calculadora y el
// dashboard ("Cotizaciones guardadas"). Vive aquí porque
// calculadora.js ya se carga en todas las páginas y va antes que
// dashboard.js; el patrón es el mismo de LB_INVITE / LB_DASHBOARD.
//
// El generador (pdf-core.js + cotizacion-pdf.js) entra con import()
// dinámico: son ~13 KB que solo pagan quienes piden su cotización.
// ============================================================
window.LB_COTIZACION = (() => {
  let modulo = null;

  function cargarModulo() {
    if (!modulo) {
      modulo = import('/cotizacion-pdf.js?v=20260905b').catch(err => {
        modulo = null; // permite reintentar tras un fallo de red
        throw err;
      });
    }
    return modulo;
  }

  // Precarga silenciosa: cuando el usuario termina de ajustar su cuota
  // el módulo ya está en caché y el documento sale al instante.
  function precargar() {
    const cargar = () => cargarModulo().catch(() => {});
    if ('requestIdleCallback' in window) requestIdleCallback(cargar, { timeout: 3000 });
    else setTimeout(cargar, 1200);
  }

  async function generar(datos) {
    const { generarCotizacionPDF } = await cargarModulo();
    return generarCotizacionPDF(datos);
  }

  // Fuerza la descarga del Blob con un enlace temporal. El objectURL se
  // libera en el siguiente minuto: revocarlo de inmediato cancela la
  // descarga en Firefox y Safari.
  function descargar({ blob, filename }) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function crearArchivo({ blob, filename }) {
    if (typeof File !== 'function') return null;
    try { return new File([blob], filename, { type: 'application/pdf' }); }
    catch (e) { return null; }
  }

  function puedeCompartirArchivo(file) {
    return !!(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  }

  // Traduce una cotización guardada en Firestore al contrato del
  // generador. `vehiculo` es opcional: si el vehículo sigue publicado
  // aporta precio, marca, año y enlace; si ya no existe, el documento
  // se genera igual con lo que se guardó (ver cotizacion-pdf.js, que
  // omite las filas sin dato en vez de inventarlas).
  function desdeCotizacionGuardada(q, vehiculo) {
    const precio = typeof q.vehiclePrice === 'number' ? q.vehiclePrice
      : (vehiculo && typeof vehiculo.price === 'number' ? vehiculo.price : null);
    const inicial = Number(q.downPayment) || 0;
    const pct = typeof q.downPaymentPct === 'number' ? q.downPaymentPct
      : (precio ? Math.round((inicial / precio) * 100) : null);
    const condiciones = { nuevo: 'Nuevo / 0 km', importado: 'Recién importado', usado: 'Usado / Seminuevo' };
    const tipo = q.vehicleType || (vehiculo ? (vehiculo.condition === 'usado' ? 'usado' : 'nuevo') : '');
    return {
      vehiculo: {
        nombre: q.vehicleName || (vehiculo && vehiculo.name) || 'Vehículo',
        precio,
        precioTexto: vehiculo && typeof fmtPrice === 'function' ? fmtPrice(vehiculo.price, vehiculo) : null,
        condicionTexto: tipo ? condiciones[tipo] || condiciones.usado : '',
        marca: (vehiculo && vehiculo.brand) || '',
        anio: (vehiculo && vehiculo.year) || '',
        url: vehiculo && typeof getVehicleUrl === 'function' ? getVehicleUrl(vehiculo) : '',
      },
      financiamiento: {
        institucion: q.institution || '',
        tipo,
        tasaAnual: typeof q.annualRate === 'number' ? q.annualRate : null,
        inicialPct: pct,
        montoInicial: inicial,
        montoFinanciado: precio !== null ? Math.max(0, precio - inicial) : null,
        plazo: Number(q.termMonths) || 1,
        cuota: Number(q.monthlyPayment) || 0,
      },
      solicitante: null,
    };
  }

  return { cargarModulo, precargar, generar, descargar, crearArchivo, puedeCompartirArchivo, desdeCotizacionGuardada };
})();

// ============================================================
// COTIZACIÓN EN PDF — integración con el modal
// ============================================================

// Traduce el estado de la calculadora al contrato del generador.
function calcModalBuildPdfData() {
  const q = calcModalGetCotizacion();
  const v = q.vehicle;
  const condiciones = { nuevo: 'Nuevo / 0 km', importado: 'Recién importado', usado: 'Usado / Seminuevo' };
  const solicitante = calcModalGetSolicitante();
  return {
    vehiculo: {
      nombre: v.name,
      precio: q.precio,
      precioTexto: fmtPrice(v.price, v),
      condicionTexto: condiciones[v.condition] || condiciones.usado,
      marca: v.brand || '',
      anio: v.year || '',
      url: typeof getVehicleUrl === 'function' ? getVehicleUrl(v) : '',
    },
    financiamiento: {
      institucion: q.institucion, tipo: q.tipo, tasaAnual: q.tasaAnual,
      inicialPct: q.inicialPct, montoInicial: q.montoInicial,
      montoFinanciado: q.montoFinanciado, plazo: q.plazo, cuota: q.cuota,
    },
    solicitante: (solicitante.nombre || solicitante.telefono) ? solicitante : null,
  };
}

// ------------------------------------------------------------
// Documento preparado por adelantado
// ------------------------------------------------------------
// Safari (y iOS en general) exige que navigator.share() se invoque
// DENTRO del gesto del usuario: si antes se hace `await` para construir
// el PDF, la activación transitoria se pierde y el share falla con
// NotAllowedError. Por eso el documento se genera en segundo plano cada
// vez que la cotización cambia, de modo que al pulsar "Compartir" ya
// exista y share() se llame sin ningún await por delante.
//
// La clave incluye TODO lo que aparece impreso; si algo cambia, el
// documento cacheado deja de ser válido y se descarta.
let _pdfPreparado = null;   // { clave, documento, archivo }
let _pdfPrepararTimer = null;

function calcModalCotizacionClave() {
  if (!calcModalHasVehicle()) return null;
  const q = calcModalGetCotizacion();
  const s = calcModalGetSolicitante();
  return [q.vehicle.id, q.precio, q.institucion, q.tipo, q.inicialPct, q.plazo, s.nombre, s.telefono].join('|');
}

// Genera y guarda el documento si la cotización actual aún no lo tiene.
async function calcModalPrepararPDF() {
  const clave = calcModalCotizacionClave();
  if (!clave || (_pdfPreparado && _pdfPreparado.clave === clave)) return;
  try {
    const documento = await window.LB_COTIZACION.generar(calcModalBuildPdfData());
    // Entre el inicio y el fin de la generación el usuario pudo mover un
    // control: solo se guarda si la clave sigue siendo la misma.
    if (calcModalCotizacionClave() !== clave) return;
    _pdfPreparado = { clave, documento, archivo: window.LB_COTIZACION.crearArchivo(documento) };
  } catch (e) {
    // Silencioso: es una optimización. Si falla, el botón lo genera al vuelo.
  }
}

// Se llama en cada render; el rebote evita regenerar mientras el usuario
// arrastra el deslizador de la inicial.
function calcModalProgramarPreparacionPDF() {
  clearTimeout(_pdfPrepararTimer);
  const overlay = document.getElementById('calc-modal-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return; // modal cerrado
  _pdfPrepararTimer = setTimeout(() => { calcModalPrepararPDF(); }, 600);
}

function calcModalPdfPreparado() {
  const clave = calcModalCotizacionClave();
  return clave && _pdfPreparado && _pdfPreparado.clave === clave ? _pdfPreparado : null;
}

// Envoltura común de los dos botones: valida, muestra estado de carga y
// centraliza el manejo de errores para no repetirlo en cada acción.
async function calcModalConPDF(btn, etiquetaCargando, accion) {
  if (!calcModalHasVehicle()) { showToast('⚠️ Selecciona un vehículo primero'); return; }
  if (btn?.dataset.busy === '1') return; // evita dobles pulsaciones
  const label = btn?.querySelector('.calc-modal-action-label');
  const textoOriginal = label?.textContent;
  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (label) label.textContent = etiquetaCargando;
  }
  try {
    const preparado = calcModalPdfPreparado();
    const documento = preparado ? preparado.documento
      : await window.LB_COTIZACION.generar(calcModalBuildPdfData());
    await accion(documento);
  } catch (err) {
    console.error('No se pudo generar la cotización en PDF:', err);
    showToast('❌ No se pudo generar el PDF. Revisa tu conexión e inténtalo de nuevo.');
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (label && textoOriginal) label.textContent = textoOriginal;
    }
  }
}

// ------------------------------------------------------------
// Copia por correo al asesor (Netlify Function + Resend)
// ------------------------------------------------------------
// Se dispara junto al mensaje de WhatsApp. Es SILENCIOSA por diseño: el
// canal principal ya se abrió, así que un fallo aquí (correo sin
// configurar, sin red, límite de frecuencia) no debe mostrarle nada al
// cliente ni bloquear su flujo.
const COTIZACION_ENDPOINT = '/.netlify/functions/enviar-cotizacion';
// Tope de `keepalive` según la especificación de fetch. Por encima de él
// el navegador rechaza la petición, así que se envía sin keepalive: la
// página no navega (WhatsApp abre en otra pestaña), de modo que la
// petición normal también llega.
const KEEPALIVE_MAX_BYTES = 60 * 1024;

function blobABase64(blob) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1] || '');
    lector.onerror = () => reject(lector.error || new Error('No se pudo leer el PDF'));
    lector.readAsDataURL(blob);
  });
}

async function calcModalEnviarAlAsesor(resumen) {
  try {
    if (!calcModalHasVehicle()) return;
    const preparado = calcModalPdfPreparado();
    const documento = preparado ? preparado.documento
      : await window.LB_COTIZACION.generar(calcModalBuildPdfData());
    const q = calcModalGetCotizacion();
    const s = calcModalGetSolicitante();
    const cuerpo = JSON.stringify({
      pdfBase64: await blobABase64(documento.blob),
      filename: documento.filename,
      folio: documento.folio,
      vehiculo: q.vehicle?.name || '',
      nombre: s.nombre,
      telefono: s.telefono,
      institucion: q.institucion,
      cuota: `${LB_CALC.fmt(q.cuota)} / mes`,
      plazo: `${q.plazo} meses`,
      url: typeof getVehicleUrl === 'function' && q.vehicle ? getVehicleUrl(q.vehicle) : '',
      resumen,
    });
    await fetch(COTIZACION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo,
      keepalive: cuerpo.length <= KEEPALIVE_MAX_BYTES,
    });
  } catch (e) {
    // Silencioso a propósito: la solicitud ya salió por WhatsApp.
    console.warn('No se pudo enviar la copia por correo al asesor:', e);
  }
}

function calcModalDescargarPDF() {
  const btn = document.getElementById('calc-modal-action-pdf');
  return calcModalConPDF(btn, 'Generando PDF…', documento => {
    window.LB_COTIZACION.descargar(documento);
    showToast('📄 Cotización descargada en PDF');
  });
}

// Entrega de reserva cuando compartir el archivo no es posible: descarga
// el PDF y, además, comparte o copia el resumen. Así la acción nunca
// termina sin resultado visible.
async function calcModalEntregarPorDescarga(documento, texto, titulo) {
  window.LB_COTIZACION.descargar(documento);
  try {
    if (navigator.share) { await navigator.share({ title: titulo, text: texto }); }
    else { await navigator.clipboard.writeText(texto); showToast('📄 PDF descargado y resumen copiado'); return; }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // el usuario canceló el share del texto
  }
  showToast('📄 Cotización descargada en PDF');
}

function calcModalCompartir() {
  if (!calcModalHasVehicle()) { showToast('⚠️ Selecciona un vehículo primero'); return; }
  const titulo = 'Cotización — La Batalla Auto Import';
  const texto = calcModalBuildResumen().replace(/\*/g, ''); // sin markdown de WhatsApp

  // Camino rápido: el documento ya está listo, así que share() se invoca
  // de forma SÍNCRONA dentro del gesto y Safari lo acepta.
  const preparado = calcModalPdfPreparado();
  if (preparado && window.LB_COTIZACION.puedeCompartirArchivo(preparado.archivo)) {
    navigator.share({ files: [preparado.archivo], title: titulo, text: texto })
      .catch(err => {
        if (err && err.name === 'AbortError') return; // el usuario canceló
        calcModalEntregarPorDescarga(preparado.documento, texto, titulo);
      });
    return;
  }

  // Camino lento: hay que construirlo ahora. Si el navegador exige el
  // gesto original, lo entrega por descarga.
  const btn = document.getElementById('calc-modal-action-share');
  return calcModalConPDF(btn, 'Preparando…', async documento => {
    const archivo = window.LB_COTIZACION.crearArchivo(documento);
    if (window.LB_COTIZACION.puedeCompartirArchivo(archivo)) {
      try {
        await navigator.share({ files: [archivo], title: titulo, text: texto });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    await calcModalEntregarPorDescarga(documento, texto, titulo);
  });
}

// Abre el modal. Sin argumento = modo libre (home). Con vehículo = precargado.
function openCalcModal(vehicle) {
  calcModalBindOnce();
  window.LB_COTIZACION.precargar();
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
  // Contador compartido con app.js — evita desbloquear el fondo si
  // todavía hay otro modal abierto (ver LB_SCROLL_LOCK en app.js).
  window.LB_SCROLL_LOCK?.lock();
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    document.getElementById('calc-modal-close')?.focus();
  });
}

function closeCalcModal() {
  // Se cancela la preparación pendiente y se libera el documento: no
  // tiene sentido mantener un PDF de varios cientos de KB en memoria
  // para una cotización que el usuario ya abandonó.
  clearTimeout(_pdfPrepararTimer);
  _pdfPreparado = null;
  const overlay = document.getElementById('calc-modal-overlay');
  overlay.classList.remove('open');
  window.LB_SCROLL_LOCK?.unlock();
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
      // Filtrar solo elementos realmente enfocables. Dos correcciones sobre
      // la selección original:
      // 1. `a[href]` en vez del genérico `[href]` — el selector genérico
      //    también capturaba los <use href="#icon"> de los iconos SVG
      //    (share/whatsapp), que NUNCA reciben foco por Tab en un navegador
      //    real. Con eso en la lista, "last" podía apuntar a un nodo SVG
      //    inalcanzable y el wrap-around last→first jamás se disparaba.
      // 2. offsetParent !== null excluye los elementos dentro de un
      //    ancestro .hidden/display:none (p. ej. #calc-modal-actions antes
      //    de seleccionar un vehículo) — pero NO es fiable en nodos SVG,
      //    por eso el filtro solo se aplica ya sin elementos SVG en la lista.
      const focusables = Array.from(
        modal.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(el => el instanceof HTMLElement && el.offsetParent !== null && !el.disabled);
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
