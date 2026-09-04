// ============================================================
// HERO CAROUSEL — carrusel de portada (6 diapositivas)
// ------------------------------------------------------------
// Módulo autocontenido. Se extrajo de app.js porque allí mezclaba
// responsabilidades (catálogo, Firestore, modales) y porque el
// carrusel necesitaba lógica propia para funcionar en teléfono.
//
// POR QUÉ NO ROTABA EN MÓVIL (causas raíz encontradas):
//
//   1. `prefers-reduced-motion: reduce` cancelaba el autoplay POR
//      COMPLETO. Android activa esa preferencia solo con el ahorro de
//      batería, con "Quitar animaciones" de Accesibilidad o con la
//      escala de animación en 0 (MIUI la pone así en modo ahorro).
//      Resultado real: en PC rotaba y en el teléfono se quedaba fijo
//      en la primera imagen para siempre. Ahora la preferencia se
//      respeta como corresponde —se elimina el CRUCE de opacidad y se
//      alarga el intervalo—, pero el contenido sigue avanzando.
//
//   2. `setInterval` es poco fiable en móvil: al bloquear la pantalla,
//      cambiar de app o restaurar la página desde la bfcache, el
//      navegador congela o descarta el temporizador y al volver el
//      carrusel se quedaba parado. Se sustituye por una cadena de
//      `setTimeout` que se re-arma en `visibilitychange`, `pageshow`
//      y `focus`.
//
//   3. `onerror="this.style.display='none'"` dejaba diapositivas
//      INVISIBLES dentro de la rotación: si una foto no cargaba (datos
//      móviles, ahorro de datos), el carrusel "cambiaba" a una imagen
//      oculta y el usuario veía la portada congelada varios segundos.
//      Ahora una diapositiva rota se marca y se salta.
//
//   4. No había gesto táctil. En un teléfono lo natural es deslizar,
//      no buscar una flecha de 40 px. Se añade swipe horizontal.
//
// ACCESIBILIDAD (WCAG 2.2):
//   - 2.2.2 Pause, Stop, Hide: botón visible de pausa/reanudar. También
//     se detiene con el foco de teclado dentro o mientras se desliza con
//     el dedo, pero NO al pasar el ratón por encima: el hero ocupa casi
//     toda la primera pantalla, así que eso lo dejaba congelado en PC.
//   - 4.1.2 / 1.3.1: patrón tablist + tab con `aria-controls`,
//     `aria-selected` y foco móvil (roving tabindex).
//   - 2.1.1: flechas ← → del teclado cuando el foco está en el hero.
//   - La región de diapositivas anuncia el cambio (`aria-live`) solo
//     cuando el carrusel está pausado, para no interrumpir la lectura
//     con anuncios automáticos cada 5,5 s.
// ============================================================
(function () {
  'use strict';

  // ——— Configuración ———
  const AUTOPLAY_MS = 4000;          // cadencia normal
  const AUTOPLAY_MS_REDUCED = 7000;  // sin animación: más tiempo de lectura
  const TEXT_FADE_MS = 250;          // debe coincidir con #hero-text-wrap
  const SWIPE_MIN_PX = 40;           // recorrido mínimo para contar como swipe
  const SWIPE_MAX_DURATION_MS = 800; // por encima es un arrastre, no un gesto
  const RESUME_AFTER_SWIPE_MS = 200; // margen tras soltar el dedo

  const root = document.getElementById('hero-slides');
  const slideEls = root ? Array.from(root.querySelectorAll('.slide')) : [];
  if (!root || slideEls.length === 0) return;

  const heroEl = document.getElementById('hero');
  const titleEl = document.getElementById('hero-title');
  const subtitleEl = document.getElementById('hero-subtitle');
  const textWrap = document.getElementById('hero-text-wrap');
  const dotsEl = document.getElementById('hero-dots');
  const prevBtn = document.getElementById('hero-prev');
  const nextBtn = document.getElementById('hero-next');
  const toggleBtn = document.getElementById('hero-toggle');
  const statusEl = document.getElementById('hero-status');

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reducedMotion = motionQuery.matches;

  // `broken[i] === true` → la imagen no se pudo cargar: se salta.
  const broken = new Array(slideEls.length).fill(false);
  let index = Math.max(0, slideEls.findIndex(el => el.classList.contains('active')));
  let timerId = null;
  let textTimerId = null;
  // Pausa explícita del usuario (botón). Se recuerda en la sesión para
  // que no vuelva a arrancar solo al navegar por la SPA.
  let userPaused = readStoredPause();
  // Pausas transitorias. Se modelan como banderas independientes y no como
  // un contador: un contador se descuadra en cuanto falta un evento de
  // cierre (el foco se va a otra pestaña, el dedo se levanta fuera de la
  // página) y el carrusel se queda parado sin forma de recuperarse.
  let focusHold = false;
  let gestureHold = false;
  // ————————————————————————————————————————————————
  // Estado persistido de la pausa
  // ————————————————————————————————————————————————
  function readStoredPause() {
    try { return sessionStorage.getItem('lb-hero-paused') === '1'; } catch (e) { return false; }
  }
  function storePause(value) {
    try { sessionStorage.setItem('lb-hero-paused', value ? '1' : '0'); } catch (e) { /* modo privado */ }
  }

  // ————————————————————————————————————————————————
  // Salud de las imágenes — una diapositiva que no carga se saca de la
  // rotación en vez de mostrarse en blanco.
  // ————————————————————————————————————————————————
  function markBroken(i) {
    if (broken[i]) return;
    broken[i] = true;
    slideEls[i].classList.add('slide--broken');
    renderDots();
    // Si la rota es justo la visible, saltamos a la siguiente útil.
    if (i === index) {
      const nextIdx = findUsable(index, 1);
      if (nextIdx !== index) goTo(nextIdx, { silent: true });
    }
  }

  slideEls.forEach((el, i) => {
    // El atributo onerror inline del HTML se elimina: la gestión del
    // fallo vive aquí, junto al resto del estado del carrusel.
    el.removeAttribute('onerror');
    if (el.complete) {
      if (el.naturalWidth === 0) markBroken(i);
    } else {
      el.addEventListener('error', () => markBroken(i), { once: true });
    }
  });

  function usableCount() {
    return broken.reduce((n, isBroken) => n + (isBroken ? 0 : 1), 0);
  }

  // Devuelve el siguiente índice utilizable en la dirección indicada.
  // Si no queda ninguno (todas rotas), devuelve el actual.
  function findUsable(from, direction) {
    const total = slideEls.length;
    for (let step = 1; step <= total; step++) {
      const candidate = ((from + direction * step) % total + total) % total;
      if (!broken[candidate]) return candidate;
    }
    return from;
  }

  // ————————————————————————————————————————————————
  // Precarga de la siguiente imagen: en móvil evita el fotograma en
  // negro al cambiar de diapositiva con conexión lenta.
  // ————————————————————————————————————————————————
  function warmUpNext() {
    const next = slideEls[findUsable(index, 1)];
    if (!next || next.dataset.warmed === '1') return;
    next.dataset.warmed = '1';
    // loading="lazy" ya no aporta nada en una imagen que vamos a mostrar
    // en segundos; forzar la carga aquí es lo que evita el parpadeo.
    next.loading = 'eager';
    const warm = new Image();
    warm.src = next.currentSrc || next.src;
  }

  // ————————————————————————————————————————————————
  // Indicadores (dots)
  // ————————————————————————————————————————————————
  function renderDots() {
    if (!dotsEl) return;
    dotsEl.innerHTML = slideEls.map((_, i) => {
      if (broken[i]) return '';
      const isActive = i === index;
      return `<button type="button" class="hero-dot${isActive ? ' active' : ''}" data-idx="${i}"
        role="tab" aria-controls="hero-slides" aria-selected="${isActive}"
        tabindex="${isActive ? '0' : '-1'}"
        aria-label="Ir a la diapositiva ${i + 1} de ${slideEls.length}"></button>`;
    }).join('');
  }

  function updateDots() {
    if (!dotsEl) return;
    dotsEl.querySelectorAll('.hero-dot').forEach(dot => {
      const isActive = Number(dot.dataset.idx) === index;
      dot.classList.toggle('active', isActive);
      dot.setAttribute('aria-selected', String(isActive));
      dot.tabIndex = isActive ? 0 : -1;
    });
  }

  // Delegación: los dots se vuelven a pintar cuando una imagen falla, así
  // que un listener por botón se perdería. Uno solo en el contenedor no.
  dotsEl?.addEventListener('click', e => {
    const dot = e.target.closest('.hero-dot');
    if (!dot) return;
    goTo(Number(dot.dataset.idx), { userInitiated: true });
  });

  // ————————————————————————————————————————————————
  // Texto del hero (título + subtítulo por diapositiva)
  // ————————————————————————————————————————————————
  function applySlideText(immediate) {
    if (!textWrap) return;
    const active = slideEls[index];
    const apply = () => {
      if (titleEl && active.dataset.title) titleEl.textContent = active.dataset.title;
      if (subtitleEl && active.dataset.subtitle) subtitleEl.textContent = active.dataset.subtitle;
      textWrap.style.opacity = '1';
    };
    if (immediate || reducedMotion) { apply(); return; }
    textWrap.style.opacity = '0';
    clearTimeout(textTimerId);
    textTimerId = setTimeout(apply, TEXT_FADE_MS);
  }

  function announce() {
    if (!statusEl) return;
    statusEl.textContent = `Diapositiva ${index + 1} de ${slideEls.length}: ${slideEls[index].dataset.title || ''}`;
  }

  // ————————————————————————————————————————————————
  // Navegación
  // ————————————————————————————————————————————————
  function goTo(newIdx, options = {}) {
    const total = slideEls.length;
    let target = ((newIdx % total) + total) % total;
    if (broken[target]) target = findUsable(target - 1, 1);
    if (target === index) { if (options.userInitiated) restart(); return; }

    slideEls[index].classList.remove('active');
    index = target;
    slideEls[index].classList.add('active');

    applySlideText(options.silent === true);
    updateDots();
    warmUpNext();
    // Solo se anuncia cuando el usuario conduce el carrusel o está
    // pausado: anunciar cada rotación automática es ruido para un lector
    // de pantalla (WCAG 2.2.2 / 4.1.3).
    if (options.userInitiated || isPaused()) announce();
    if (options.userInitiated) restart();
  }

  function next(userInitiated) { goTo(findUsable(index, 1), { userInitiated }); }
  function prev(userInitiated) { goTo(findUsable(index, -1), { userInitiated }); }

  // ————————————————————————————————————————————————
  // Autoplay — cadena de setTimeout auto-corregida.
  // `setInterval` se descartó porque en móvil el navegador lo congela al
  // bloquear la pantalla o al pasar a segundo plano y no siempre lo
  // reanuda; con setTimeout re-armamos nosotros en cada evento de
  // visibilidad y el carrusel nunca se queda muerto.
  // ————————————————————————————————————————————————
  function isPaused() {
    return userPaused || focusHold || gestureHold || usableCount() < 2;
  }

  function stopTimer() {
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
  }

  function schedule() {
    stopTimer();
    if (isPaused() || document.hidden) return;
    const delay = reducedMotion ? AUTOPLAY_MS_REDUCED : AUTOPLAY_MS;
    timerId = setTimeout(() => {
      timerId = null;
      if (document.hidden || isPaused()) { schedule(); return; }
      next(false);
      schedule();
    }, delay);
  }

  function restart() { schedule(); }

  // Punto único donde se aplica un cambio de pausa transitoria: recalcula
  // el temporizador y la región aria-live sin duplicar lógica.
  function syncHolds() {
    if (isPaused()) stopTimer(); else schedule();
    syncLiveRegion();
  }

  function syncLiveRegion() {
    // Con el carrusel en marcha no debe anunciar nada automáticamente.
    root.setAttribute('aria-live', isPaused() ? 'polite' : 'off');
  }

  function setPaused(paused, persist) {
    userPaused = paused;
    if (persist) storePause(paused);
    updateToggle();
    syncLiveRegion();
    schedule();
  }

  function updateToggle() {
    if (!toggleBtn) return;
    const label = userPaused ? 'Reanudar el carrusel' : 'Pausar el carrusel';
    toggleBtn.setAttribute('aria-label', label);
    toggleBtn.title = label;
    toggleBtn.setAttribute('aria-pressed', String(userPaused));
    toggleBtn.classList.toggle('is-paused', userPaused);
  }

  // ————————————————————————————————————————————————
  // Controles
  // ————————————————————————————————————————————————
  prevBtn?.addEventListener('click', () => prev(true));
  nextBtn?.addEventListener('click', () => next(true));
  toggleBtn?.addEventListener('click', () => setPaused(!userPaused, true));

  // Teclado: flechas mientras el foco está dentro del hero.
  heroEl?.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(true); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next(true); }
    else if (e.key === 'Home') { e.preventDefault(); goTo(findUsable(-1, 1), { userInitiated: true }); }
    else if (e.key === 'End') { e.preventDefault(); goTo(findUsable(slideEls.length, -1), { userInitiated: true }); }
    else return;
    // Al navegar con teclado mantenemos el foco en el indicador activo.
    dotsEl?.querySelector('.hero-dot.active')?.focus();
  });

  // El puntero del ratón NO pausa. Pausar al pasar por encima dejaba el
  // carrusel congelado en escritorio: el hero ocupa casi toda la primera
  // pantalla, así que el cursor está dentro casi todo el tiempo y bastaba
  // con mover el ratón para que no volviera a avanzar. En el teléfono no
  // hay hover, y de ahí que allí sí rotara. WCAG 2.2.2 queda cubierto por
  // el botón de pausa, que es explícito y no depende de dónde esté el
  // puntero; el foco de teclado y el gesto táctil sí siguen pausando.

  // Solo el foco de TECLADO pausa. Es la diferencia entre un carrusel que
  // funciona en el teléfono y uno que no: al tocar una flecha, Android
  // deja el botón enfocado, y con un `focusin` genérico el carrusel se
  // quedaba parado justo después de que el usuario lo usara.
  heroEl?.addEventListener('focusin', e => {
    if (focusHold) return;
    let keyboard = true;
    try { keyboard = e.target.matches(':focus-visible'); } catch (err) { keyboard = true; }
    if (!keyboard) return;
    focusHold = true;
    syncHolds();
  });
  heroEl?.addEventListener('focusout', e => {
    if (!focusHold) return;
    if (e.relatedTarget && heroEl.contains(e.relatedTarget)) return; // sigue dentro
    focusHold = false;
    syncHolds();
  });

  // ————————————————————————————————————————————————
  // Gesto táctil (swipe) — el control natural en teléfono.
  // No se llama a preventDefault(): el scroll vertical de la página debe
  // seguir funcionando. `touch-action: pan-y` (styles.css) es lo que le
  // dice al navegador que el eje horizontal es nuestro.
  // ————————————————————————————————————————————————
  let gesture = null;

  // El gesto se escucha en el <header> completo, no en #hero-slides: la
  // capa oscura (`bg-black/50`) y el bloque de texto cubren las imágenes,
  // así que un listener en las imágenes nunca recibiría el toque.
  heroEl?.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;        // el ratón usa flechas y dots
    if (e.target.closest('button')) return;       // pulsar un control no es deslizar
    gesture = { x: e.clientX, y: e.clientY, t: Date.now() };
    gestureHold = true;
    syncHolds();
  }, { passive: true });

  // `pointerup` se escucha en window: si el dedo se levanta fuera del
  // hero (gesto largo hacia el catálogo) el listener del header nunca se
  // dispararía y la pausa quedaría activa para siempre.
  function endGesture(e) {
    if (!gesture) return;
    const { x, y, t } = gesture;
    gesture = null;
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    const elapsed = Date.now() - t;
    const isHorizontal = Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= SWIPE_MIN_PX;
    if (isHorizontal && elapsed <= SWIPE_MAX_DURATION_MS) {
      if (dx < 0) next(true); else prev(true);
    }
    setTimeout(() => { gestureHold = false; syncHolds(); }, RESUME_AFTER_SWIPE_MS);
  }

  window.addEventListener('pointerup', endGesture, { passive: true });
  window.addEventListener('pointercancel', () => {
    if (!gesture) return;
    gesture = null;
    gestureHold = false;
    syncHolds();
  }, { passive: true });

  // ————————————————————————————————————————————————
  // Re-armado ante todo lo que puede matar el temporizador en móvil.
  // ————————————————————————————————————————————————
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTimer(); else schedule();
  });
  window.addEventListener('pageshow', schedule);   // vuelta desde bfcache
  window.addEventListener('focus', schedule);
  window.addEventListener('online', schedule);

  // La preferencia de movimiento puede cambiar en caliente (activar el
  // ahorro de batería sin recargar la página).
  const onMotionChange = () => {
    reducedMotion = motionQuery.matches;
    document.documentElement.classList.toggle('lb-reduced-motion', reducedMotion);
    schedule();
  };
  if (typeof motionQuery.addEventListener === 'function') motionQuery.addEventListener('change', onMotionChange);
  else if (typeof motionQuery.addListener === 'function') motionQuery.addListener(onMotionChange);

  // ————————————————————————————————————————————————
  // API pública mínima — control del carrusel desde fuera del módulo.
  // takeOverText()/releaseText() desaparecieron con la SPA de Empresa:
  // el <h1>/<p> del hero ya no los reutiliza ninguna otra vista.
  // ————————————————————————————————————————————————
  window.LBHero = {
    next: () => next(true),
    prev: () => prev(true),
    goTo: i => goTo(i, { userInitiated: true }),
    pause: () => setPaused(true, false),
    play: () => setPaused(false, false)
  };

  // ————————————————————————————————————————————————
  // Arranque
  // ————————————————————————————————————————————————
  document.documentElement.classList.toggle('lb-reduced-motion', reducedMotion);
  renderDots();
  updateToggle();
  syncLiveRegion();
  applySlideText(true);
  warmUpNext();
  schedule();
})();
