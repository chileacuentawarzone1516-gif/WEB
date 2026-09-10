// ============================================================
// MEDIA-MODEL — forma canónica de `media` en TODO el sitio
// ------------------------------------------------------------
// PROBLEMA QUE RESUELVE
//
// `media` se leía en cinco sitios distintos (portada del catálogo,
// galería de la ficha, miniatura del dashboard, precarga al editar y
// og:image), y cada uno aplicaba un criterio propio:
//
//   app.js getVehicleCover  → string | {src}
//   app.js openDetail       → string | {src}
//   dashboard.js dbThumb    → string | {src}  ← reventaba con null:
//                             `v.media[0].src` lanza TypeError si el
//                             elemento es null, y un solo documento con
//                             un hueco en el array dejaba el panel en
//                             blanco entero.
//   openPublishModal        → string | {src}
//   vehicle-og.js           → su propia copia (Deno, no comparte scope)
//
// Ninguno contemplaba las formas que devuelve la cadena de subida antes
// de mapearse ({url}, {secure_url}, {cloudUrl}), ni descartaba valores
// que no son URLs renderizables. El resultado histórico fueron
// `src="[object Object]"`, `src=""` y `src="undefined"`: peticiones HTTP
// reales del navegador que devuelven el HTML de la home con
// Content-Type text/html dentro de un <img>.
//
// Aquí vive UN solo criterio. Nadie más interpreta `media`.
//
// CONTRATO
//   normalizeMediaList(cualquier cosa) → [{type:'image'|'video', src:string}]
//   coverSrc(vehiculo, respaldo)       → string SIEMPRE no vacío
//
// Es tolerante en la ENTRADA (documentos antiguos, formas mixtas) y
// estricto en la SALIDA: si algo no puede renderizarse, no sale.
// ============================================================
(function () {
  'use strict';

  // Claves donde los distintos eslabones de la cadena han guardado la URL:
  //   src         — esquema actual guardado en Firestore
  //   url         — lo que devuelve LBMedia.uploadFile()
  //   secure_url  — respuesta cruda de la API de Cloudinary
  //   cloudUrl    — campo interno de pendingFiles en el formulario
  // El orden es deliberado: de lo más canónico a lo más interno.
  const URL_KEYS = ['src', 'url', 'secure_url', 'cloudUrl'];

  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|avi|mkv|ogv|3gp)(\?|#|$)/i;

  // Protocolos que un <img>/<video> puede realmente pintar. Se excluye
  // todo lo demás a propósito: una ruta relativa vacía, un `javascript:`
  // o un texto suelto guardado por error no deben llegar nunca al DOM.
  function isRenderableUrl(value) {
    if (typeof value !== 'string') return false;
    const url = value.trim();
    if (!url) return false;
    return /^(https?:\/\/|data:image\/|data:video\/|blob:|\/)/i.test(url);
  }

  function extractUrl(item) {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    for (const key of URL_KEYS) {
      const value = item[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  // El tipo declarado manda; si no lo hay (registros antiguos guardados
  // como cadena suelta) se deduce de la extensión. Cloudinary conserva la
  // extensión original en secure_url, así que un .mp4 se detecta bien.
  function resolveType(item, url) {
    const declared = item && typeof item === 'object' ? item.type : null;
    if (declared === 'video' || declared === 'image') return declared;
    if (typeof declared === 'string' && declared.startsWith('video')) return 'video';
    return VIDEO_EXTENSIONS.test(url) ? 'video' : 'image';
  }

  /**
   * Convierte cualquier `media` en la lista canónica.
   * Acepta: array, elemento suelto, null, undefined, objetos mixtos.
   * Devuelve SIEMPRE un array (posiblemente vacío) sin elementos nulos,
   * sin duplicados y con `src` garantizado como cadena renderizable.
   */
  function normalizeMediaList(raw) {
    const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    const out = [];
    const seen = new Set();
    for (const item of items) {
      const url = extractUrl(item);
      if (!isRenderableUrl(url)) continue;
      // Dos entradas con la misma URL producirían dos puntos en la
      // galería para la misma foto. Se conserva la primera aparición,
      // que es la que decide la portada.
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ type: resolveType(item, url), src: url });
    }
    return out;
  }

  /**
   * Portada del vehículo: primera imagen válida de `media`, con caída a
   * `img` (esquema antiguo) y por último al respaldo indicado.
   *
   * Un vídeo NO puede ser portada: la portada se pinta en un <img> del
   * catálogo y una URL .mp4 ahí es una imagen rota garantizada. Si el
   * primer elemento es un vídeo se busca la primera imagen real; si no
   * hay ninguna, se usa el respaldo.
   */
  function coverSrc(vehicle, placeholder) {
    const media = normalizeMediaList(vehicle && vehicle.media);
    const firstImage = media.find(m => m.type === 'image');
    if (firstImage) return firstImage.src;
    const legacy = vehicle && vehicle.img;
    if (isRenderableUrl(legacy)) return legacy.trim();
    return placeholder;
  }

  /**
   * Lista para la galería de la ficha: `media` normalizado y, si está
   * vacío, la portada antigua (`img`) como único elemento. Nunca
   * devuelve elementos sin `src`.
   */
  function galleryList(vehicle) {
    const media = normalizeMediaList(vehicle && vehicle.media);
    if (media.length > 0) return media;
    const legacy = vehicle && vehicle.img;
    return isRenderableUrl(legacy) ? [{ type: 'image', src: legacy.trim() }] : [];
  }

  window.LBMediaModel = {
    normalizeMediaList,
    coverSrc,
    galleryList,
    isRenderableUrl,
  };
})();
