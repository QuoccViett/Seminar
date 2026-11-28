const path = require("node:path");

// Dùng khi chạy trực tiếp trên VPS nhiều core: pm2 start deploy/ecosystem.config.cjs
module.exports = {
  apps: [{
    name: "seminar-api",
    cwd: path.resolve(__dirname, "../be"),
    script: "dist/main.js",
    exec_mode: "cluster",
    instances: Number(process.env.WEB_CONCURRENCY || 2),
    kill_timeout: 15000,
    max_memory_restart: "600M",
    env: { NODE_ENV: "production", UV_THREADPOOL_SIZE: "8" },
  }],
};
