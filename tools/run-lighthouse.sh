#!/usr/bin/env bash
# Reproduce the Lighthouse scores recorded in HANDOFF.md.
#
#   bash tools/run-lighthouse.sh
#
# Serves the repo locally and audits it as a mobile device. Requires
# lighthouse (npm i -g lighthouse) and a Chromium binary.
#
# NOTE: a plain local file server sends no compression or cache headers, so
# "document-latency" scores badly here and does NOT reflect GitHub Pages,
# which gzips and sets caching. Everything else is representative.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8788
: "${CHROME_PATH:=$(command -v google-chrome || command -v chromium || echo /opt/pw-browsers/chromium-1194/chrome-linux/chrome)}"
export CHROME_PATH

python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2

lighthouse "http://localhost:$PORT/index.html" \
  --quiet --output=json --output-path=/tmp/flyersnap-lighthouse.json \
  --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu" \
  --only-categories=performance,accessibility,best-practices,seo \
  --form-factor=mobile --screenEmulation.mobile

python3 - <<'PY'
import json
d = json.load(open('/tmp/flyersnap-lighthouse.json'))
print()
for v in d['categories'].values():
    print(f"  {v['title']:16} {round(v['score']*100)}")
print()
fails = [(r['id'], d['audits'][r['id']]['score'])
         for c in d['categories'].values() for r in c['auditRefs']
         if d['audits'][r['id']].get('score') is not None
         and d['audits'][r['id']]['score'] < 1]
if fails:
    print('  below 100:')
    for i, s in fails:
        print(f'    {s:.2f}  {i}')
PY
