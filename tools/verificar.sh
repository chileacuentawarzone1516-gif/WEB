#!/usr/bin/env bash
# ============================================================
# tools/verificar.sh — Verificación determinista del sitio
# ------------------------------------------------------------
# QUÉ ES Y QUÉ NO ES
#
# Esta es la capa BARATA Y OBJETIVA de la rutina de calidad: comprueba
# invariantes que se pueden decidir con certeza leyendo el repositorio,
# sin criterio humano y sin modelo de lenguaje. Corre en segundos, en
# cada push, y no tiene falsos positivos: si falla, algo está roto.
#
# NO sustituye a la auditoría semanal con Claude (.claude/skills/
# auditoria-semanal/). Esa juzga lo que requiere criterio —arquitectura,
# UX, redacción SEO, si una regla de Firestore es demasiado permisiva—.
# Las dos capas son complementarias: esta evita que una regresión obvia
# llegue a producción entre auditorías.
#
# POR QUÉ LOS CHECKS SON ESTOS Y NO OTROS
#
# Cada comprobación corresponde a una regla que el proyecto YA declara
# en README.md ("Reglas de sincronización crítica", "Versionado de
# caché") o a un defecto que ya ocurrió de verdad y está documentado en
# RELEASE_NOTES.md. No se inventan reglas nuevas: se automatiza la
# vigilancia de las que ya existen y que hoy dependen de que alguien se
# acuerde de revisarlas a mano.
#
# USO
#   bash tools/verificar.sh          # desde la raíz del repositorio
#   bash tools/verificar.sh --lista  # solo enumera los checks
#
# SALIDA
#   0 = sin errores (puede haber avisos)
#   1 = al menos un ERROR: hay algo roto que no debe desplegarse
# ============================================================
set -uo pipefail

# El sitio vive en una subcarpeta (Netlify tiene ahí su Base directory).
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITIO="$RAIZ/LaBatallaAutoImport-StarblexFrontend-Reemplazo"
DOMINIO="https://labatallaautoimport.netlify.app"

ERRORES=0
AVISOS=0

# Colores solo si la salida es un terminal (en CI se ven como basura).
if [ -t 1 ]; then
  ROJO=$'\033[31m'; VERDE=$'\033[32m'; AMBAR=$'\033[33m'; GRIS=$'\033[90m'; FIN=$'\033[0m'
else
  ROJO=''; VERDE=''; AMBAR=''; GRIS=''; FIN=''
fi

titulo()  { printf '\n%s──%s %s\n' "$GRIS" "$FIN" "$1"; }
ok()      { printf '   %sOK%s    %s\n' "$VERDE" "$FIN" "$1"; }
error()   { printf '   %sERROR%s %s\n' "$ROJO" "$FIN" "$1"; ERRORES=$((ERRORES+1)); }
aviso()   { printf '   %sAVISO%s %s\n' "$AMBAR" "$FIN" "$1"; AVISOS=$((AVISOS+1)); }

if [ "${1:-}" = "--lista" ]; then
  grep -oE '^check_[a-z_]+\(\)' "${BASH_SOURCE[0]}" | tr -d '()' | sed 's/^check_/  · /'
  exit 0
fi

if [ ! -d "$SITIO" ]; then
  printf '%sERROR%s No se encuentra %s\n' "$ROJO" "$FIN" "$SITIO"
  exit 1
fi
cd "$SITIO"

# ------------------------------------------------------------
# 1. Sintaxis de todo el JavaScript
#
# `node --check` parsea el archivo sin ejecutarlo. Los módulos ES con
# `import` en archivos .js no los acepta como CommonJS en todas las
# versiones de Node, así que se reintenta por stdin declarando el tipo:
# si cualquiera de las dos formas parsea, el archivo es válido.
# ------------------------------------------------------------
check_sintaxis_js() {
  titulo "Sintaxis de JavaScript"
  local f roto=0
  while IFS= read -r f; do
    if node --check "$f" >/dev/null 2>&1; then continue; fi
    if node --input-type=module --check < "$f" >/dev/null 2>&1; then continue; fi
    error "sintaxis inválida: $f"
    node --check "$f" 2>&1 | head -5 | sed 's/^/         /'
    roto=1
  done < <(find . -name '*.js' -not -path './node_modules/*' | sort)
  [ "$roto" -eq 0 ] && ok "$(find . -name '*.js' -not -path './node_modules/*' | wc -l) archivos parsean correctamente"
}

