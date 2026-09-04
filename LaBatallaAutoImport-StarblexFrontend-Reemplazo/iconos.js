// Renderiza los iconos de Lucide en las páginas estáticas (Empresa, legales
// y 404). Vive en un archivo propio porque el CSP ya no permite
// script-src 'unsafe-inline': el mismo bloque estaba repetido en 7 páginas.
window.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) lucide.createIcons();
});
