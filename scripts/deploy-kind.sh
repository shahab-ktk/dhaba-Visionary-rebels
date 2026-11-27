#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
    echo "Usage: $0 staging|production IMAGE_TAG comma,separated,services" >&2
    exit 2
fi
namespace=$1
tag=$2
services_csv=$3
[[ "$namespace" == staging || "$namespace" == production ]] || exit 2
[[ "$tag" =~ ^[0-9a-f]{40}$ ]] || { echo "Expected a full Git SHA tag" >&2; exit 2; }
: "${AWS_ACCOUNT:?set AWS_ACCOUNT}"
: "${AWS_REGION:?set AWS_REGION}"
: "${TEAM:?set TEAM}"
: "${KIND_STAGING_HOST:=visionary-rebel-staging.duckdns.org}"
: "${KIND_PRODUCTION_HOST:=visionary-rebel-production.duckdns.org}"

registry="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/dhaba-${TEAM}"
source_kubeconfig=${KUBECONFIG:-"${HOME}/.kube/config"}
token=$(kubectl --kubeconfig "$source_kubeconfig" -n staging create token pipeline-deployer --duration=1h)
cluster=$(kubectl --kubeconfig "$source_kubeconfig" config view --minify -o jsonpath='{.contexts[0].context.cluster}')
temporary_kubeconfig=$(mktemp)
trap 'rm -f "$temporary_kubeconfig"' EXIT
kubectl --kubeconfig "$source_kubeconfig" config view --raw --minify > "$temporary_kubeconfig"
kubectl --kubeconfig "$temporary_kubeconfig" config set-credentials pipeline-deployer --token="$token" >/dev/null
kubectl --kubeconfig "$temporary_kubeconfig" config set-context pipeline-deployer \
    --cluster="$cluster" --user=pipeline-deployer --namespace="$namespace" >/dev/null
kubectl --kubeconfig "$temporary_kubeconfig" config use-context pipeline-deployer >/dev/null

IFS=',' read -r -a services <<< "$services_csv"
ordered_services=()
for dependency in postgres redis; do
    for service in "${services[@]}"; do
        if [[ "$service" == "$dependency" ]]; then
            ordered_services+=("$service")
        fi
    done
done
for service in "${services[@]}"; do
    case "$service" in
        postgres|redis) ;;
        *) ordered_services+=("$service") ;;
    esac
done

for service in "${ordered_services[@]}"; do
    [[ -n "$service" ]] || continue
    image="${registry}/${service}:${tag}"
    case "$service" in
        web|menu-api|orders-api|kitchen-worker|stats-api)
            kubectl --kubeconfig "$temporary_kubeconfig" -n "$namespace" \
                set image "deployment/${service}" "${service}=${image}"
            kubectl --kubeconfig "$temporary_kubeconfig" -n "$namespace" \
                rollout status "deployment/${service}" --timeout=240s
            ;;
        postgres|redis)
            kubectl --kubeconfig "$temporary_kubeconfig" -n "$namespace" \
                set image "statefulset/${service}" "${service}=${image}"
            kubectl --kubeconfig "$temporary_kubeconfig" -n "$namespace" \
                rollout status "statefulset/${service}" --timeout=240s
            ;;
        ops-monitor) echo "Ops image updates are applied by the ops administrator, not this pipeline identity." ;;
        *) echo "Refusing unsupported deployment service: ${service}" >&2; exit 2 ;;
    esac
done

kubectl --kubeconfig "$temporary_kubeconfig" -n "$namespace" \
    patch configmap dhaba-config --type merge -p "{\"data\":{\"APP_VERSION\":\"${tag}\"}}"
host=$KIND_STAGING_HOST
[[ "$namespace" == production ]] && host=$KIND_PRODUCTION_HOST
curl --fail --silent --show-error --retry 20 --retry-connrefused \
    --retry-all-errors --retry-delay 3 --retry-max-time 90 \
    -H "Host: ${host}" http://127.0.0.1/healthz
