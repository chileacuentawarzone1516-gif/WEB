// ============================================================
// BOOT.JS — Coordinador de dependencias del arranque
// ------------------------------------------------------------
// POR QUÉ EXISTE (defecto C-1 de la auditoría de release)
//
// El sitio carga 11 scripts clásicos con `defer`. Se ejecutan en orden
// de documento, pero entre la ejecución de uno y la del siguiente el
// navegador SÍ atiende la cola de tareas si el siguiente todavía se
// está descargando. En esa ventana, una respuesta de red puede llegar
// y ejecutar un callback que use una función que aún no existe.
//
// Eso pasaba de verdad: `app.js` registra `onSnapshot` de Firestore
// durante su propia ejecución, y el callback llamaba a
// `canManageVehicles()` -> `getCurrentUser()`, definida en `auth.js`,
// que se carga DESPUÉS. Si el snapshot ganaba la carrera, el callback
// lanzaba ReferenceError y abortaba a mitad: no se quitaba la capa de
// carga ni se pintaba el catálogo. Y como las dos primeras líneas del
// callback ya habían desarmado el vigilante de 12 s, no quedaba ningún
// mecanismo de recuperación: la página se quedaba en "Cargando…" para
// siempre. Reproducido con 400 ms de latencia añadida a auth.js.
//
// QUÉ RESUELVE ESTE ARCHIVO
//
// Sustituye el orden ACCIDENTAL de descarga por dependencias
// EXPLÍCITAS. Cada pieza del arranque anuncia cuándo está lista y cada
// consumidor declara qué necesita. Nadie asume que otro script ya se
// ejecutó.
//
// REGLA DE DISEÑO CLAVE: una compuerta NUNCA rechaza.
// `fail()` la resuelve con {ok:false}. Así, una dependencia rota
// DESBLOQUEA a quien la espera en vez de dejarlo colgado — que es
// exactamente el fallo que se está corrigiendo. Quien espera decide
// qué hacer con el fracaso; nunca se queda esperando.
//
// Este archivo se carga el PRIMERO de todos y no depende de nada.
// ============================================================
(function () {
  'use strict';

  // nombre -> { promise, resolve, settled, state }
  const gates = new Map();

  function gateOf(name) {
    let g = gates.get(name);
    if (!g) {
      let resolve;
      const promise = new Promise(function (r) { resolve = r; });
      g = { promise: promise, resolve: resolve, settled: false, state: null };
      gates.set(name, g);
    }
    return g;
  }

  // Primera resolución gana: un segundo signal()/fail() sobre la misma
  // compuerta se ignora (p. ej. onAuthStateChanged dispara muchas veces,
  // pero "auth resuelta por primera vez" ocurre una sola).
  function settle(name, state) {
    const g = gateOf(name);
    if (g.settled) return g.state;
    g.settled = true;
    g.state = state;
    g.resolve(state);
    return state;
  }

  const LBBoot = {
    /** Marca una dependencia como lista. */
    signal: function (name, value) {
      return settle(name, { ok: true, name: name, value: value === undefined ? null : value });
    },

    /** Marca una dependencia como FALLIDA. Resuelve, no rechaza. */
    fail: function (name, error) {
      return settle(name, { ok: false, name: name, error: error || new Error(name) });
    },

    isSettled: function (name) { return gateOf(name).settled; },
    isOk: function (name) { const s = gateOf(name).state; return !!(s && s.ok); },
    stateOf: function (name) { return gateOf(name).state; },

    /** Promesa que resuelve cuando TODAS las dependencias se han resuelto. */
    when: function (names) {
      const list = Array.isArray(names) ? names : [names];
      return Promise.all(list.map(function (n) { return gateOf(n).promise; }));
    },

    /**
     * Ejecuta `fn` una vez resueltas todas las dependencias. Envuelve la
     * llamada en try/catch: un error del consumidor no puede propagarse
     * ni dejar nada a medias.
     */
    once: function (names, fn) {
      return LBBoot.when(names).then(function (states) {
        try { return fn(states); }
        catch (e) { console.error('[boot] fallo ejecutando el consumidor de', names, e); }
      });
    },

    /** Estado de todas las compuertas — para diagnóstico desde la consola. */
    debug: function () {
      const out = [];
      gates.forEach(function (g, n) { out.push({ gate: n, settled: g.settled, ok: g.state ? g.state.ok : null }); });
      return out;
    }
  };

  window.LBBoot = LBBoot;

  // La única compuerta que este archivo resuelve por su cuenta.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { LBBoot.signal('dom'); });
  } else {
    LBBoot.signal('dom');
  }
})();
