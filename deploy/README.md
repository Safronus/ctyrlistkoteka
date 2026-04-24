# Deploy — soubory a pořadí

Tato složka obsahuje **artefakty pro produkci**. Narativní postup je
v [`docs/deployment.md`](../docs/deployment.md) — tam je to vysvětleno
krok za krokem. Tento README je rychlý katalog.

| Soubor | Umístění na VPS | Kdy použít |
| --- | --- | --- |
| `ecosystem.config.cjs` | `/var/www/ctyrlistkoteka/deploy/` (git) | PM2 config. Použije `pm2 start` během první instalace a poté `pm2 reload` po každém deployi. |
| `nginx.conf.template` | `/etc/nginx/sites-available/ctyrlistkoteka` | Kopie při inicializaci. Potom `sudo nginx -t && sudo systemctl reload nginx`. |
| `systemd-sync.service` | `/etc/systemd/system/` | Volitelné: noční auto-sync. |
| `systemd-sync.timer` | `/etc/systemd/system/` | Zapnout přes `systemctl enable --now ctyrlistkoteka-sync.timer`. |
| `backup.sh` | (git, spouští se odtud) | Denní `pg_dump` + rotace. Do crontab uživatele `app`. |

Spárované s:
- `.github/workflows/deploy.yml` — GitHub Actions CI/CD
- `src/app/sitemap.ts`, `src/app/robots.ts` — SEO
- `prisma/migrations/` — aplikují se na VPS přes `pnpm prisma migrate deploy`

## První nasazení — checklist

Následuj [`docs/deployment.md`](../docs/deployment.md) sekce 0–9. Klíčové kroky
po pořadí:

1. **DNS** — nastav A/AAAA u hukot.net (sekce 1)
2. **Server** — `adduser app`, SSH klíče, UFW, fail2ban (sekce 2–3)
3. **Software** — Node (nvm), pnpm, PM2, Postgres 16+PostGIS, Nginx, certbot, libheif (sekce 3)
4. **DB** — create user + db + `CREATE EXTENSION postgis` (sekce 4)
5. **FS layout** — `/var/ctyrlistkoteka/{data,generated}` (sekce 5)
6. **Clone + build** — `git clone`, `pnpm install`, `pnpm build` (sekce 6)
7. **PM2** — `pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup` (sekce 7)
8. **Nginx** — symlink template, `nginx -t && systemctl reload nginx` (sekce 8)
9. **SSL** — `sudo certbot --nginx -d ctyrlistkoteka.cz -d www.ctyrlistkoteka.cz` (sekce 9)
10. **GitHub secrets** — `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, volitelně `DEPLOY_PORT` (sekce 11)
11. **Data** — `rsync` archiv do `/var/ctyrlistkoteka/data/` → `pnpm sync` (sekce 12)
12. **Zálohy** — `crontab -e` → `0 3 * * * /var/www/ctyrlistkoteka/deploy/backup.sh` (sekce 4 + `backup.sh`)
13. **Auto-sync (volitelné)** —
    ```bash
    sudo cp deploy/systemd-sync.service /etc/systemd/system/ctyrlistkoteka-sync.service
    sudo cp deploy/systemd-sync.timer   /etc/systemd/system/ctyrlistkoteka-sync.timer
    sudo systemctl daemon-reload
    sudo systemctl enable --now ctyrlistkoteka-sync.timer
    ```

## GitHub Actions secrets

V Settings → Secrets and variables → Actions přidej:

| Secret | Hodnota |
| --- | --- |
| `DEPLOY_HOST` | IP nebo hostname OVH VPS |
| `DEPLOY_USER` | `app` (nebo dedikovaný `deploy` uživatel) |
| `DEPLOY_SSH_KEY` | privátní SSH klíč (odpovídající veřejnému klíči v `~/.ssh/authorized_keys` pro `app`) |
| `DEPLOY_PORT` | (volitelné) nestandardní SSH port; default 22 |

Generuj nový key pair jen pro deploy, nepoužívej osobní klíč:
```
ssh-keygen -t ed25519 -f deploy_key -C "github-actions-ctyrlistkoteka" -N ""
# deploy_key.pub → na VPS do /home/app/.ssh/authorized_keys
# deploy_key → do DEPLOY_SSH_KEY secret
```

## Rollback

Deploy je fast-forward, ne rebase. Rollback:

```bash
# Na VPS
cd /var/www/ctyrlistkoteka
git log --oneline -5              # najdi předchozí commit
git reset --hard <commit>
pnpm install --frozen-lockfile
pnpm build
pm2 reload ctyrlistkoteka
```

Pro DB migrace — Prisma `migrate deploy` je forward-only. Pokud je potřeba
rollback schema, obnov z `pg_dump` zálohy v `/var/backups/postgres/`.
