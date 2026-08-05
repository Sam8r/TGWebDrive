module.exports = {
  apps: [
    {
      name: "tgdrive",
      cwd: "/home/dotplushq/domains/drive.dotplushq.online/tgdrive",
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      env: { NODE_ENV: "production" },
      error_file: "./data/tgdrive-err.log",
      out_file: "./data/tgdrive-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
