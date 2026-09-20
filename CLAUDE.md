# La Batalla Auto Import — contexto para Claude

Plataforma de venta de vehículos en República Dominicana. SPA estática en
**Vanilla JS**, Firebase (Auth + Firestore) y Netlify.
Producción: https://labatallaautoimport.netlify.app

## Dónde está todo

```
/                                          raíz del repositorio (NO se publica)
├── CLAUDE.md                              este archivo
├── tools/verificar.sh                     verificación determinista (capa 1)
├── .claude/skills/auditoria-semanal/      protocolo de auditoría (capa 2)
├── .github/workflows/                     verificacion.yml · actualizar-sitemap.yml
└── LaBatallaAutoImport-StarblexFrontend-Reemplazo/    ← EL SITIO
```

**El sitio vive en la subcarpeta**, no en la raíz. Netlify tiene ahí su
*Base directory*, y `publish = "."` publica esa carpeta entera. Toda ruta
de `netlify.toml`, `index.html` y del código es relativa a ella.

Consecuencia directa: **cualquier archivo nuevo dentro de esa carpeta
queda descargable desde internet**. Si es interno (documentación, reglas,
pruebas, configuración), necesita su redirect 404 con `force = true` en
`netlify.toml`. `tools/verificar.sh` lo comprueba.

## Antes de tocar código

Leer `LaBatallaAutoImport-StarblexFrontend-Reemplazo/README.md`, sección
**"Reglas de sincronización crítica"**. Son invariantes del dominio que no
se deducen leyendo el código y cuya violación produce bugs graves. Las tres
que más cuesta descubrir por las malas:

1. **Moneda: no se convierte nada.** Cada vehículo se cotiza en la moneda
   en que se publicó. `price` de un vehículo en USD es un **índice
   interno** (lo exige el esquema de `firestore.rules`), no un precio: no
   se muestra, no se imprime, no se envía. `vehicleAmount()` devuelve
   `null` cuando el importe real no se puede conocer, y quien llama debe
   **negarse a cotizar**, nunca caer a otro campo.
2. **Arranque coordinado por `boot.js`.** Los scripts se cargan con
   `defer` y entre uno y otro el navegador atiende la cola de tareas: un
   callback de Firestore puede ejecutarse antes de que exista la función
   de `auth.js` que necesita. Toda dependencia se declara con
   `LBBoot.once([...])`. Una compuerta nunca rechaza: falla con
   `{ok:false}` para desbloquear a quien espera. Ignorar esto ya dejó el
   sitio en "Cargando…" permanente.
3. **La categoría es tres cosas a la vez.** `vehiculo-taxonomia.js` es la
   fuente única: el valor que se guarda en Firestore es también el id de la
   sección del catálogo y el `value` del `<select>` de publicar. Falta en
   uno de los tres y el fallo es mudo (vehículos que no se pintan, o
   `permission-denied` al publicar). Los valores antiguos (`suvs`,
   `pickups`) se traducen al leer; no se migra ningún documento.
4. **`slugify()` existe en tres entornos** que no comparten scope:
   `app.js` (navegador), `scripts/generar-sitemap.js` (Node del build) y
   `netlify/edge-functions/vehicle-og.js` (Deno). Si cambia una, cambian
   las tres, o la URL que genera el sitio deja de resolver.

Y dos reglas de infraestructura:

- **`?v=AAAAMMDD`:** al modificar un `.js`/`.css` que `index.html`
  referencia, subir su `?v=` en `index.html`. Es lo único que evita que
  los navegadores sirvan la versión vieja contra el HTML nuevo.
- **CSP:** al añadir un dominio externo, añadirlo a la
  `Content-Security-Policy` de `netlify.toml` o el navegador lo bloqueará
  en silencio. `script-src` **no** admite `'unsafe-inline'`: no hay
  handlers inline (`onclick=`) en el HTML y no deben volver.

## Comandos

```bash
bash tools/verificar.sh                # invariantes del sitio (segundos, sin red)
node scripts/generar-sitemap.js        # regenerar sitemap (desde la carpeta del sitio)
firebase deploy --only firestore:rules # publicar reglas de Firestore
```

## Cómo se trabaja aquí

- **Nunca push directo a `main`.** Push a la rama principal = deploy
  automático a producción. Los cambios van en rama y pasan por PR.
- Un commit por cambio con causa raíz en el mensaje, no un commit
  monolítico: lo que no se puede revertir solo, no está bien empaquetado.
- Cambios de comportamiento se documentan en `RELEASE_NOTES.md`, arriba,
  con el estilo del archivo: síntoma, causa raíz, corrección, verificación.
  No changelog telegráfico.
- Sin frameworks, sin npm, sin bundler. Es una decisión del proyecto, no
  una carencia.
- `tailwind.css` es compilado: no se edita a mano.

## Rutina de calidad (dos capas)

| Capa | Qué | Cuándo |
|---|---|---|
| 1 | `tools/verificar.sh` vía `.github/workflows/verificacion.yml` — invariantes objetivas, cero falsos positivos | Cada push y cada PR |
| 2 | `/auditoria-semanal` — criterio: seguridad, rendimiento, SEO, accesibilidad, UX, código | Semanal, con área rotatoria |

El protocolo completo de la capa 2 está en
`.claude/skills/auditoria-semanal/SKILL.md`, y el checklist por área en
`checklist.md` junto a él. La regla que gobierna esa auditoría: **cada
hallazgo se demuestra antes de reportarse**. "0 hallazgos nuevos,
verificado" es un resultado válido; inventar uno para parecer productivo
es el único fracaso posible.
