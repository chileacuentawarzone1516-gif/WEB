---
name: auditoria-semanal
description: Auditoría semanal de La Batalla Auto Import. Úsala cuando toque la revisión semanal del sitio, cuando se pida una auditoría de seguridad, rendimiento, SEO, accesibilidad o calidad de código del proyecto, o antes de un release. Produce hallazgos verificados con corrección aplicada, no una lista de recomendaciones.
---

# Auditoría semanal — La Batalla Auto Import

## Qué entrega esta auditoría

Una rama con **correcciones aplicadas y verificadas** más un informe que
explica causa raíz de cada una. No una lista de sugerencias.

La medida de una buena auditoría en este proyecto **no** es el número de
hallazgos. Es que cada hallazgo reportado sea real, esté demostrado y su
corrección no rompa nada. `RELEASE_NOTES.md` lo dice de una auditoría
anterior: *"No se inventaron problemas ni se hicieron cambios
cosméticos"*. Una auditoría que termina con "0 hallazgos nuevos, esto se
verificó" es un resultado válido y bueno. Inventar un hallazgo para
parecer productivo es el único fracaso posible.

## Fase 0 — Contexto y estado (obligatoria, siempre)

Antes de mirar una sola línea de código:

1. `bash tools/verificar.sh` — las invariantes objetivas. Si algo está
   en rojo, **eso es el primer hallazgo** y se corrige antes de seguir.
2. Leer `README.md`, sección **"Reglas de sincronización crítica"**. Son
   invariantes del dominio que no se deducen del código; violarlas es la
   forma más rápida de introducir un bug grave en este proyecto.
3. Leer los encabezados de `RELEASE_NOTES.md` (`grep -n '^#\{1,3\} '`).
   Sirve para dos cosas: no reportar como nuevo algo ya corregido, y
   reconocer un defecto que vuelve (una regresión es más grave que un
   defecto nuevo, porque significa que falta una barrera).
4. `git log --since="8 days ago" --stat` — **qué cambió esta semana**. Es
   el material de auditoría más rentable que existe: el código nuevo es
   donde están los bugs nuevos. Se revisa entero, siempre, sin importar
   el área que toque en la rotación.

## Fase 1 — Rotación por profundidad

El código fuente completo (~800 KB, `app.js` solo son 170 KB) no cabe en
una ventana de contexto junto con el análisis. Intentar abarcarlo todo
cada semana produce una lectura superficial de todo y profunda de nada.

Por eso cada semana se audita **en profundidad un área**, y se rota:

| Semana del mes | Área en profundidad | Archivos eje |
|---|---|---|
| 1ª | **Seguridad y autorización** | `firestore.rules`, `auth.js`, `roles.js`, `netlify/functions/*`, `cloudinary-sign-worker.js`, CSP de `netlify.toml` |
| 2ª | **Rendimiento y Core Web Vitals** | `index.html` (`<head>`, orden de scripts), `app.js` (render del catálogo), imágenes, `netlify.toml` (caché) |
| 3ª | **SEO y accesibilidad** | `index.html`, `empresa/*.html`, JSON-LD, `sitemap.xml`, `netlify/edge-functions/vehicle-og.js`, modales y formularios |
| 4ª | **Calidad de código y UX** | `app.js`, `dashboard.js`, `calculadora.js`, duplicación, `styles.css`, responsive |

El detalle de qué mirar en cada área está en
[`checklist.md`](checklist.md). Ese archivo es la lista de comprobación;
este es el método.

Además del área en profundidad, **cada semana** se hace el barrido
rápido: fase 0 completa + el diff de la semana + una pasada sobre las
áreas restantes buscando solo señales de alarma evidentes (no
exhaustividad).

## Fase 2 — Regla de evidencia (lo que separa esto de adivinar)

Un hallazgo no se reporta hasta que se puede responder a las cuatro:

1. **Dónde** — archivo y línea exactos.
2. **Cómo se dispara** — la secuencia concreta: qué usuario, con qué rol,
   en qué pantalla, con qué datos. Si no se puede describir el camino, no
   es un hallazgo: es una sospecha, y va al informe como tal o no va.
3. **Qué pasa de verdad** — comportamiento observado o trazado en el
   código, no supuesto. Si depende de Firestore, de la red o del
   navegador y no se puede ejecutar aquí, se dice explícitamente
   *"trazado en el código, no ejecutado"*.
4. **Por qué la corrección no rompe otra cosa** — quién más llama a lo
   que se está cambiando (`grep` del identificador en todo el proyecto).

