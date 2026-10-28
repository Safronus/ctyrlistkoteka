#!/usr/bin/env python3
"""Jednorázová úprava živého Nginx configu: maska /admin odpovídá jako appka.

Proč: dosavadní maska `@admin_notfound` vracela cizím IP natvrdo zapsaných
120 B HTML bez CSP, kdežto skutečná 404 appky je celá stránka s CSP —
/admin tak z venku vyčníval (zjištěno 2026-10-28). Po úpravě jde maskovaný
požadavek do appky stejnou cestou jako libovolná neznámá adresa:

  * stránky (/admin…): proxy s hlavičkou `X-Ctyr-Cloak: 1`; middleware
    appky (src/middleware.ts) je pošle do 404 jako neznámou adresu,
  * API (/api/admin…): `rewrite` na `/api/__cloak<uri>` → catch-all
    src/app/api/[...rest]/route.ts → holé „Not found“ jako pro /api/<cokoli>.

Bloky masky se NEPÍŠOU podle šablony — klonují se z ŽIVÉHO configu:
`@admin_page_cloak` z `location /`, `@admin_api_cloak` z `location /api/`
(když na serveru je), jinak taky z `location /`. Tím maska zdědí přesně ty
rate limity, `proxy_hide_header`, `proxy_pass` a timeouty, jaké má cesta,
kterou napodobuje — jinak by ji prozradila třeba chybějící 429.

Dál: u povolených požadavků se `X-Ctyr-Cloak` vymaže (klient si ji
nepodstrčí) a `return 404` u loopback-only rout se nahradí toutéž maskou
(`return 404` posílá stránku Nginxu, odlišnou od 404 appky).

Proč skript a ne celý soubor: paste 200řádkového configu přes Termius se
2026-08-10 utnul v půlce. Skript nesahá na nic jiného; když config nevypadá
přesně podle očekávání, nic nezmění a řekne proč. Podruhé ohlásí „hotovo“.
Před zápisem si udělá zálohu vedle souboru.

Použití (na VPS, AŽ PO nasazení appky s maskou — commit 5d2909d a novější):
    sudo python3 /var/www/ctyrlistkoteka/deploy/nginx-cloak-app404.py
    sudo nginx -t && sudo systemctl reload nginx

Kontext: docs/deployment.md (tabulka location bloků), docs/gotchas.md #6.
"""

import io
import os
import re
import shutil
import sys
import time

CONF = sys.argv[1] if len(sys.argv) > 1 else "/etc/nginx/sites-available/ctyrlistkoteka"

OLD_TARGET = "@admin_notfound"
PAGE = "@admin_page_cloak"
API = "@admin_api_cloak"


def die(msg):
    sys.exit("CHYBA: " + msg + "\n       Nic jsem nezmenil.")


def block_end(text, open_brace):
    """Index just past the `}` that closes the `{` at `open_brace`.
    Skips `# comments` and quoted strings (the old mask returns HTML)."""
    depth = 0
    i = open_brace
    while i < len(text):
        ch = text[i]
        if ch == "#":
            nl = text.find("\n", i)
            i = len(text) if nl < 0 else nl
            continue
        if ch in "\"'":
            j = i + 1
            while j < len(text) and text[j] != ch:
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    die("neuzavrena slozena zavorka v configu")


def find_block(text, header, required=True):
    """(start, body_start, body_end, end) of the single block whose first
    line is exactly `header` (4-space indent, i.e. directly in server {})."""
    rx = re.compile(r"^    " + re.escape(header) + r"[ \t]*\{", re.M)
    hits = list(rx.finditer(text))
    if not hits and not required:
        return None
    if len(hits) != 1:
        die("blok `%s {` nalezen %dx (cekam presne 1)" % (header, len(hits)))
    m = hits[0]
    end = block_end(text, m.end() - 1)
    return m.start(), m.end(), end - 1, end


def check_clonable(body, header):
    if re.search(r"^\s*location\s", body, re.M):
        die("`%s` obsahuje vnoreny location — klon by nebyl verny" % header)
    if "proxy_set_header" not in body:
        # Pridany proxy_set_header by zrusil zdedene ze server {}.
        die("`%s` nema vlastni proxy_set_header — klon by zmenil hlavicky" % header)
    pp = re.findall(r"^\s*proxy_pass\s+([^;\s]+)\s*;", body, re.M)
    if len(pp) != 1:
        die("`%s` ma %d× proxy_pass (cekam 1)" % (header, len(pp)))
    if not re.match(r"^https?://[^/]+/?$", pp[0]):
        die("`%s`: proxy_pass %s ma cast URI — v named location nejde" % (header, pp[0]))
    if re.search(r"^\s*rewrite\s", body, re.M):
        die("`%s` uz obsahuje rewrite — klon by nebyl verny" % header)


