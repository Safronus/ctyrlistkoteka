#!/usr/bin/env python3
"""Jednorázová úprava živého Nginx configu: dostat /api/admin za masku adminu.

Proč skript a ne „vlož si nový soubor“: celý config má přes 200 řádků a
paste přes Termius se 2026-08-10 utnul v půlce (`nginx -t` pak hlásil
"unexpected end of file"). Tohle je krátké, ověřitelné a nesahá na nic
jiného — všechny ostatní odchylky živého configu od šablony zůstanou
byte za bytem stejné.

Dělá tři věci:
  1. v `location /admin` nahradí řádky allow…/deny all jedním `include`
     snippetu (aby ho mohly sdílet dva bloky a nemohly se rozejít),
  2. přidá `location /api/admin` se stejným snippetem,
  3. přidá `location =` s natvrdo `return 404` pro `drops/sync`
     a `revalidate` — ty volá jen tenhle stroj přes loopback.

Spustí se jednou; podruhé sám oznámí, že je hotovo, a nic nezmění.
Před zápisem si udělá vlastní zálohu vedle souboru.

Použití (na VPS):
    sudo python3 /var/www/ctyrlistkoteka/deploy/nginx-add-api-admin.py
    sudo nginx -t && sudo systemctl reload nginx

Kontext: docs/deployment.md §8, docs/admin-overview.md (gotcha
„/api/admin/* je mimo masku“).
"""

import io
import os
import re
import shutil
import sys
import time

CONF = sys.argv[1] if len(sys.argv) > 1 else "/etc/nginx/sites-available/ctyrlistkoteka"
SNIPPET = "/etc/nginx/snippets/admin-allowlist.conf"
SNIPPET_DIR = os.path.dirname(SNIPPET)

NEW_BLOCKS = """
    # -----------------------------------------------------------------
    # /api/admin/* — patri k adminu, ale maska vys na ne NESEDI:
    # `location /admin` je prefix a `/api/admin/...` jim nezacina. Sest
    # rout proto viselo na internetu (branily se samy — 404 pro
    # neautentizovaneho — ale existovaly a daly se zkouset).
    #
    # Vola je prohlizec prihlaseneho admina: file (nahledy souboru),
    # blocklist/export (odkazy ke stazeni v auditu), sync/start
    # a sync/status. Ten chodi z povolene IP, jinak by se do adminu vubec
    # nedostal — allowlist ho tedy nemuze prekvapit.
    #
    # Tentyz snippet jako /admin vys. Schvalne: dve rucne udrzovane kopie
    # by se drive nebo pozdeji rozesly a admin by pak pul na pul vracel
    # maskovanou 404 bez vysvetleni.
    # -----------------------------------------------------------------
    location /api/admin {
        include /etc/nginx/snippets/admin-allowlist.conf;
        error_page 403 = @admin_notfound;

        proxy_hide_header X-Content-Type-Options;
        proxy_hide_header X-Frame-Options;

        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;

        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # /api/admin/file streamuje soubory ven; at se dlouhy prenos
        # neutne na vychozich 60 s mezi ctenimi.
        proxy_read_timeout 300s;
    }

    # Dve routy pod /api/admin, ktere vola VYHRADNE tenhle stroj sam pres
    # loopback: drops/sync (systemd timer drop-sheet-sync.timer)
    # a revalidate (sync CLI, src/lib/revalidatePing.ts). Loopback miri na
    # 127.0.0.1:3000 primo a Nginxem neprochazi, takze tudy nema dorazit
    # ani jedno volani — a co nema dorazit, at neexistuje.
    #
    # `location =` je presna shoda a ma v Nginxu nejvyssi prioritu, takze
    # tyhle dva radky vyhraji nad allowlistem vys bez ohledu na poradi.
    # Nemaz je v domneni, ze jsou nadbytecne vedle allowlistu: allowlist
    # pousti tvoji domaci IP, tohle nepousti nikoho.
    location = /api/admin/drops/sync { return 404; }
    location = /api/admin/revalidate { return 404; }
"""

ANCHOR = "        client_max_body_size 200M;\n    }\n"
ALLOW_RE = re.compile(
    r"(location /admin \{[ \t]*\n)((?:[ \t]*allow [^\n]*\n)+[ \t]*deny all;[ \t]*\n)"
)


def die(msg):
    sys.exit("CHYBA: " + msg)


def main():
    if not os.path.exists(CONF):
        die("config %s neexistuje" % CONF)

    text = io.open(CONF, encoding="utf-8").read()

    if "/api/admin" in text:
        print("Uz hotovo — /api/admin uz v configu je. Nic nemenim.")
        return

    match = ALLOW_RE.search(text)
    if not match:
        die(
            "v `location /admin` nenalezen blok allow…/deny all. Config uz nekdo\n"
            "       upravil jinak — udelej to rucne podle deploy/nginx.conf.template."
        )

    # Snippet MUSI existovat a MUSI koncit `deny all` drive, nez se na nej
    # `location /admin` prepne. Jinak by po reloadu zustal admin bez
    # jakehokoli omezeni — prazdny include je v Nginxu platny a tise
    # pousti vsechny. Kdyz snippet chybi, vyrobime ho z toho, co v configu
    # ted opravdu je; jeho obsah pak vypiseme k odsouhlaseni.
    if not os.path.exists(SNIPPET):
        if not os.path.isdir(SNIPPET_DIR):
            os.makedirs(SNIPPET_DIR)
        rules = "".join(
            line.strip() + "\n" for line in match.group(2).strip().splitlines()
        )
        io.open(SNIPPET, "w", encoding="utf-8").write(
            "# Allowlist pro /admin i /api/admin. Do gitu NEPATRI (repo je verejne).\n"
            "# Vygeneroval deploy/nginx-add-api-admin.py z puvodniho location /admin.\n"
            + rules
        )
        print("Vytvoren %s:" % SNIPPET)
        print("".join("    " + r for r in rules.splitlines(True)))

    snippet_text = io.open(SNIPPET, encoding="utf-8").read()
    if "deny all;" not in snippet_text:
        die(
            "%s neobsahuje `deny all;`. Bez nej by se admin po reloadu otevrel\n"
            "       uplne vsem — koncim a nic nemenim." % SNIPPET
        )
    if not re.search(r"^\s*allow\s", snippet_text, re.M):
        die(
            "%s neobsahuje zadny `allow`. Zamkl by ses ven z adminu — koncim." % SNIPPET
        )

    if text.count(ANCHOR) != 1:
        die(
            "kotva `client_max_body_size 200M;` + konec bloku nenalezena prave\n"
            "       jednou (%d×). Udelej to rucne." % text.count(ANCHOR)
        )

    backup = "%s.bak-%s" % (CONF, time.strftime("%F-%H%M%S"))
    shutil.copy2(CONF, backup)

    text = ALLOW_RE.sub(
        r"\1        include /etc/nginx/snippets/admin-allowlist.conf;\n", text, count=1
    )
    text = text.replace(ANCHOR, ANCHOR + NEW_BLOCKS, 1)
    io.open(CONF, "w", encoding="utf-8").write(text)

    print("Zaloha:  %s" % backup)
    print("Hotovo:  allowlist -> snippet, /api/admin pridan, 2x return 404 pridan.")
    print("Ted:     sudo nginx -t && sudo systemctl reload nginx")


if __name__ == "__main__":
    main()
