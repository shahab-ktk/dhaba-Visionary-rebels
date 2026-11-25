#!/usr/bin/env bash
set -euo pipefail

for namespace in staging production; do
    pg_isready -h "postgres.${namespace}.svc.cluster.local" -p 5432 -t 3
done
