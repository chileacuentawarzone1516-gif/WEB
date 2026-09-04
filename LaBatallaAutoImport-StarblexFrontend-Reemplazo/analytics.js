// Inicialización de Google Analytics (GA4). Estaba en un <script> inline en
// index.html; se externaliza para poder retirar script-src 'unsafe-inline'
// del CSP. gtag() debe quedar en el ámbito global: gtag.js (cargado con
// async justo antes) comparte la cola window.dataLayer, así que el orden
// relativo entre ambos no afecta al registro de eventos.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-8Q0K0K1MBP');