# ------------------------------------------------------------
# 2. Referencias locales rotas en el HTML
#
# Un src/href a un archivo propio que no existe da 404 en producción y
# no lo detecta ningún otro control: el sitio no tiene build que falle.
# ------------------------------------------------------------
check_referencias_locales() {
  titulo "Referencias locales en el HTML"
  local html ref ruta roto=0 total=0
  while IFS= read -r html; do
    while IFS= read -r ref; do
      case "$ref" in http*|//*|data:*|'#'*|mailto:*|tel:*) continue ;; esac
      ruta="${ref%%\?*}"; ruta="${ruta%%#*}"; ruta="${ruta#/}"
      [ -z "$ruta" ] && continue
      total=$((total+1))
      if [ ! -f "$ruta" ]; then
        error "$html referencia un archivo que no existe: $ref"
        roto=1
      fi
    done < <(grep -oE '(src|href)="[^"]*\.(js|css|png|jpg|jpeg|webp|svg|ico|webmanifest)(\?[^"]*)?"' "$html" \
             | sed -E 's/^(src|href)="//; s/"$//' | sort -u)
  done < <(find . -name '*.html' -not -path './node_modules/*' | sort)
  [ "$roto" -eq 0 ] && ok "$total referencias locales resuelven a un archivo existente"
}

# ------------------------------------------------------------
# 3. Versionado de caché (?v=) — regla documentada en README.md
#
# netlify.toml sirve el JS/CSS propio con `max-age=3600`. El `?v=` del
# HTML es lo único que fuerza a los navegadores a traer la versión
# nueva de inmediato tras un deploy. Un archivo local sin `?v=` queda
# fuera de ese mecanismo.
# ------------------------------------------------------------
check_versionado_cache() {
  titulo "Versionado de caché (?v=) en index.html"
  local ref sin=0 con=0
  while IFS= read -r ref; do
    case "$ref" in http*|//*) continue ;; esac
    if printf '%s' "$ref" | grep -qE '\?v=[0-9]{8}[a-z0-9]*$'; then
      con=$((con+1))
    else
      error "sin ?v= (o con formato distinto de AAAAMMDD): $ref"
      sin=1
    fi
  done < <(grep -oE '(src|href)="/[^"]*\.(js|css)(\?[^"]*)?"' index.html \
           | sed -E 's/^(src|href)="//; s/"$//' | sort -u)
  [ "$sin" -eq 0 ] && ok "$con recursos propios llevan ?v=AAAAMMDD"
}

# ------------------------------------------------------------
# 4. sitemap.xml
#
# Lo regenera el build de Netlify desde Firestore; si ese paso falla se
# publica la copia del repositorio, así que esa copia debe ser válida.
# ------------------------------------------------------------
check_sitemap() {
  titulo "sitemap.xml y robots.txt"
  if [ ! -f sitemap.xml ]; then error "falta sitemap.xml"; return; fi
  grep -q '<?xml' sitemap.xml            || error "sitemap.xml sin declaración XML"
  grep -q '<urlset'  sitemap.xml          || error "sitemap.xml sin <urlset>"
  grep -q '</urlset>' sitemap.xml         || error "sitemap.xml no cierra <urlset> (¿truncado?)"
  local abre cierra locs ajenas
  abre=$(grep -c '<url>' sitemap.xml);  cierra=$(grep -c '</url>' sitemap.xml)
  [ "$abre" = "$cierra" ] || error "sitemap.xml: $abre <url> frente a $cierra </url>"
  locs=$(grep -c '<loc>' sitemap.xml)
  ajenas=$(grep -o '<loc>[^<]*</loc>' sitemap.xml | grep -vc "$DOMINIO" || true)
  [ "$ajenas" = "0" ] || error "sitemap.xml: $ajenas <loc> no apuntan a $DOMINIO"
  [ "$locs" -gt 0 ] && ok "sitemap.xml válido con $locs URLs"
  if [ -f robots.txt ]; then
    grep -q "Sitemap:" robots.txt && ok "robots.txt declara el Sitemap" \
                                  || aviso "robots.txt no declara la línea Sitemap:"
  else
    error "falta robots.txt"
  fi
}

