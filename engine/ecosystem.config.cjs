// pm2 start ecosystem.config.cjs   (keeps the engine alive and restarts it on crash or reboot)
module.exports = {
  apps: [{
    name: 'circo-engine',
    script: 'src/index.ts',
    interpreter: 'node',
    interpreter_args: '--experimental-strip-types --env-file=.env',
    max_restarts: 1000,
    exp_backoff_restart_delay: 2000,   // restarts quickly, backs off if something keeps failing
    max_memory_restart: '600M',
  }],
};