Dos trampas específicas de este proyecto, ambas documentadas:

- **Moneda:** ningún importe se convierte. Si una "mejora" implica
  calcular una tasa, reutilizar `price` de un vehículo en USD o mostrar
  un equivalente, está mal: `price` es un índice interno, no un precio.
- **Arranque:** no llamar desde un callback asíncrono de `app.js` a algo
  definido en `auth.js` sin declarar la dependencia con
  `LBBoot.once([...])`. Esa carrera dejó el sitio en "Cargando…" de forma
  permanente una vez ya.

## Fase 3 — Severidad y qué se hace con cada nivel

Se mantiene la nomenclatura que ya usa `RELEASE_NOTES.md`: `C-n`
(crítico), `A-n` (alto), `M-n` (medio), `B-n` (bajo).

| Nivel | Qué es | Qué se hace |
|---|---|---|
| **C** | Rompe una funcionalidad, expone datos, permite escalar privilegios o tumba el sitio | Se corrige en esta misma auditoría, con verificación |
| **A** | Degrada seguridad, rendimiento, SEO o accesibilidad de forma medible, sin romper nada | Se corrige si el cambio es acotado y verificable; si no, se propone con parche listo |
| **M** | Deuda técnica real, inconsistencia, duplicación, riesgo futuro | Se propone con parche. Se aplica solo si es local y sin efectos colaterales |
| **B** | Detalle menor, cosmético, preferencia | Se anota en el informe. **No se toca sin pedirlo** |

Nunca se aplica un cambio de nivel A o superior sin que el informe
explique la causa raíz. Un fix sin explicación es indistinguible de un
parche a ciegas.

## Fase 4 — Verificación antes de entregar

Ningún cambio se entrega sin, como mínimo:

1. `bash tools/verificar.sh` en verde.
2. `node --check` del JS tocado (ya lo cubre el script).
3. Si se tocó `firestore.rules`: razonar las 15 pruebas de
   `firestore_rules_test.js` contra el cambio. Si el emulador está
   disponible, ejecutarlas.
4. Si se tocó `slugify()`: confirmar que las tres copias siguen siendo
   idénticas en comportamiento (`app.js`,
   `scripts/generar-sitemap.js`, `netlify/edge-functions/vehicle-og.js`).
5. Si se tocó un `.js` o `.css` que `index.html` referencia: subir su
   `?v=AAAAMMDD` en `index.html`. Es el único mecanismo que evita que los
   navegadores sirvan la versión vieja.
6. Si se añadió un dominio externo: añadirlo a la CSP de `netlify.toml`,
   o el navegador lo bloqueará en silencio.
7. Si se añadió un archivo interno (no destinado al público): su redirect
   404 con `force = true` en `netlify.toml`.

## Fase 5 — Entrega

1. Rama `auditoria/AAAA-MM-DD`, un commit por hallazgo corregido
   (mensaje: `C-1: qué se corrige y por qué`), nunca un commit
   monolítico: si algo hay que revertir, debe poder revertirse solo.
2. Añadir la entrada a `RELEASE_NOTES.md` **arriba**, con el estilo que
   ya tiene el archivo: causa raíz explicada, no changelog telegráfico.
3. Pull request con el informe como cuerpo:
   - Resumen en 3 líneas: qué se auditó, qué se corrigió, qué queda.
   - Tabla de hallazgos: ID, severidad, archivo:línea, estado.
   - Un bloque por hallazgo corregido: síntoma → causa raíz → corrección
     → cómo se verificó.
   - Hallazgos **no** corregidos, con el motivo y el parche propuesto.
   - Qué no pudo verificarse en este entorno y requiere el navegador o
     la consola de Firebase del propietario.
4. **Nunca push directo a `main`.** El deploy a producción es automático
   con el push a la rama principal: un error sin revisar llega al sitio
   público de inmediato.

## Límites — lo que esta auditoría no hace nunca

- No edita `tailwind.css` (es compilado).
- No convierte monedas ni "mejora" el manejo de `price`.
- No añade dependencias, bundler ni framework. El proyecto es Vanilla
  por decisión, y esa decisión no se revisa en una auditoría.
- No reescribe un archivo completo para corregir tres líneas.
- No desactiva una regla de seguridad, una validación de
  `firestore.rules` o una directiva de la CSP para hacer pasar algo.
- No toca los archivos de las tareas pendientes del propietario (las
  URLs de Pexels del hero, el bootstrap del primer admin): son decisiones
  suyas, documentadas en `README.md`.