# ------------------------------------------------------------
# 5. Archivos internos que no deben servirse
#
# `publish = "."` publica TODA la carpeta. Cada archivo interno nuevo
# necesita su redirect 404 con force=true en netlify.toml, o queda
# descargable. Este check es el que detecta el olvido al añadir uno.
# ------------------------------------------------------------
check_archivos_internos() {
  titulo "Archivos internos no servidos (netlify.toml)"
  local f expuesto=0 protegidos=0
  while IFS= read -r f; do
    if grep -q "from = \"/$f\"" netlify.toml; then
      protegidos=$((protegidos+1))
    else
      error "$f se publicaría: falta su redirect 404 (force = true) en netlify.toml"
      expuesto=1
    fi
  done < <(find . -maxdepth 1 -type f \
             \( -name '*.md' -o -name '*.rules' -o -name 'firebase.json' \
                -o -name 'firestore_rules_test.js' -o -name 'cloudinary-sign-worker.js' \) \
           | sed 's|^\./||' | sort)
  grep -q 'from = "/netlify/\*"' netlify.toml \
    || error 'el árbol /netlify/* se publicaría: falta su redirect 404 en netlify.toml'
  [ "$expuesto" -eq 0 ] && ok "$protegidos archivos internos + /netlify/* devuelven 404"
}

# ------------------------------------------------------------
# 6. Roles: roles.js ↔ firestore.rules
#
# README.md lo declara explícitamente: la autorización de la UI
# (ROLE_PERMISSIONS en roles.js) y la real (firestore.rules) deben
# hablar de los mismos roles. Un rol que exista solo en un lado es una
# puerta abierta o un botón que no funciona.
# ------------------------------------------------------------
check_roles_coherentes() {
  titulo "Coherencia de roles (roles.js ↔ firestore.rules)"
  local rol desajuste=0
  while IFS= read -r rol; do
    if ! grep -qE "['\"]$rol['\"]" firestore.rules; then
      error "el rol '$rol' existe en roles.js pero no aparece en firestore.rules"
      desajuste=1
    fi
  done < <(grep -oE "^\s+[A-Z]+: '[a-z]+'" roles.js | grep -oE "'[a-z]+'" | tr -d "'" | sort -u)
  [ "$desajuste" -eq 0 ] && ok "los roles de roles.js están todos contemplados en firestore.rules"
}

# ------------------------------------------------------------
# 7. slugify() triplicado — regla documentada en README.md
#
# La misma función vive en tres entornos que no comparten scope
# (navegador, Node del build, Deno de la Edge Function). Si una se
# desincroniza, la URL que genera el sitio deja de ser la que resuelve
# la Edge Function y la ficha del vehículo da 404.
# ------------------------------------------------------------
check_slugify_sincronizado() {
  titulo "slugify() en los tres entornos"
  local f falta=0
  for f in app.js scripts/generar-sitemap.js netlify/edge-functions/vehicle-og.js; do
    if ! grep -q 'slugify' "$f" 2>/dev/null; then
      error "slugify() no aparece en $f (README lo exige en los tres)"
      falta=1
    fi
  done
  [ "$falta" -eq 0 ] && ok "las tres copias de slugify() siguen presentes"
}

# ------------------------------------------------------------
# 8. CSP: no reintroducir 'unsafe-inline' en script-src
#
# Retirarlo costó extraer todo el JS embebido a iconos.js y
# analytics.js. Volver a añadirlo (o meter un handler inline que lo
# "obligue") desharía esa migración sin que nadie lo note hasta que un
# navegador bloquee algo en silencio.
# ------------------------------------------------------------
check_csp_script_src() {
  titulo "CSP — script-src sin 'unsafe-inline'"
  # Se lee SOLO el valor de la directiva real. netlify.toml documenta su
  # propia historia en comentarios y ahí aparece el texto literal
  # "script-src 'unsafe-inline'" explicando que se retiró: un grep suelto
  # sobre el archivo lo confundiría con la política vigente.
  local politica script_src
  politica=$(grep -E '^\s*Content-Security-Policy\s*=' netlify.toml | head -1 || true)
  if [ -z "$politica" ]; then
    error "netlify.toml no declara Content-Security-Policy"
    return
  fi
  script_src=$(printf '%s' "$politica" | grep -oE "script-src[^;\"]*" || true)
  if [ -z "$script_src" ]; then
    error "la Content-Security-Policy de netlify.toml no declara script-src"
    return
  fi
  if printf '%s' "$script_src" | grep -q "unsafe-inline"; then
    error "script-src volvió a incluir 'unsafe-inline' — regresión de seguridad"
  else
    ok "script-src no permite código inline"
  fi
  printf '%s' "$script_src" | grep -q "unsafe-eval" \
    && error "script-src incluye 'unsafe-eval'" \
    || ok "script-src no permite eval"
}

