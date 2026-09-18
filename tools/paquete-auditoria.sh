#!/usr/bin/env bash
# ============================================================
# tools/paquete-auditoria.sh — Empaquetar contexto para auditar
#                              desde el chat de Claude
# ------------------------------------------------------------
# CUÁNDO USAR ESTO
#
# Solo cuando NO se audita con Claude Code sobre el repositorio (que es
# la vía normal: ahí Claude lee los archivos que necesita y no hace
# falta empaquetar nada). Este script es para el caso de pegar o subir
# el contexto en el chat de claude.ai — por ejemplo desde el móvil, o
# para una segunda opinión sin abrir una sesión sobre el repositorio.
#
# POR QUÉ POR ÁREAS Y NO TODO JUNTO
#
# El código fuente completo son ~800 KB (app.js solo, 170 KB). Volcarlo
# entero en una conversación consume la ventana de contexto en el
# material y deja poco para el análisis: se obtiene una lectura
# superficial de todo. Cada área cabe con holgura y se analiza a fondo.
# Es la misma rotación que usa la auditoría semanal.
#
# USO
#   bash tools/paquete-auditoria.sh seguridad
#   bash tools/paquete-auditoria.sh rendimiento | seo | codigo | diff
#
# El archivo resultante se sube al chat como adjunto (no pegado en el
# mensaje: como adjunto se maneja mejor y no se trunca).
# ============================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITIO="$RAIZ/LaBatallaAutoImport-StarblexFrontend-Reemplazo"
AREA="${1:-}"
FECHA="$(date -u '+%Y-%m-%d')"

case "$AREA" in
  seguridad)
    ARCHIVOS="firestore.rules firestore_rules_test.js auth.js roles.js netlify/functions/enviar-cotizacion.js netlify/edge-functions/vehicle-og.js cloudinary-sign-worker.js netlify.toml" ;;
  rendimiento)
    ARCHIVOS="index.html netlify.toml boot.js hero-carousel.js media-model.js analytics.js" ;;
  seo)
    ARCHIVOS="index.html sitemap.xml robots.txt site.webmanifest netlify/edge-functions/vehicle-og.js scripts/generar-sitemap.js empresa/quienes-somos.html empresa/por-que-elegirnos.html empresa/mision-vision.html empresa/nuestros-valores.html" ;;
  codigo)
    ARCHIVOS="app.js dashboard.js calculadora.js media-upload.js media-model.js auth-ui.js invite-modal.js" ;;
  diff)
    ARCHIVOS="" ;;
  *)
    cat <<'AYUDA'
Uso: bash tools/paquete-auditoria.sh <area>

  seguridad     firestore.rules, auth, roles, funciones de servidor, CSP
  rendimiento   index.html, caché, arranque, carrusel
  seo           meta/JSON-LD, sitemap, robots, páginas de empresa
  codigo        app.js, dashboard, calculadora, medios
  diff          solo lo que cambió en los últimos 8 días

El área rota cada semana (ver .claude/skills/auditoria-semanal/SKILL.md).
AYUDA
    exit 1 ;;
esac

SALIDA="$RAIZ/auditoria-$AREA-$FECHA.txt"
cd "$SITIO"

{
  echo "════════════════════════════════════════════════════════════"
  echo " AUDITORÍA — La Batalla Auto Import"
  echo " Área: $AREA        Fecha: $FECHA"
  echo " Commit: $(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo " Rama:   $(git -C "$RAIZ" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  echo "════════════════════════════════════════════════════════════"
  echo
  echo "CÓMO USAR ESTE ARCHIVO"
  echo
  echo "Súbelo como adjunto y pide la auditoría del área indicada"
  echo "siguiendo el protocolo de .claude/skills/auditoria-semanal/."
  echo "Reglas que no se negocian: cada hallazgo se demuestra (archivo,"
  echo "línea, cómo se dispara) antes de reportarse; no se convierten"
  echo "monedas; no se reescriben archivos completos para cambiar tres"
  echo "líneas; '0 hallazgos, verificado' es una respuesta válida."
  echo
  echo "────────────────────────────────────────────────────────────"
  echo " 1. VERIFICACIÓN DETERMINISTA (tools/verificar.sh)"
  echo "────────────────────────────────────────────────────────────"
  bash "$RAIZ/tools/verificar.sh" 2>&1 || true
  echo
  echo "────────────────────────────────────────────────────────────"
  echo " 2. CAMBIOS DE LOS ÚLTIMOS 8 DÍAS"
  echo "────────────────────────────────────────────────────────────"
  git -C "$RAIZ" log --since="8 days ago" --pretty='%h %ad %s' --date=short 2>/dev/null || echo "(sin historial)"
  echo
  git -C "$RAIZ" diff --stat "HEAD@{8 days ago}" HEAD 2>/dev/null || echo "(sin diff disponible)"
  echo
  echo "────────────────────────────────────────────────────────────"
  echo " 3. REGLAS DE SINCRONIZACIÓN CRÍTICA (README.md)"
  echo "────────────────────────────────────────────────────────────"
  sed -n '/^## Reglas de sincronización crítica/,/^## Tareas pendientes/p' README.md
  echo

  if [ "$AREA" = "diff" ]; then
    echo "────────────────────────────────────────────────────────────"
    echo " 4. DIFF COMPLETO DE LOS ÚLTIMOS 8 DÍAS"
    echo "────────────────────────────────────────────────────────────"
    git -C "$RAIZ" diff "HEAD@{8 days ago}" HEAD 2>/dev/null || echo "(sin diff disponible)"
  else
    echo "────────────────────────────────────────────────────────────"
    echo " 4. ARCHIVOS DEL ÁREA"
    echo "────────────────────────────────────────────────────────────"
    for f in $ARCHIVOS; do
      if [ ! -f "$f" ]; then
        echo "=== ARCHIVO NO ENCONTRADO: $f ==="
        continue
      fi
      echo
      echo "=== ARCHIVO: $f ($(wc -l < "$f") líneas, $(wc -c < "$f") bytes) ==="
      cat -n "$f"
    done
  fi
} > "$SALIDA"

BYTES=$(wc -c < "$SALIDA")
printf 'Paquete creado: %s\n' "$SALIDA"
printf '  %s KB · %s líneas · ~%s mil tokens aprox.\n' \
  "$((BYTES / 1024))" "$(wc -l < "$SALIDA")" "$((BYTES / 4000))"
printf '  Súbelo como ADJUNTO al chat (no pegado en el mensaje).\n'
