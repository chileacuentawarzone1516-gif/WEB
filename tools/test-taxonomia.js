#!/usr/bin/env node
// ============================================================
// tools/test-taxonomia.js — pruebas de vehiculo-taxonomia.js
// ------------------------------------------------------------
// QUÉ CUBRE
//   1. Normalización de categorías: valores canónicos, alias históricos
//      (los que hay de verdad en producción) y basura.
//   2. Etiquetas: que ninguna entrada produzca vacío ni "undefined".
//   3. Iconos de características: el mapeo semántico caso por caso,
//      incluidos los tres empates de orden que estaban mal resueltos.
//   4. Que ningún icono del mapa sea un nombre inexistente en Lucide
//      0.263.0 — la versión que carga index.html. Un nombre inventado no
//      falla: no pinta nada, que es peor.
//
// Corre sin navegador y sin red:  node tools/test-taxonomia.js
// ============================================================
'use strict';

const path = require('path');
const T = require(path.join(__dirname, '..',
  'LaBatallaAutoImport-StarblexFrontend-Reemplazo', 'vehiculo-taxonomia.js'));

let pasadas = 0;
const fallos = [];

function eq(actual, esperado, titulo) {
  if (actual === esperado) { pasadas++; return; }
  fallos.push(`${titulo}\n      esperado: ${JSON.stringify(esperado)}\n      obtenido: ${JSON.stringify(actual)}`);
}
function ok(condicion, titulo) { eq(!!condicion, true, titulo); }

// ------------------------------------------------------------
// 1. CATEGORÍAS — las cuatro canónicas
// ------------------------------------------------------------
eq(T.CATEGORY_VALUES.join(','),
   'sedanes,jeepetas_camionetas,minivan,vehiculos_pesados',
   'las cuatro categorías canónicas, en orden de portada');

eq(T.CATEGORIES.length, 4, 'exactamente cuatro categorías');
T.CATEGORIES.forEach(c => {
  ok(c.label && c.plural && c.icon, `la categoría ${c.value} tiene label, plural e icono`);
});

// ------------------------------------------------------------
// 2. NORMALIZACIÓN — alias históricos reales
// ------------------------------------------------------------
const casos = [
  // [entrada, salida esperada, por qué]
  ['sedanes',              'sedanes',             'valor histórico real'],
  ['sedan',                'sedanes',             'singular sin acento'],
  ['Sedán',                'sedanes',             'etiqueta visible con acento y mayúscula'],
  ['suvs',                 'jeepetas_camionetas', 'valor histórico real (se fusiona)'],
  ['SUV',                  'jeepetas_camionetas', 'singular en mayúsculas'],
  ['pickups',              'jeepetas_camionetas', 'valor histórico real (se fusiona)'],
  ['Camioneta',            'jeepetas_camionetas', 'etiqueta antigua'],
  ['camionetas',           'jeepetas_camionetas', 'plural'],
  ['Jeepeta',              'jeepetas_camionetas', 'término dominicano'],
  ['jeepetas_camionetas',  'jeepetas_camionetas', 'valor canónico nuevo'],
  ['Jeepetas / Camionetas','jeepetas_camionetas', 'la etiqueta visible completa'],
  ['JEEPETAS-CAMIONETAS',  'jeepetas_camionetas', 'mayúsculas y guion'],
  ['minivan',              'minivan',             'valor canónico nuevo'],
  ['Minivans',             'minivan',             'plural'],
  ['van',                  'minivan',             'sinónimo'],
  ['vehiculos_pesados',    'vehiculos_pesados',   'valor canónico nuevo'],
  ['Vehículos Pesados',    'vehiculos_pesados',   'etiqueta visible con acento'],
  ['camion',               'vehiculos_pesados',   'sinónimo'],
  ['patana',               'vehiculos_pesados',   'término dominicano'],
  // — entradas que NO deben inventar destino —
  ['motos',                '',                    'categoría inexistente'],
  ['',                     '',                    'cadena vacía'],
  ['   ',                  '',                    'solo espacios'],
  [null,                   '',                    'null'],
  [undefined,              '',                    'undefined'],
  [42,                     '',                    'número'],
];
casos.forEach(([entrada, esperado, motivo]) => {
  eq(T.normalizeCategory(entrada), esperado, `normalizeCategory(${JSON.stringify(entrada)}) — ${motivo}`);
});

