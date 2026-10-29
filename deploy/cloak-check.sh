#!/bin/bash
# Is the /admin cloak indistinguishable from a real 404?
#
#   bash deploy/cloak-check.sh [https://ctyrlistkoteka.cz]
#
# Run it from a machine that is NOT on the admin allowlist (the VPS itself
# usually isn't; the home connection is). It compares what that machine
# gets for admin URLs with what it gets for unknown URLs of the same length.
# Expected after deploy/nginx-cloak-app404.py: every line ✅ — the only
# difference left is the path itself. Read-only: GET/POST, nothing changes.
set -u
B=${1:-https://ctyrlistkoteka.cz}
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT

first=$(curl -s -o /dev/null -w '%{http_code}' "$B/admin")
if [ "$first" != "404" ]; then
  echo "⚠️  $B/admin vrátil $first, ne 404 — tenhle stroj je nejspíš na allowlistu."
  echo "    Test tu nemá smysl; spusť ho z jiné IP (VPS, mobilní data)."
  exit 2
fi

check() { # label method genuine-path masked-path
  curl -s -X "$2" -D "$D/gh" -o "$D/gb" "$B$3"; curl -s -X "$2" -D "$D/mh" -o "$D/mb" "$B$4"
  python3 - "$D" "$3" "$4" "$1" <<'PY'
import sys,re,difflib
d,g,m,label=sys.argv[1:5]
def n(s):
    s=re.sub(r'nonce-[A-Za-z0-9+/=]+','nonce-X',s); s=re.sub(r'nonce="[^"]+"','nonce="X"',s)
    # The 404 page draws its game („Louka“/„Lupa“) at random per request,
    # for every 404 alike — two samples can legitimately differ in it.
    s=re.sub(r'\b(meadow|lens)\b','GAME',s)
    return re.sub(r'nonce\\":\\"[^\\]+','nonce\\":\\"X',s)
rd=lambda f: n(open(d+'/'+f,encoding='utf-8',errors='replace').read())
tok=lambda s: re.findall(r'[A-Za-z0-9_\-]+|[^A-Za-z0-9_\-]',s)
gs,ms=g.strip('/').split('/'),m.strip('/').split('/')
pairs={(a,b) for a,b in zip(gs,ms) if a!=b}
a,b=tok(rd('gb')),tok(rd('mb'))
body=[(''.join(a[i:j]),''.join(b[k:l])) for op,i,j,k,l in difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes() if op!='equal']
H=lambda f: sorted(x for x in rd(f).replace('\r','').split('\n') if x and not re.match(r'(?i)(date|content-length|connection|keep-alive):',x))
ha,hb=H('gh'),H('mh')
def same_but_path(x,y):
    for p,q in pairs: x=x.replace(p,q)
    return x==y
ok=all(p in pairs for p in body) and len(ha)==len(hb) and all(same_but_path(x,y) for x,y in zip(ha,hb))
status=next((x.split()[1] for x in ha if x.startswith('HTTP')),'?')
print(("✅ " if ok else "❌ ")+label+"  ("+status+")")
if not ok:
    print("   body:", [p for p in body if p not in pairs][:6])
    print("   headers:", [(x,y) for x,y in zip(ha,hb) if not same_but_path(x,y)][:6] or (len(ha),len(hb)))
PY
}
check "stránka /admin"               GET  /qqqqq                 /admin
check "stránka /admin/login"         GET  /qqqqq/login           /admin/login
check "API GET /api/admin/file"      GET  /api/qqqqq/file        /api/admin/file
check "API POST /api/admin/sync/start" POST /api/qqqqq/sync/start /api/admin/sync/start
check "API /api/admin/revalidate"    POST /api/qqqqq/revalidate  /api/admin/revalidate
check "API /api/admin/drops/sync"    POST /api/qqqqq/drops/sync  /api/admin/drops/sync
