/**
 * PM2 ecosystem config — NetX (produção VPS Debian 12)
 *
 * Uso na VPS (como usuário `netx`):
 *
 *   cd ~/apps/netx
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup systemd -u netx --hp /home/netx   # cole a linha sudo que ele imprime
 *
 * Logs:
 *   pm2 logs --lines 100
 *   pm2 logs netx-core
 *
 * Restart após deploy:
 *   pm2 reload all              # zero-downtime quando possível
 *   pm2 restart ecosystem.config.js --update-env
 *
 * Caminhos absolutos foram usados de propósito — PM2 sob systemd não herda CWD.
 */
module.exports = {
  apps: [
    {
      name: 'netx-core',
      cwd: '/home/netx/apps/netx/apps/core-service',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      out_file: '/home/netx/.pm2/logs/netx-core.out.log',
      error_file: '/home/netx/.pm2/logs/netx-core.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'netx-gateway',
      cwd: '/home/netx/apps/netx/apps/api-gateway',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '512M',
      out_file: '/home/netx/.pm2/logs/netx-gateway.out.log',
      error_file: '/home/netx/.pm2/logs/netx-gateway.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'netx-web',
      cwd: '/home/netx/apps/netx/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3200',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: '3200' },
      max_memory_restart: '512M',
      out_file: '/home/netx/.pm2/logs/netx-web.out.log',
      error_file: '/home/netx/.pm2/logs/netx-web.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
