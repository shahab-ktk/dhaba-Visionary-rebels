#!/usr/bin/env bash
set -euo pipefail

: "${AWS_ACCOUNT:?set AWS_ACCOUNT}"
: "${AWS_REGION:?set AWS_REGION}"
: "${TEAM:?set TEAM}"
registry="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

for namespace in staging production ops; do
    kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f -
    kubectl create secret docker-registry ecr-registry --namespace "$namespace" \
        --docker-server="$registry" --docker-username=AWS \
        --docker-password="$(aws ecr get-login-password --region "$AWS_REGION")" \
        --dry-run=client -o yaml | kubectl apply -f -
done

for namespace in staging production; do
    if ! kubectl get secret dhaba-db --namespace "$namespace" >/dev/null 2>&1; then
        db_password=$(openssl rand -hex 32)
        kubectl create secret generic dhaba-db --namespace "$namespace" \
            --from-literal=DB_USER=dhaba --from-literal="DB_PASSWORD=${db_password}"
        unset db_password
    fi
    if ! kubectl get secret dhaba-app --namespace "$namespace" >/dev/null 2>&1; then
        app_key="base64:$(openssl rand -base64 32)"
        kubectl create secret generic dhaba-app --namespace "$namespace" \
            --from-literal="APP_KEY=${app_key}"
        unset app_key
    fi
done

kubectl apply -f k8s/rbac/pipeline-access.yaml
kubectl apply -k k8s/ops
monitor_tag=${OPS_MONITOR_TAG:-$(git rev-parse HEAD)}
kubectl -n ops set image cronjob/cluster-monitor \
    "checks=${registry}/dhaba-${TEAM}/ops-monitor:${monitor_tag}"
kubectl apply -k k8s/overlays/staging
kubectl apply -k k8s/overlays/production