// ------------------------------------------------------------
// 3. ETIQUETAS — nunca vacías, nunca "undefined"
// ------------------------------------------------------------
eq(T.categoryLabel('suvs'), 'Jeepetas / Camionetas', 'un SUV histórico se anuncia con la etiqueta nueva');
eq(T.categoryLabel('pickups'), 'Jeepetas / Camionetas', 'una pickup histórica también');
eq(T.categoryLabel('sedanes'), 'Sedán', 'singular por defecto');
eq(T.categoryLabel('sedanes', { plural: true }), 'Sedanes', 'plural para encabezados');
eq(T.categoryLabel('minivan', { plural: true }), 'Minivans', 'plural de minivan');
eq(T.categoryLabel('motos'), 'motos', 'un valor desconocido se muestra crudo, no se disfraza');
eq(T.categoryLabel(''), '—', 'vacío → guion, nunca "undefined"');
eq(T.categoryLabel(null), '—', 'null → guion');
eq(T.categoryLabel(undefined, { fallback: 'Sin categoría' }), 'Sin categoría', 'fallback configurable');
[ 'sedanes', 'suvs', 'pickups', 'motos', '', null, undefined, 0, {} ].forEach(x => {
  const l = T.categoryLabel(x);
  ok(typeof l === 'string' && l.length > 0 && !/undefined|\[object/.test(l),
     `categoryLabel(${JSON.stringify(x)}) devuelve texto presentable`);
});

// ------------------------------------------------------------
// 4. ICONOS DE CARACTERÍSTICAS — semántica caso por caso
//    Las 15 primeras son, literalmente, la ficha de referencia.
// ------------------------------------------------------------
const iconos = [
  ['Mazda CX9 Touring',                        'car',           'Mazda'],
  ['Año 2019',                                 'calendar-days'],
  ['Recién importada',                         'globe'],
  ['Clean Carfax',                             'file-check'],
  ['(No Salvamento)',                          'shield-check'],
  ['Pintura Original de Fabrica',              'spray-can'],
  ['Excelente condiciones',                    'award'],
  ['3 Filas de Asientos',                      'users'],
  ['Llave inteligente',                        'key-round'],
  ['4x4',                                      'mountain'],
  ['Asiento Eléctrico',                        'armchair'],
  ['Interior en Piel',                         'sofa'],
  ['Baul Eléctrico',                           'luggage'],
  ['Garantía en Motor y transmisión',          'badge-check'],
  ['💰US$20,990 🔴',                            'banknote'],
  ['Financiamiento disponible APROBACIÓN INMEDIATA', 'credit-card'],
  // — empates de orden que estaban mal resueltos —
  ['Aire acondicionado',                       'wind'],
  ['Baúl eléctrico',                           'luggage'],
  ['7 asientos',                               'users'],
  ['Asientos calefactables',                   'armchair'],
  // — equipamiento del inventario real —
  ['Cámara 360°',                              'camera'],
  ['Apple CarPlay',                            'smartphone'],
  ['Pantalla táctil 12"',                      'monitor'],
  ['Techo panorámico',                         'sun'],
  ['Sensores de parqueo',                      'radar'],
  ['Control crucero',                          'gauge'],
  ['Motor 2.5L Híbrido',                       'zap'],
  ['Luces LED',                                'lightbulb'],
  ['Transmisión automática',                   'cog'],
  ['Único dueño',                              'user-check'],
  ['Vidrios polarizados',                      'panel-top'],
  ['Bose Sound System',                        'volume-2'],
  ['Carga inalámbrica',                        'usb'],
  // — desconocidas: icono neutral, nunca undefined —
  ['Equipamiento sin clasificar',              'check-circle'],
  ['',                                         'check-circle'],
];
iconos.forEach(([texto, esperado, marca]) => {
  eq(T.featureIcon(texto, marca), esperado, `featureIcon(${JSON.stringify(texto)})`);
});
[ null, undefined, 0, {}, [] ].forEach(x => {
  const i = T.featureIcon(x);
  ok(typeof i === 'string' && i.length > 0, `featureIcon(${JSON.stringify(x)}) devuelve un nombre, no ${i}`);
});

// La queja original: demasiadas características distintas con el mismo
// icono. Esto lo fija como invariante sobre la ficha de referencia.
const distintos = new Set(iconos.slice(0, 16).map(([t, , m]) => T.featureIcon(t, m)));
ok(distintos.size >= 14,
   `las 16 características de la ficha de referencia usan ${distintos.size} iconos distintos (mínimo exigido: 14)`);

// ------------------------------------------------------------
// 5. NOMBRES DE ICONO EXISTENTES EN LUCIDE 0.263.0
// ------------------------------------------------------------
// Verificado contra el paquete npm lucide@0.263.0 (el mismo que sirve el
// CDN en index.html). Si se añade una regla con un icono fuera de esta
// lista, o se sube la versión de Lucide, esta prueba lo dice.
const ICONOS_LUCIDE_0263 = new Set([
  'armchair', 'award', 'badge-check', 'banknote', 'battery-charging', 'bluetooth',
  'bus', 'calendar-days', 'camera', 'car', 'check-circle', 'circle-dot', 'cog',
  'container', 'credit-card', 'file-check', 'fuel', 'gauge', 'globe', 'key-round',
  'lightbulb', 'luggage', 'map-pin', 'monitor', 'mountain', 'panel-top', 'radar',
  'shield', 'shield-check', 'smartphone', 'sofa', 'spray-can', 'sun', 'truck',
  'usb', 'user-check', 'users', 'volume-2', 'wind', 'wrench', 'zap',
]);
T.FEATURE_ICON_RULES.forEach(([re, icono]) => {
  ok(ICONOS_LUCIDE_0263.has(icono), `el icono "${icono}" (regla ${re}) existe en Lucide 0.263.0`);
});
ok(ICONOS_LUCIDE_0263.has(T.FEATURE_ICON_FALLBACK), 'el icono de reserva existe en Lucide 0.263.0');
T.CATEGORIES.forEach(c => {
  ok(ICONOS_LUCIDE_0263.has(c.icon), `el icono de la categoría ${c.value} ("${c.icon}") existe en Lucide 0.263.0`);
});

// ------------------------------------------------------------
// 6. EL ORDEN DE LAS REGLAS ES PARTE DEL CONTRATO
// ------------------------------------------------------------
const orden = T.FEATURE_ICON_RULES.map(([re]) => re.source);
const pos = (fragmento) => orden.findIndex(s => s.includes(fragmento));
const antes = (a, b, titulo) => {
  ok(pos(a) !== -1 && pos(b) !== -1 && pos(a) < pos(b), titulo);
};
antes('ba[\u00fau]l', 'el[\u00e9e]ctric', 'la regla del baul va antes que la de "electrico"');
antes('fila', 'asiento|butaca', 'la regla de filas va antes que la de asientos');
antes('cuero|piel', 'asiento|butaca', 'la regla de interior en piel va antes que la de asientos');
antes('clima', 'condiciones', 'la regla del clima va antes que la de "condiciones"');
antes('garant[\u00edi]a', 'motor', 'la regla de garantia va antes que la de motor');

// ------------------------------------------------------------
console.log('');
if (fallos.length === 0) {
  console.log(`  \u001b[32mOK\u001b[0m  ${pasadas} comprobaciones de taxonomía pasaron`);
  process.exit(0);
}
console.log(`  \u001b[31mFALLOS\u001b[0m ${fallos.length} de ${pasadas + fallos.length}`);
fallos.forEach(f => console.log(`   · ${f}`));
process.exit(1);
