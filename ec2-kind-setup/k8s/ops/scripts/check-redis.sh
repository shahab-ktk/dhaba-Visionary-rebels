#!/usr/bin/env bash
set -euo pipefail

for namespace in staging production; do
    redis-cli -h "redis.${namespace}.svc.cluster.local" ping | grep -qx PONG
done
