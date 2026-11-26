#!/bin/bash
# Notify Bing (and other IndexNow engines: Yandex, Seznam, Naver) about changed URLs.
# Usage:
#   _scripts/indexnow.sh                      -> submits every URL from sitemap.xml
#   _scripts/indexnow.sh URL [URL ...]        -> submits only these URLs
# Run AFTER git push, when the pages are already live.
# Key file must stay published at https://focusreps.app/<KEY>.txt
set -euo pipefail
cd "$(dirname "$0")/.."
KEY="0a5bb452d8ff2f831e85d1cdaa32ba97"
HOST="focusreps.app"

if [ "$#" -gt 0 ]; then
  URLS=("$@")
else
  URLS=($(grep -o '<loc>[^<]*</loc>' sitemap.xml | sed -e 's/<loc>//' -e 's/<\/loc>//'))
fi

LIST=$(printf '"%s",' "${URLS[@]}")
LIST="[${LIST%,}]"
BODY="{\"host\":\"$HOST\",\"key\":\"$KEY\",\"keyLocation\":\"https://$HOST/$KEY.txt\",\"urlList\":$LIST}"

echo "Submitting ${#URLS[@]} URL(s) to IndexNow..."
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" -d "$BODY")
echo "HTTP $CODE  (200/202 = accepted, 403 = key file not found, 422 = URL not on host)"
