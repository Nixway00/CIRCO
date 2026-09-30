# keep every test service alive (the sandbox stops background processes between steps)
export PATH="/root/.local/share/solana/install/active_release/bin:/usr/lib/postgresql/16/bin:$PATH"
cd /tmp/devnet
if ! pg_isready -h /tmp -p 5433 -q; then su postgres -c "setsid /usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-p 5433 -k /tmp' -l /tmp/pg.log start" >/dev/null 2>&1; sleep 3; fi
pgrep -f "[p]ostgrest pgrst.conf" >/dev/null || { setsid nohup ./postgrest pgrst.conf >> pgrst.log 2>&1 < /dev/null & sleep 2; }
pgrep -f "[n]ode proxy.mjs" >/dev/null || { setsid nohup node proxy.mjs >> proxy.log 2>&1 < /dev/null & sleep 1; }
pgrep -f "[s]olana-test-validator" >/dev/null || { setsid nohup solana-test-validator --ledger /tmp/devnet/ledger --rpc-port 8899 --quiet >> validator.log 2>&1 < /dev/null & sleep 15; }
pgrep -f "[s]rc/index.ts" >/dev/null || { [ "$1" = "engine" ] && { setsid nohup bash run-engine.sh >> engine.log 2>&1 < /dev/null & sleep 8; }; }
echo "pg:$(pg_isready -h /tmp -p 5433 -q && echo up) rest:$(curl -s -o /dev/null -w '%{http_code}' localhost:54321/rest/v1/) chain:$(solana -u http://127.0.0.1:8899 block-height 2>/dev/null) engine:$(curl -s localhost:8787/health)"
