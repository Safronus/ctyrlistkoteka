// PM2 ecosystem config
// Spuštění: pm2 start deploy/ecosystem.config.cjs
// Restart:  pm2 reload ctyrlistkoteka
// Logy:     pm2 logs ctyrlistkoteka

module.exports = {
  apps: [
    {
      name: 'ctyrlistkoteka',
      script: 'node_modules/next/dist/bin/next',
      // NOTE: do NOT add `-H 127.0.0.1` here. Binding Next to a fixed
      // host makes its middleware use that host (localhost:3000) for
      // rewrites instead of the real Host header; combined with the
      // proxy's `X-Forwarded-Proto: https` the locale rewrite becomes
      // `https://localhost:3000/...`, Next then proxies to its own HTTP
      // server over TLS and every request 500s ("packet length too
      // long"). Leave the default bind and keep port 3000 off the public
      // internet at the firewall instead (see deploy/nftables-*).
      args: 'start -p 3000',
      cwd: '/var/www/ctyrlistkoteka',
      // ONE instance on purpose. `unstable_cache` (the /statistiky + home
      // stat aggregations) lives in each worker's own memory, and there is
      // no shared cacheHandler, so `revalidateTag`/`revalidatePath` only
      // invalidates the worker that handled the call. The CLI sync pings the
      // revalidate endpoint once over 127.0.0.1 → PM2 sends it to a single
      // worker → the OTHER worker kept serving pre-sync numbers for up to 6 h
      // (diagnosed 2026-10-07: "some sections fresh, most stale" after a
      // sync). With one instance the ping always lands on "the" worker and
      // post-sync data is immediately consistent. Low-traffic personal site;
      // the heavy work is in Postgres, so a second Node worker bought little.
      // To go back to multiple instances, add a shared cacheHandler (Redis)
      // first — see gotcha 33.
      instances: 1,
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '/var/log/ctyrlistkoteka/error.log',
      out_file: '/var/log/ctyrlistkoteka/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
