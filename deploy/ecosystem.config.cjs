// PM2 ecosystem config
// Spuštění: pm2 start deploy/ecosystem.config.cjs
// Restart:  pm2 reload ctyrlistkoteka
// Logy:     pm2 logs ctyrlistkoteka

module.exports = {
  apps: [
    {
      name: 'ctyrlistkoteka',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
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
