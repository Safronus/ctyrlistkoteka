// PM2 ecosystem config
// Spuštění: pm2 start deploy/ecosystem.config.cjs
// Restart:  pm2 reload ctyrlistkoteka
// Logy:     pm2 logs ctyrlistkoteka

module.exports = {
  apps: [
    {
      name: 'ctyrlistkoteka',
      script: 'node_modules/next/dist/bin/next',
      // Bind to loopback only — Nginx proxies to 127.0.0.1:3000, so the
      // app server never needs to listen on the public interface.
      // Without -H, Next binds 0.0.0.0 and port 3000 shows up as "open"
      // on external scans; loopback bind makes it filtered/closed to the
      // world with zero impact on the (Nginx-fronted) site.
      args: 'start -p 3000 -H 127.0.0.1',
      cwd: '/var/www/ctyrlistkoteka',
      instances: 2,            // cluster mode, 2 workeři
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
