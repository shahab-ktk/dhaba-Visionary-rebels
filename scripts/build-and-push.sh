#!/usr/bin/env bash
# Builds the Dhaba Orders images, tags them with the Git commit SHA and pushes them to ECR.
# The tag is always the commit. Nothing is tagged "latest".
#
# Usage:  scripts/build-and-push.sh [service ...]     (no arguments = all services)
#
# Required: TEAM, AWS_ACCOUNT, AWS_REGION
# Optional: PLATFORM        default linux/amd64 (what the cluster nodes run, also on Apple Silicon)
#           PUSH=0          build and show sizes, do not log in or push
#           KUBECTL_VERSION passed to the ops-monitor build
#           GIT_SHA         use this tag instead of the current commit
set -euo pipefail

: "${TEAM:?set TEAM (your team name)}"
: "${AWS_ACCOUNT:?set AWS_ACCOUNT}"
: "${AWS_REGION:?set AWS_REGION}"

if [[ ! "$AWS_ACCOUNT" =~ ^[0-9]{12}$ ]]; then
    echo "AWS_ACCOUNT must be the 12-digit AWS account ID; got '${AWS_ACCOUNT}'." >&2
    exit 1
fi

PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-1}"
ALL=(web menu-api orders-api kitchen-worker stats-api postgres redis ops-monitor)
REGISTRY="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"

cd "$(dirname "$0")/.."

TAG="${GIT_SHA:-$(git rev-parse HEAD)}"
if [ -z "${GIT_SHA:-}" ] && [ -n "$(git status --porcelain)" ]; then
    echo "WARNING: uncommitted changes. Images are tagged ${TAG}, but do not match that commit exactly." >&2
fi

if [ $# -gt 0 ]; then
    SERVICES=("$@")
else
    SERVICES=("${ALL[@]}")
fi

for svc in "${SERVICES[@]}"; do
    case " ${ALL[*]} " in
        *" ${svc} "*) ;;
        *) echo "Unknown service: ${svc}. Choose from: ${ALL[*]}" >&2; exit 1 ;;
    esac
done

if [ "$PUSH" = "1" ]; then
    identity_account=$(aws sts get-caller-identity --query Account --output text)
    if [ "$identity_account" != "$AWS_ACCOUNT" ]; then
        echo "AWS credentials belong to account ${identity_account}, not AWS_ACCOUNT=${AWS_ACCOUNT}." >&2
        exit 1
    fi

    aws ecr get-login-password --region "$AWS_REGION" |
        docker login --username AWS --password-stdin "$REGISTRY"
fi

BUILT_SVC=()
BUILT_IMG=()

for svc in "${SERVICES[@]}"; do
    image="${REGISTRY}/dhaba-${TEAM}/${svc}:${TAG}"
    args=(--platform "$PLATFORM" --provenance=false --build-arg "APP_VERSION=${TAG}" -t "$image")

    echo
    echo "=== ${svc} -> ${image}"

    if [ "$svc" = "ops-monitor" ]; then
        if [ -n "${KUBECTL_VERSION:-}" ]; then
            args+=(--build-arg "KUBECTL_VERSION=${KUBECTL_VERSION}")
        fi
        docker build "${args[@]}" -f ops-monitor/Dockerfile .
    else
        docker build "${args[@]}" "$svc"
    fi

    BUILT_SVC+=("$svc")
    BUILT_IMG+=("$image")
done

if [ "$PUSH" = "1" ]; then
    for image in "${BUILT_IMG[@]}"; do
        docker push "$image"
    done
fi

echo
echo "Image sizes (write these in your pull request):"
printf '%-16s %8s  %-8s %s\n' SERVICE SIZE USER IMAGE
for i in "${!BUILT_IMG[@]}"; do
    bytes=$(docker image inspect --format '{{.Size}}' "${BUILT_IMG[$i]}")
    user=$(docker image inspect --format '{{.Config.User}}' "${BUILT_IMG[$i]}")
    mb=$(awk -v b="$bytes" 'BEGIN { printf "%.0f", b / 1048576 }')
    printf '%-16s %5s MB  %-8s %s\n' "${BUILT_SVC[$i]}" "$mb" "${user:-root}" "${BUILT_IMG[$i]}"
done

if [ "$PUSH" = "1" ]; then
    echo
    echo "Pushed with tag ${TAG}. Use this tag in the Kubernetes manifests, never latest."
fi
