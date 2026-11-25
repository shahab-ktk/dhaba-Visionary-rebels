#!/usr/bin/env bash
set -euo pipefail

status=ok
for check in check-workloads.sh check-database.sh check-redis.sh; do
    if ! "/opt/monitor/${check}"; then
        echo "${check} failed" >&2
        status=failed
    fi
done

kubectl -n ops patch configmap monitor-state --type merge \
    -p "{\"data\":{\"last-run\":\"$(date -u +%FT%TZ)\",\"last-status\":\"${status}\"}}"
[[ "$status" == ok ]]
