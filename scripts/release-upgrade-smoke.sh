#!/usr/bin/env bash
set -euo pipefail
variant=${1:?Usage: release-upgrade-smoke.sh unified|slim [candidate-image]}
case "$variant" in unified|slim) ;; *) exit 2 ;; esac
candidate=${2:-mixarr-release-check:$variant}
prefix="mixarr-upgrade-${GITHUB_RUN_ID:-local}-${variant}-$$"
root=$(cd "$(dirname "$0")/.." && pwd)
artifacts=$(mktemp -d)
containers=("$prefix-old" "$prefix-new" "$prefix-fresh" "$prefix-db" "$prefix-redis")
volumes=("$prefix-data" "$prefix-fresh-data")
cleanup() {
  result=$?
  if (( result != 0 )); then
    for name in "${containers[@]}"; do sudo docker logs --tail 80 "$name" 2>/dev/null || true; done
  fi
  sudo docker rm -fv "${containers[@]}" >/dev/null 2>&1 || true
  sudo docker volume rm "${volumes[@]}" >/dev/null 2>&1 || true
  sudo docker network rm "$prefix" >/dev/null 2>&1 || true
  rm -rf "$artifacts"
  exit "$result"
}
trap cleanup EXIT
sudo docker network create "$prefix" >/dev/null
common=(--network "$prefix" --label mixarr.task=release-upgrade-smoke -e SESSION_SECRET=disposable-release-upgrade-session -e LOG_LEVEL=info)
if [[ "$variant" == unified ]]; then
  baseline=ghcr.io/aquantumofdonuts/mixarr@sha256:ff482f3e5ecffbc900c2bd6c6d576882fbee384e9225486d009e418d0cf82910
  common+=(-e DISABLE_CADDY=1)
else
  baseline=ghcr.io/aquantumofdonuts/mixarr@sha256:461994dbbebb25872e0eb8b385be4944cf6dfa744c236a49251c00930c1f4a22
  sudo docker run -d --name "$prefix-db" --network "$prefix" -e MYSQL_ROOT_PASSWORD=disposable-fixture -e MYSQL_DATABASE=mixarr mysql:8.0 >/dev/null
  sudo docker run -d --name "$prefix-redis" --network "$prefix" redis:7-alpine >/dev/null
  common+=(-e "DATABASE_URL=mysql://root:disposable-fixture@$prefix-db:3306/mixarr" -e "REDIS_URL=redis://$prefix-redis:6379")
fi
wait_health() {
  for (( attempt=0; attempt<120; attempt++ )); do
    if sudo docker exec "$1" curl -fsS --max-time 2 http://127.0.0.1:3005/api/health >/dev/null 2>&1; then return; fi
    sleep 1
  done
  echo "Health timed out: $1" >&2
  return 1
}
fixture() {
  sudo docker cp "$root/scripts/release-upgrade-fixture.cjs" "$1:/tmp/upgrade-fixture.cjs" >/dev/null
  sudo docker exec "$1" node /tmp/upgrade-fixture.cjs "$2"
}
sudo docker run -d --name "$prefix-old" "${common[@]}" -v "$prefix-data:/data" "$baseline" >/dev/null
wait_health "$prefix-old"
fixture "$prefix-old" seed
fixture "$prefix-old" snapshot > "$artifacts/before.json"
sudo docker cp "$prefix-old:/tmp/upgrade-cookie.txt" "$artifacts/cookie.txt" >/dev/null
sleep 2
sudo docker stop -t 3 "$prefix-old" >/dev/null
sudo docker run -d --name "$prefix-new" "${common[@]}" -v "$prefix-data:/data" "$candidate" >/dev/null
wait_health "$prefix-new"
sudo docker cp "$artifacts/before.json" "$prefix-new:/tmp/upgrade-before.json" >/dev/null
sudo docker cp "$artifacts/cookie.txt" "$prefix-new:/tmp/upgrade-cookie.txt" >/dev/null
fixture "$prefix-new" verify
sudo docker logs "$prefix-new" > "$artifacts/startup.log" 2>&1
node - "$artifacts/startup.log" <<'JS'
const fs=require('node:fs'),assert=require('node:assert/strict');
const log=fs.readFileSync(process.argv[2],'utf8');
const schedule=log.indexOf('Scheduled 1 jobs'),ready=log.indexOf('API server running');
assert.ok(schedule>=0 && ready>schedule,'Persisted schedule must load before the API listens');
assert.ok(!log.includes('Unhandled promise rejection'));
JS
sudo docker stop -t 3 "$prefix-new" >/dev/null
sudo docker start "$prefix-new" >/dev/null
wait_health "$prefix-new"
fixture "$prefix-new" verify
fixture "$prefix-new" login
fixture "$prefix-new" drift
sudo docker stop -t 3 "$prefix-new" >/dev/null
sudo docker start "$prefix-new" >/dev/null
for (( attempt=0; attempt<60; attempt++ )); do
  [[ $(sudo docker inspect --format '{{.State.Running}}' "$prefix-new") == false ]] && break
  sleep 1
done
[[ $(sudo docker inspect --format '{{.State.ExitCode}}' "$prefix-new") == 1 ]]
echo "$variant refuses schema drift before starting the API."
if [[ "$variant" == slim ]]; then
  sudo docker exec "$prefix-db" mysql -uroot -pdisposable-fixture -e 'CREATE DATABASE mixarr_fresh CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci' >/dev/null 2>&1
  common+=(-e "DATABASE_URL=mysql://root:disposable-fixture@$prefix-db:3306/mixarr_fresh")
fi
sudo docker run -d --name "$prefix-fresh" "${common[@]}" -v "$prefix-fresh-data:/data" "$candidate" >/dev/null
wait_health "$prefix-fresh"
fixture "$prefix-fresh" fresh
echo "$variant upgrade, restart, drift rejection and fresh-install checks passed."