# ------------------------------------------------------------
# 9. Handlers inline en el HTML
#
# Con la CSP actual, un onclick="" en el HTML no se ejecuta: el
# navegador lo bloquea y el botón queda muerto sin error visible. Es
# exactamente el defecto documentado en RELEASE_NOTES.md.
# ------------------------------------------------------------
check_handlers_inline() {
  titulo "Handlers inline en el HTML (los bloquea la CSP)"
  local html encontrados=0
  while IFS= read -r html; do
    if grep -nE '<[^>]+\son(click|error|load|change|submit|input|focus|blur)=' "$html" >/dev/null 2>&1; then
      error "$html usa handlers inline; la CSP los bloqueará:"
      grep -nE '<[^>]+\son(click|error|load|change|submit|input|focus|blur)=' "$html" \
        | head -3 | cut -c1-120 | sed 's/^/         /'
      encontrados=1
    fi
  done < <(find . -name '*.html' -not -path './node_modules/*' | sort)
  [ "$encontrados" -eq 0 ] && ok "ningún HTML usa handlers inline"
}

# ------------------------------------------------------------
# 10. Secretos en el código
#
# La apiKey de Firebase Web (AIza…) NO es un secreto: el cliente la
# necesita y su seguridad recae en firestore.rules y App Check. Por eso
# se excluye a propósito y no se busca. Lo que sí sería una filtración
# real: la clave de Resend, claves privadas o tokens de servicio.
# ------------------------------------------------------------
check_secretos() {
  titulo "Secretos en el código"
  local hallazgos
  hallazgos=$(grep -rnE "re_[A-Za-z0-9]{16,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|sk_live_[A-Za-z0-9]{10,}|ghp_[A-Za-z0-9]{20,}|api\.netlify\.com/build_hooks/[A-Za-z0-9]{10,}" \
      --include='*.js' --include='*.html' --include='*.toml' --include='*.json' --include='*.rules' . 2>/dev/null \
      | grep -v 'tools/verificar.sh' || true)
  if [ -n "$hallazgos" ]; then
    error "posible credencial en el repositorio:"
    printf '%s\n' "$hallazgos" | head -5 | cut -c1-140 | sed 's/^/         /'
  else
    ok "sin claves de Resend, claves privadas, tokens ni Build Hooks en el código"
  fi
  grep -q 'COTIZACION_EMAIL_TO' netlify/functions/enviar-cotizacion.js 2>/dev/null \
    && ok "enviar-cotizacion lee el destinatario de variable de entorno, no de la petición" \
    || aviso "revisar cómo obtiene enviar-cotizacion.js el destinatario"
}

printf '%s\n' "════════════════════════════════════════════════════════"
printf ' Verificación determinista — La Batalla Auto Import\n'
printf ' %s\n' "$(date -u '+%Y-%m-%d %H:%M UTC')"
printf '%s\n' "════════════════════════════════════════════════════════"

check_sintaxis_js
check_referencias_locales
check_versionado_cache
check_sitemap
check_archivos_internos
check_roles_coherentes
check_slugify_sincronizado
check_csp_script_src
check_handlers_inline
check_secretos

printf '\n%s\n' "════════════════════════════════════════════════════════"
if [ "$ERRORES" -eq 0 ]; then
  printf ' %sTodo en verde%s — %s aviso(s)\n' "$VERDE" "$FIN" "$AVISOS"
  printf '%s\n' "════════════════════════════════════════════════════════"
  exit 0
fi
printf ' %s%s error(es)%s y %s aviso(s)\n' "$ROJO" "$ERRORES" "$FIN" "$AVISOS"
printf '%s\n' "════════════════════════════════════════════════════════"
exit 1
