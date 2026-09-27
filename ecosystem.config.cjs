module.exports = {
  apps: [
    {
      name: "pandora-browser",
      script: ".next/standalone/server.js",
      cwd: "./",
      instances: "max",
      exec_mode: "cluster",
      watch: false,
      max_memory_restart: "1536M",
      env: {
        NODE_ENV: "production",
        PORT: 3005,
        HOSTNAME: "127.0.0.1"
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      restart_delay: 4000
    }
  ]
};
