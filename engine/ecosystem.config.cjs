// pm2 start ecosystem.config.cjs   (keeps the engine alive and restarts it on crash or reboot)
module.exports = {
  apps: [{
    name: 'circo-engine',
    script: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--experimental-strip-types --env-file=.env',
    max_restarts: 50,
    restart_delay: 3000,
  }],
};
