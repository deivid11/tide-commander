#!/usr/bin/env sh
# Build a clean, Chrome-Web-Store-ready zip of the extension.
# manifest.json ends up at the ROOT of the zip (required by the store), and only
# runtime files are included — no README, no icons/generate.py, no OS junk.
set -e
cd "$(dirname "$0")"

VER=$(node -p "require('./manifest.json').version")
OUT="tide-commander-extension-${VER}.zip"

# Exact runtime file whitelist (everything referenced by manifest.json + the
# two HTML entry points). Keeping it explicit means we never ship dev cruft.
FILES="
manifest.json
sidepanel.html
options.html
icons/icon16.png
icons/icon48.png
icons/icon128.png
src/background.js
src/content.js
src/inject.js
src/sidepanel.js
src/sidepanel.css
src/renderers.js
src/renderers.css
src/theme.css
src/options.js
src/options.css
"

# Fail early if any expected file is missing.
for f in $FILES; do
  [ -f "$f" ] || { echo "ERROR: missing $f" >&2; exit 1; }
done

rm -f "$OUT"
# -X strips extra file attributes; keeps the archive deterministic-ish.
zip -X "$OUT" $FILES >/dev/null

echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
echo "--- contents (manifest.json must be at the root) ---"
unzip -l "$OUT"
