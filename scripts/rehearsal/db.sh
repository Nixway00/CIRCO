set -e
export PATH=/usr/lib/postgresql/16/bin:$PATH
P="psql -h /tmp -p 5433 -U postgres -tA -v ON_ERROR_STOP=1"
Q="psql -h /tmp -p 5433 -U postgres -d circo_test -tA -v ON_ERROR_STOP=1"
$P -c "drop database if exists circo_test;" >/dev/null
$P -c "create database circo_test;" >/dev/null
$P -c "do \$\$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end \$\$;" >/dev/null
$P -c "do \$\$ begin create role authenticator login noinherit password 'pw'; exception when duplicate_object then null; end \$\$;" >/dev/null
$P -c "grant anon, authenticated, service_role to authenticator;" >/dev/null
$Q -c "create publication supabase_realtime;" >/dev/null
for f in /tmp/gitrepo/supabase/migrations/*.sql; do $Q -q -f $f 2>&1 | grep -iv "wal_level\|hint" || true; echo "$(basename $f) ok"; done
$Q -c "grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role; grant select on all tables in schema public to anon, authenticated;" >/dev/null
echo DB_READY
