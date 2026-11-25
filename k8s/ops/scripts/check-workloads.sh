#!/usr/bin/env bash
set -euo pipefail

for namespace in staging production; do
    kubectl -n "$namespace" wait --for=condition=Available deployment --all --timeout=10s
    kubectl -n "$namespace" wait --for=jsonpath='{.status.readyReplicas}'=1 statefulset --all --timeout=10s
done