def main():
    if not os.path.exists(CONF):
        die("config %s neexistuje" % CONF)
    text = io.open(CONF, encoding="utf-8").read()

    if PAGE in text or API in text:
        print("Uz hotovo — maska %s/%s uz v configu je. Nic nemenim." % (PAGE, API))
        return
    if OLD_TARGET not in text:
        die("v configu neni %s — nevim, co nahrazuji. Udelej to rucne\n"
            "       podle deploy/nginx.conf.template." % OLD_TARGET)

    # Work inside the ONE server {} that holds the admin (the :80 redirect
    # server has its own `location /`, which must not be touched).
    servers = []
    for m in re.finditer(r"^server[ \t]*\{", text, re.M):
        end = block_end(text, m.end() - 1)
        if re.search(r"^    location /admin[ \t]*\{", text[m.start():end], re.M):
            servers.append((m.start(), end))
    if len(servers) != 1:
        die("server {} s `location /admin` nalezen %dx (cekam 1)" % len(servers))
    s_start, s_end = servers[0]
    whole, text = text, text[s_start:s_end]

    # --- sources to clone, read BEFORE any edit -------------------------
    root = find_block(text, "location /")
    root_body = text[root[1]:root[2]]
    check_clonable(root_body, "location /")
    api_src = find_block(text, "location /api/", required=False)
    api_header = "location /api/" if api_src else "location /"
    api_body = text[api_src[1]:api_src[2]] if api_src else root_body
    if api_src:
        check_clonable(api_body, api_header)

    # --- 1) the two allowlisted blocks ----------------------------------
    for header, target in (("location /admin", PAGE), ("location /api/admin", API)):
        b = find_block(text, header)
        body = text[b[1]:b[2]]
        line = re.compile(r"^([ \t]*)error_page 403 = " + OLD_TARGET + r";[ \t]*$", re.M)
        hits = line.findall(body)
        if len(hits) != 1:
            die("`%s` ma %dx `error_page 403 = %s;` (cekam 1)" % (header, len(hits), OLD_TARGET))
        if "proxy_set_header" not in body:
            die("`%s` nema vlastni proxy_set_header" % header)
        new_body = line.sub(
            lambda m: "%serror_page 403 = %s;\n%s# Hlavicku masky smi nastavit jen Nginx - "
            "u povoleneho pozadavku ji vymaz.\n%sproxy_set_header X-Ctyr-Cloak \"\";"
            % (m.group(1), target, m.group(1), m.group(1)),
            body, count=1)
        text = text[:b[1]] + new_body + text[b[2]:]

    # --- 2) loopback-only routes: same mask instead of Nginx's own 404 ---
    loop = re.compile(
        r"^([ \t]*)location = /api/admin/(drops/sync|revalidate)[ \t]*\{[ \t]*return 404;[ \t]*\}[ \t]*$",
        re.M)
    found = sorted(m.group(2) for m in loop.finditer(text))
    if found != ["drops/sync", "revalidate"]:
        die("`location = /api/admin/{drops/sync,revalidate} { return 404; }` nenalezeny\n"
            "       oba (nalezeno: %s)" % (found or "nic"))
    text = loop.sub(
        lambda m: "%slocation = /api/admin/%s { error_page 403 = %s; return 403; }"
        % (m.group(1), m.group(2), API), text)

    # --- 3) replace the old named location with the two clones ----------
    old = find_block(text, "location " + OLD_TARGET)
    page_block = (
        "    location " + PAGE + " {\n"
        "        # Klon `location /` (rate limit, hlavicky, proxy) + znacka pro\n"
        "        # middleware appky, ktera /admin... posle do 404 jako neznamou\n"
        "        # adresu. Vygeneroval deploy/nginx-cloak-app404.py.\n"
        + root_body.strip("\n").rstrip() + "\n"
        "        proxy_set_header X-Ctyr-Cloak \"1\";\n"
        "    }\n"
    )
    api_block = (
        "\n    location " + API + " {\n"
        "        # Klon `" + api_header + "` + prepis na cestu, kterou nic\n"
        "        # neobsluhuje -> catch-all api/[...rest] -> \"Not found\" jako pro\n"
        "        # /api/<cokoli>. Skutecny admin handler se neda trefit vubec.\n"
        "        rewrite ^ /api/__cloak$uri break;\n"
        + api_body.strip("\n").rstrip() + "\n"
        "    }"
    )
    text = text[:old[0]] + page_block + api_block + text[old[3]:]
    text = whole[:s_start] + text + whole[s_end:]

    backup = "%s.bak-%s" % (CONF, time.strftime("%F-%H%M%S"))
    shutil.copy2(CONF, backup)
    io.open(CONF, "w", encoding="utf-8").write(text)

    print("Zaloha:   %s" % backup)
    print("Stranky:  %s = klon `location /`" % PAGE)
    print("API:      %s = klon `%s` + rewrite /api/__cloak" % (API, api_header))
    print("Hotovo:   /admin a /api/admin -> nova maska, X-Ctyr-Cloak se u povolenych maze,")
    print("          drops/sync + revalidate -> stejna maska misto Nginx 404.")
    print("Ted:      sudo nginx -t && sudo systemctl reload nginx")


if __name__ == "__main__":
    main()
