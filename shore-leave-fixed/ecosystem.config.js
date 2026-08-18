module.exports = {
  apps: [
    {
      name: 'shoreleave',
      script: 'backend/server.js',
      cwd: __dirname,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: 'backend/server.err.log',
      out_file: 'backend/server.out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true
    }
  ]
};
