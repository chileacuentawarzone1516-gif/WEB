// ============================================================
// VEHICULO-TAXONOMIA — categorías y iconos de características
// ------------------------------------------------------------
// PROBLEMA QUE RESUELVE
//
// La categoría de un vehículo se interpretaba en NUEVE sitios distintos,
// cada uno con su propia cadena de ternarios:
//
//   app.js  CATALOG_SECTIONS · pageState · renderSections · renderCard
//           · breadcrumb JSON-LD · CATEGORY_LABELS · tarjeta "similar"
//   dashboard.js  dbCategoryLabel · contadores del panel
//   index.html    nav · secciones · <select> de publicar · preferencias
//
// Añadir una categoría obligaba a tocar los nueve y olvidarse de uno
// dejaba vehículos invisibles (filtrados por un valor que nadie pinta) o
// etiquetas mintiendo ("Camioneta" era literalmente el `else` de todo lo
// que no fuera sedán o SUV: un valor desconocido se anunciaba como
// camioneta). Aquí vive UN solo criterio; nadie más interpreta `category`.
//
// CONTRATO
//   CATEGORIES              → [{ value, label, plural, icon }] en orden de portada
//   CATEGORY_VALUES         → ['sedanes', ...] valores canónicos que se GUARDAN
//   normalizeCategory(x)    → valor canónico | '' si no se reconoce
//   categoryLabel(x, opts)  → texto para humanos, nunca vacío
//   featureIcon(txt, brand) → nombre de icono Lucide, nunca undefined
//
// Es tolerante en la ENTRADA (documentos antiguos, mayúsculas, acentos,
// plurales) y estricto en la SALIDA.
//
// COMPATIBILIDAD CON DOCUMENTOS HISTÓRICOS
//
// Los vehículos publicados antes de esta versión guardan 'sedanes',
// 'suvs' o 'pickups' (los únicos tres valores que firestore.rules ha
// aceptado nunca). NO se migran: se traducen al leer, vía
// CATEGORY_ALIASES. Un documento histórico se sigue viendo, editando y
// guardando sin que nadie reescriba su campo por detrás.
//
// Este archivo se carga en el navegador (window.LBTaxonomy) y en Node
// (require) para poder probarlo sin navegador — ver
// tools/test-taxonomia.js.
// ============================================================
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.LBTaxonomy = api;
  if (typeof module === 'object' && module && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------
  // CATEGORÍAS
  // ------------------------------------------------------------
  // `value` es lo que se guarda en Firestore Y el id de la sección del
  // catálogo (#sedanes, #minivan…), así que cambiarlo rompe enlaces ya
  // indexados: no se toca sin migrar también firestore.rules, index.html
  // y styles.css. `label` es el singular (tarjetas, ficha, formulario);
  // `plural` encabeza la sección y el menú.
  //
  // POR QUÉ 'sedanes' Y NO 'sedan': es el valor que el proyecto ya usa,
  // el ancla #sedanes está publicada en el JSON-LD de migas de pan de
  // cada ficha, y mantenerlo deja al grueso del inventario histórico sin
  // necesitar traducción alguna. Las categorías nuevas sí estrenan valor.
  const CATEGORIES = [
    { value: 'sedanes',             label: 'Sedán',                 plural: 'Sedanes',              icon: 'car' },
    { value: 'jeepetas_camionetas', label: 'Jeepetas / Camionetas', plural: 'Jeepetas / Camionetas', icon: 'truck' },
    { value: 'minivan',             label: 'Minivan',               plural: 'Minivans',             icon: 'bus' },
    { value: 'vehiculos_pesados',   label: 'Vehículos Pesados',     plural: 'Vehículos Pesados',    icon: 'container' },
  ];

  const CATEGORY_VALUES = CATEGORIES.map(c => c.value);
  const CATEGORY_BY_VALUE = CATEGORIES.reduce((acc, c) => { acc[c.value] = c; return acc; }, {});

  // Sinónimos aceptados AL LEER. Las tres primeras filas son los valores
  // que existen de verdad en producción; el resto son formas que un
  // humano podría teclear o que podrían llegar de una importación.
  // Ninguna se escribe nunca: son solo entrada.
  const CATEGORY_ALIASES = {
    // — Histórico real (esquema anterior) —
    sedanes: 'sedanes',
    suvs: 'jeepetas_camionetas',
    pickups: 'jeepetas_camionetas',
    // — Sedán —
    sedan: 'sedanes', sedans: 'sedanes', berlina: 'sedanes', berlinas: 'sedanes',
    // — Jeepetas / Camionetas —
    suv: 'jeepetas_camionetas',
    jeep: 'jeepetas_camionetas', jeeps: 'jeepetas_camionetas',
    jeepeta: 'jeepetas_camionetas', jeepetas: 'jeepetas_camionetas',
    camioneta: 'jeepetas_camionetas', camionetas: 'jeepetas_camionetas',
    pickup: 'jeepetas_camionetas', pick_up: 'jeepetas_camionetas',
    crossover: 'jeepetas_camionetas', crossovers: 'jeepetas_camionetas',
    // — Minivan —
    minivans: 'minivan', mini_van: 'minivan', van: 'minivan', vans: 'minivan',
    minibus: 'minivan',
    // — Vehículos pesados —
    vehiculo_pesado: 'vehiculos_pesados', vehiculos_pesado: 'vehiculos_pesados',
    pesado: 'vehiculos_pesados', pesados: 'vehiculos_pesados',
    camion: 'vehiculos_pesados', camiones: 'vehiculos_pesados',
    cabezote: 'vehiculos_pesados', cabezotes: 'vehiculos_pesados',
    patana: 'vehiculos_pesados', patanas: 'vehiculos_pesados',
    autobus: 'vehiculos_pesados', autobuses: 'vehiculos_pesados',
  };

  // Acentos fuera, todo a minúsculas y cualquier separador (espacio,
  // barra, guion) a "_": así "Jeepetas / Camionetas", "JEEPETAS-CAMIONETAS"
  // y "jeepetas_camionetas" son la misma clave sin escribir tres alias.
  function normalizeKey(raw) {
    return String(raw == null ? '' : raw)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Valor canónico de una categoría, venga como venga.
   * @returns {string} uno de CATEGORY_VALUES, o '' si no se reconoce.
   *
   * Devolver '' —y no una categoría por defecto— es deliberado: inventar
   * un destino para un valor desconocido es exactamente el fallo que
   * hacía que todo lo no-sedán/no-SUV se anunciara como "Camioneta".
   * Quien llama decide; el panel de administración los sigue listando
   * con su valor crudo para que se puedan corregir a mano.
   */
  function normalizeCategory(raw) {
    const key = normalizeKey(raw);
    if (!key) return '';
    if (CATEGORY_BY_VALUE[key]) return key;
    return CATEGORY_ALIASES[key] || '';
  }

  /**
   * Texto para humanos. Nunca devuelve vacío ni "undefined".
   * @param {string} raw  valor guardado
   * @param {{plural?: boolean, fallback?: string}} [opts]
   */
  function categoryLabel(raw, opts) {
    const o = opts || {};
    const cat = CATEGORY_BY_VALUE[normalizeCategory(raw)];
    if (cat) return o.plural ? cat.plural : cat.label;
    const reserva = o.fallback !== undefined ? o.fallback : '—';
    // Solo texto y números son etiquetas posibles. Un objeto o un array
    // daría "[object Object]" pintado en la tarjeta, que es peor que el
    // guion: se ve como un dato real y nadie sabe de dónde salió.
    if (typeof raw !== 'string' && typeof raw !== 'number') return reserva;
    return String(raw).trim() || reserva;
  }

  /** Metadatos completos de una categoría canónica (o null). */
  function categoryInfo(raw) {
    return CATEGORY_BY_VALUE[normalizeCategory(raw)] || null;
  }

  // ------------------------------------------------------------
  // ICONOS DE CARACTERÍSTICAS
  // ------------------------------------------------------------
  // Mapa ÚNICO texto → icono (el "FEATURE_ICON_MAP" del proyecto). Es una
  // lista ORDENADA, no un objeto, porque las características son texto
  // libre escrito a mano: se decide por lo que la frase dice, y la regla
  // más específica tiene que ganar a la más general.
  //
  // REGLA DE ORDEN: lo concreto arriba, lo genérico abajo. Tres casos
  // reales que dependen de ello y que estaban mal resueltos:
  //   · "Baúl eléctrico"   → maletero, NO combustible (caía en /eléctric/)
  //   · "3 filas de asientos" → plazas, NO butaca (caía en /asiento/)
  //   · "Aire acondicionado"  → clima, NO estado (roza /condicion/)
  //
  // AMPLIARLO ES LA ÚNICA EDICIÓN NECESARIA para cubrir equipamiento
  // nuevo: añade la fila en su bloque y ya está en ficha y tarjeta.
  // Los nombres son de Lucide 0.263.0 (la versión que carga index.html) y
  // aun así todo pasa por resolveIconName(), así que un nombre retirado
  // en una versión futura degrada a un icono neutral en vez de dejar un
  // hueco mudo.
  const FEATURE_ICON_RULES = [
    // — Documentación, respaldo y procedencia —
    [/carfax|historial|reporte|t[íi]tulo limpio|clean title/i,            'file-check'],
    [/salvamento|salvage|rebuilt|chocad|inundad|reconstruid/i,            'shield-check'],
    [/garant[íi]a|warranty/i,                                             'badge-check'],
    [/mantenimiento|servicio al d[íi]a|revisad|al d[íi]a/i,               'wrench'],
    [/importad|nacionalizad|reci[ée]n llegad/i,                           'globe'],
    [/[úu]nico due[ñn]o|primer due[ñn]o|un solo due[ñn]o/i,               'user-check'],
    [/\ba[ñn]o\b|modelo\s*(19|20)\d{2}|^\s*(19|20)\d{2}\b/i,              'calendar-days'],
    // — Dinero —
    [/financiamiento|financiaci|cr[ée]dito|cuota|inicial|aprobaci[óo]n|leasing/i, 'credit-card'],
    [/precio|negociabl|oferta|rebaj|descuento|us\$|rd\$|\$\s?\d/i,        'banknote'],
    // — Carrocería y estado general —
    [/pintura|carrocer[íi]a|de f[áa]brica|sin detalles|sin choques/i,     'spray-can'],
    // — Climatización (ANTES que "estado": "aire aCONDICIONado" roza la
    //   palabra "condicion"; el \b de la regla siguiente ya lo evita, pero
    //   el orden lo deja sin depender de ese detalle) —
    [/clima|aire|a\/c|calefacci[óo]n|calefactad|ventilad/i,               'wind'],
    [/excelente|impecable|como nuevo|\bcondiciones\b|primera/i,           'award'],
    // — Interior —
    [/fila|pasajero|plaza|\d\s*asientos/i,                                'users'],
    [/cuero|piel|tapicer[íi]a|interior/i,                                 'sofa'],
    [/ba[úu]l|maletero|port[óo]n|cajuela|compuerta|liftgate/i,            'luggage'],
    [/asiento|butaca|reposabrazos/i,                                      'armchair'],
    [/techo|sunroof|panor[áa]mic|quemacoco|corredizo/i,                   'sun'],
    [/vidrio|ventana|cristal|polariza/i,                                  'panel-top'],
    // — Multimedia y conectividad —
    [/c[áa]mara|retrovisor|360|reversa/i,                                 'camera'],
    [/carplay|android auto/i,                                             'smartphone'],
    [/pantalla|t[áa]ctil|touch|display|infotainment|multimedia/i,          'monitor'],
    [/bluetooth/i,                                                        'bluetooth'],
    [/gps|navegaci[óo]n|waze/i,                                           'map-pin'],
    [/bocina|sonido|audio|bose|harman|jbl|parlante|\bsub\b/i,             'volume-2'],
    [/usb|carga inal|cargador|inal[áa]mbric/i,                            'usb'],
    // — Seguridad y asistencias —
    [/sensor|parqueo|park|punto ciego|colisi[óo]n|frenado|asistencia/i,   'radar'],
    [/airbag|abs|seguridad|alarma|blindaj|isofix/i,                       'shield'],
    [/crucero|cruise|control de velocidad/i,                              'gauge'],
    [/millaje|kil[óo]metr|millas|odo?metr/i,                              'gauge'],
    // — Mecánica —
    [/llave|keyless|arranque|push start|smart key/i,                      'key-round'],
    [/4x4|4wd|awd|tracci[óo]n|off.?road|todo terreno/i,                   'mountain'],
    [/remolque|arrastre|enganche|\btow\b/i,                               'truck'],
    [/turbo|caballo|\bhp\b|motor|cilindr|v6|v8/i,                         'zap'],
    [/autom[áa]tic|transmisi[óo]n|caja|manual|paddle/i,                   'cog'],
    [/el[ée]ctric|h[íi]brid|gasolina|di[ée]sel|combustible|\bgas\b/i,     'fuel'],
    [/bater[íi]a/i,                                                       'battery-charging'],
    // \b obligatorio: sin él "Touring", "Sprinter" o "Spring" caían aquí
    // y el modelo del vehículo se anunciaba con un icono de llanta.
    [/\brines?\b|\baros?\b|llantas?|neum[áa]tic/i,                          'circle-dot'],
    [/led|luz|luces|faro|x[ée]non|halogen/i,                              'lightbulb'],
  ];

  // Icono neutral: se usa cuando la frase no encaja en ninguna regla. No
  // es un fallo, es el caso por defecto de un campo de texto libre.
  const FEATURE_ICON_FALLBACK = 'check-circle';

  /**
   * Icono de una característica.
   * @param {string} text  la característica tal cual la escribió el admin
   * @param {string} [brand]  marca del vehículo. Si la frase empieza por
   *   ella, es el modelo ("Mazda CX9 Touring") y no equipamiento: se
   *   marca con un icono de vehículo en vez del genérico.
   */
  function featureIcon(text, brand) {
    const txt = String(text == null ? '' : text);
    const rule = FEATURE_ICON_RULES.find(([re]) => re.test(txt));
    if (rule) return rule[1];
    const marca = normalizeKey(brand);
    if (marca && normalizeKey(txt).startsWith(marca)) return 'car';
    return FEATURE_ICON_FALLBACK;
  }

  // kebab-case → PascalCase, que es como Lucide indexa sus iconos.
  function toPascalIcon(name) {
    return String(name).split('-')
      .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  }

  /**
   * Devuelve `name` si Lucide lo conoce; si no, el de reserva. Evita el
   * hueco silencioso que deja un data-lucide inexistente — el defecto
   * real que tenía el panel de inventario vacío con "car-front", un
   * icono que no existe en 0.263.0 y que no pintaba nada.
   * Mientras la librería no haya cargado se confía en el nombre pedido
   * (se resuelve al llamar a lucide.createIcons() al final del render).
   */
  function resolveIconName(name, fallback) {
    const reserva = fallback === undefined ? FEATURE_ICON_FALLBACK : fallback;
    const icons = typeof window !== 'undefined' && window.lucide && window.lucide.icons;
    if (!icons) return name;
    if (icons[toPascalIcon(name)] || icons[name]) return name;
    return reserva;
  }

  return {
    CATEGORIES,
    CATEGORY_VALUES,
    CATEGORY_ALIASES,
    FEATURE_ICON_RULES,
    FEATURE_ICON_FALLBACK,
    normalizeCategory,
    normalizeKey,
    categoryLabel,
    categoryInfo,
    featureIcon,
    resolveIconName,
    toPascalIcon,
  };
});
