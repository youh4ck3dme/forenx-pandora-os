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
      // Absolute path: independent of the directory `pm2 start` is run from.
      // Node exits at startup if the file is missing (no silent key-less run).
      node_args: `--env-file=${require("node:path").join(__dirname, ".env.production")}`,
      env: {
        NODE_ENV: "production",
        PORT: 3005,
        // Loopback only: reachable exclusively through the nginx reverse proxy.
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
