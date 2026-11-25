# Eighth image: the monitoring scripts, run by a CronJob in the ops namespace.
# Build from the REPOSITORY ROOT, because it copies the scripts under k8s/ops/scripts/:
#   docker build -f ops-monitor/Dockerfile -t ops-monitor .
FROM alpine:3.20

ARG APP_VERSION=dev
# Keep kubectl within one minor version of the cluster (check: kubectl version).
ARG KUBECTL_VERSION=v1.36.0
# Set by BuildKit from --platform (amd64 or arm64)
ARG TARGETARCH=amd64
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision="${APP_VERSION}"

RUN apk add --no-cache bash curl jq coreutils ca-certificates postgresql16-client redis && \
    curl -fsSLo /usr/local/bin/kubectl \
        "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" && \
    chmod +x /usr/local/bin/kubectl && \
    addgroup -S app && adduser -S -G app app

WORKDIR /opt/monitor
COPY --chown=app:app k8s/ops/scripts/ /opt/monitor/
RUN chmod +x /opt/monitor/*.sh

USER app

# The CronJob sets the command, for example: /opt/monitor/check-services.sh
CMD ["/bin/bash"]
