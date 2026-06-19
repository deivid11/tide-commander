module.exports = {
  apps: [
    {
      name: 'tide-commander',
      script: 'dist/src/packages/server/cli.js',
      args: 'start --foreground',
      interpreter: '/home/erick/.nvm/versions/node/v24.16.0/bin/node',
      cwd: '/home/erick/tide-tols/tide-commander',
      env: {
        NODE_ENV: 'production',
        PORT: '6200',
        HOST: '127.0.0.1',
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      autorestart: true,
    },
  ],
};
