# Dhaba Orders

Seven services, each in its own folder with its own Dockerfile. Build each into an image, then deploy each as a Kubernetes Service.

| Folder | Kind | Stack | Port | Job |
|---|---|---|---|---|
| `web` | Stateless | React (Vite) on Nginx | 8080 | Team-project showcase at `/`; restaurant ordering app at `/app`; kitchen and stats; proxies `/api/*` |
| `menu-api` | Stateless | Python, FastAPI | 8000 | Menu from Postgres, cached in Redis |
| `orders-api` | Stateless | Go | 8080 | Saves orders, queues jobs, writes stats. `/info` shows version and pod |
| `kitchen-worker` | Stateless, no web port | Java, Spring Boot | none | Takes queue jobs, moves orders new, cooking, ready |
| `stats-api` | Stateless | PHP, Laravel 13 | 9000 | Orders per minute and top dishes from Redis |
| `postgres` | Stateful | PostgreSQL 16 | 5432 | Orders and menu. Volume at `/var/lib/postgresql/data` |
| `redis` | Stateful | Redis 7 | 6379 | Cache and job queue. Volume at `/data` |

The root page preserves the Visionary Rebels team-project showcase. Its
**Explore the Dhaba Orders app** button opens the live restaurant ordering UI
at `/app`.

## Data flow

1. `web` calls `/api/menu`. Nginx sends it to `menu-api`, which reads Redis first, then Postgres.
2. `web` posts to `/api/orders`. `orders-api` saves the order and its items in one transaction, then does `LPUSH orders:queue {"order_id": N}` and updates `stats:orders_ts` and `stats:top_dishes`.
3. `kitchen-worker` pops `orders:queue`, sets the order to `cooking`, waits 5 seconds, sets it to `ready`.
4. The kitchen tab polls `/api/orders` every 5 seconds. The stats tab polls `/api/stats`.

## Build the images and push them to ECR

See [docs/BUILD-AND-PUSH.md](docs/BUILD-AND-PUSH.md). Short version:

    scripts/create-ecr-repos.sh      # once
    scripts/build-and-push.sh        # build, tag with the commit, push

## Deploy to a single-node kind cluster on EC2

The application images are built and scanned by GitHub Actions, then pushed to
private ECR repositories. The EC2 host runs kind; deployments are sent through
AWS Systems Manager (SSM), without SSH keys. The cluster has three project
namespaces: `staging`, `production`, and `ops`. Kubernetes system namespaces
such as `default` and `kube-system` are separate.

### EC2 prerequisites

Attach an instance role that includes `AmazonEC2ContainerRegistryReadOnly` and
`AmazonSSMManagedInstanceCore`. Use three narrowly scoped IAM users for GitHub Actions because OIDC is
unavailable: one ECR publisher, one staging deployer, and one production
deployer. The deploy users can call only their matching fixed SSM document on
this instance. The instance must appear as an online managed node in Systems
Manager. The documents are defined in `aws/ssm-deployment-documents.yaml` and
accept only a commit SHA and allowlisted service names, not shell commands.

Install Docker, AWS CLI v2, kubectl, kind, and Helm on Ubuntu. The Ubuntu user
that owns the kind cluster must be able to run Docker and kubectl. For kind's
current installation commands see the [kind Quick Start](https://kind.sigs.k8s.io/docs/user/quick-start). Create the cluster with
`kind/kind.yaml`, which maps host ports 80 and 443 to the kind node's ingress
NodePorts. Allow inbound 80/443 in the EC2 security group only from intended
clients; restrict SSH to your own IP.

Install Traefik as the ingress controller and the Rancher local-path
provisioner. The base storage class is `local-path`; Postgres and Redis data
will reside on this EC2 instance and need independent backups. Do not install
the EKS EBS CSI driver, AWS load balancer controller, or cert-manager for this
HTTP-only kind setup.

Create the cluster and ingress (run as `ubuntu`):

    kind create cluster --name dhaba --config kind/kind.yaml
    kubectl cluster-info --context kind-dhaba
    kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.37/deploy/local-path-storage.yaml
    helm repo add traefik https://traefik.github.io/charts
    helm repo update
    helm upgrade --install traefik traefik/traefik \
      --namespace traefik --create-namespace \
      --set service.type=NodePort \
      --set ports.web.nodePort=30080 \
      --set ports.websecure.nodePort=30443 \
      --set providers.kubernetesIngress.enabled=true \
      --set ingressClass.enabled=true \
      --set ingressClass.name=traefik \
      --set ingressClass.isDefaultClass=false
    kubectl -n traefik rollout status deployment/traefik --timeout=180s

Install the deployment helper on this host from the checked-out repository:

    sudo install -o root -g root -m 0755 scripts/deploy-kind.sh /usr/local/sbin/dhaba-kind-deploy

The Traefik Service uses NodePorts 30080/30443; `kind/kind.yaml` maps those ports to host 80/443. Before applying the overlays, replace their example hostnames with DNS names pointing to the EC2 public IP. Configure the same hostnames as the SSM document stack parameters. The CI smoke check reaches `127.0.0.1` on EC2 and supplies the matching Host header.

### Bootstrap Kubernetes

From the repository root on EC2, set the ECR values, then create the three
project namespaces, per-namespace pull secrets, application secrets, RBAC,
monitoring resources, and both app overlays:

    export AWS_ACCOUNT=542811240173
    export AWS_REGION=ap-southeast-2
    export TEAM=visionary-rebel
    aws cloudformation deploy --template-file aws/ssm-deployment-documents.yaml \
      --stack-name dhaba-kind-deploy-documents \
      --parameter-overrides AwsAccount="$AWS_ACCOUNT" AwsRegion="$AWS_REGION" \
        Team="$TEAM" StagingHost=dhaba-staging.example.com \
        ProductionHost=dhaba-production.example.com
    scripts/bootstrap-kind.sh

The pull secret is namespace-scoped. The bootstrap creates `ecr-registry` in
`staging`, `production`, and `ops`; `ops` needs it to pull the monitoring
image. The `ops/ecr-secret-refresh` CronJob gets ECR credentials from the EC2
instance role through IMDSv2 and refreshes all three secrets every six hours.
Keep EC2 metadata enabled, require IMDSv2, and set the metadata response hop
limit to 2 so the nested kind node can reach it. Any pod that can reach IMDS can
request the instance role credentials, so keep that role limited to ECR read and
SSM managed-node permissions. The refresh ServiceAccount can patch only the named `ecr-registry`
secret in those namespaces; it cannot read application secrets.

The ECR refresh job uses `hostNetwork` so it can reach the EC2 instance metadata
endpoint. Restrict IMDS access at the instance/network layer and do not run
untrusted workloads in this cluster.

### Deployment identities and flow

`k8s/rbac/pipeline-access.yaml` creates a `pipeline-deployer` ServiceAccount
in `staging`, with a Role and RoleBinding in each of `staging` and
`production`. It can patch only the app Deployments, StatefulSets, and
`dhaba-config` ConfigMap in those namespaces. It has no RoleBinding in `ops`
or cluster-wide permissions. The host deployment helper creates a short-lived
ServiceAccount token, switches to that identity, updates only changed image
tags, waits for rollout, and runs an HTTP smoke check.

GitHub Actions CI checks and scans changed images, pushes them to ECR, then
uses SSM to deploy that commit to staging. A successful staging rollout and
smoke check unlocks the production job. Configure a required reviewer on the
GitHub Actions `production` environment under **Settings → Environments**;
that environment approval is the production gate. Configure these repository
variables:

| Variable | Value |
|---|---|
| `AWS_ACCOUNT` | `542811240173` |
| `AWS_REGION` | `ap-southeast-2` |
| `TEAM` | `visionary-rebel` |
| `KIND_INSTANCE_ID` | EC2 instance ID running kind |

The workflow uses repository-level `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` secrets for ECR publishing. Add environment-level
secrets with those same names to `staging` and `production`, using keys from the
matching deploy IAM users. Environment secrets override repository secrets in
the deploy jobs, so the staging key cannot call the production SSM document.
Require reviewers on `production`. The SSM host uses its administrator
kubeconfig only to mint a short-lived `pipeline-deployer` token; all Kubernetes
mutations use that restricted identity.

### Ops monitoring (C16)

The `ops` namespace has a separate `cluster-monitor` ServiceAccount and a
CronJob that runs three checks every minute: workload readiness, PostgreSQL
readiness, and Redis readiness across staging and production. Its namespace
Its Roles in the app namespaces are read-only; in `ops` it can update only
`monitor-state`. Database checks use network readiness probes and do not receive
permission to exec into app pods or read database credentials. The ECR refresher has its own ServiceAccount, can
update only the named ECR pull secrets and `ops/ecr-refresh-state`, and cannot
read application secrets. Neither ops identity is reused by the deployment
pipeline.

Monitoring scripts are mounted from a ConfigMap generated by `k8s/ops`. When
they change, an ops administrator applies `kubectl apply -k k8s/ops`; the
pipeline cannot change anything in `ops`. If `ops-monitor/Dockerfile` changes,
CI builds a new utility image, and an ops administrator updates the
`cluster-monitor` CronJob image to that commit SHA after it is pushed.

The single EC2 instance is a learning/small workload setup, not a highly
available production cluster. kind and local-path volumes share the instance's
failure boundary. Back up Postgres data and do not use real customer data until
authentication is added.

## Environment variables

| Service | Variable | Default |
|---|---|---|
| menu-api | `DATABASE_URL`, `REDIS_URL`, `CACHE_TTL_SECONDS`, `APP_VERSION` | `postgres://dhaba:dhaba@postgres:5432/dhaba`, `redis://redis:6379`, 300 |
| orders-api | `DATABASE_URL` (needs `?sslmode=disable` in-cluster), `REDIS_URL`, `PORT`, `POD_NAME`, `APP_VERSION` | as above, 8080 |
| kitchen-worker | `DB_URL` (JDBC form), `DB_USER`, `DB_PASSWORD`, `REDIS_URL`, `COOK_MILLIS` | `jdbc:postgresql://postgres:5432/dhaba`, dhaba, dhaba, 5000 |
| stats-api | `REDIS_HOST`, `REDIS_PORT`, `APP_KEY` (optional), `APP_VERSION` | `redis`, 6379 |
| postgres | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | none, set them |

Kubernetes details:

- Keep the Service names `menu-api`, `orders-api`, `stats-api`, `postgres`, and `redis`; the web proxy relies on them.
- `postgres` and `redis` use separate StatefulSets and local-path claims in each namespace. Back up those host-local volumes.
- Both app overlays use one replica per service for the single-node kind cluster.
- The Ingress objects expect a `traefik` IngressClass. Configure Traefik as a NodePort Service on 30080/30443 and use the host port mappings in `kind/kind.yaml`.
- ECR pull credentials are refreshed by the `ops` CronJob every six hours. It uses the EC2 instance role and updates only `ecr-registry` in `staging`, `production`, and `ops`.

## Changes from the first draft

- `KitchenScreen` used the status `pending`; the database uses `new`. Fixed.
- `orders-api`: `-X main.version` cannot override a variable set from `os.Getenv`; fixed. The `--health-check` flag the Dockerfile used did not exist; added. Name and price now come from the menu table, not the client. Stats keys the stats-api reads are now written by orders-api.
- `redis.conf`: `allkeys-lru` could evict queued jobs. Changed to `noeviction`.
- `kitchen-worker`: `DATABASE_URL` conflicted with the `postgres://` form the other services use, so it now reads `DB_URL`. The Docker health check pointed at an actuator that does not exist; it now uses a heartbeat file. Constructor injection makes it testable without a Spring context. Checkstyle removed from the build because it can fail the image build on style warnings.
- `stats-api`: `config:cache` makes `env()` return null at runtime; replaced with `getenv`. The image now builds a stock Laravel 13 app (no dev packages) and applies `overlay/` on top, so no framework boilerplate is committed. It runs PHP-FPM and Nginx as a non-root user, and caches config and routes when the container starts.
- `web`: runs as a non-root Nginx on port 8080. The API hosts are resolved per request, so the container starts without the backends.
- Every image carries the commit as `APP_VERSION` and as an image label. `docker-compose.yml` was removed; images are built and pushed with the scripts in `scripts/`.

## Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs checks on pull requests and pushes to `main`, validates the app and ops manifests, then builds, scans, and pushes changed images to ECR using scoped IAM user keys stored as GitHub secrets. It deploys changed app images to staging through SSM, runs a smoke check, and waits for approval on the protected `production` environment before promotion. The Kubernetes deployment identity is scoped to `staging` and `production`; ops uses separate monitoring and ECR refresh identities. See [docs/BUILD-AND-PUSH.md](docs/BUILD-AND-PUSH.md) for the IAM policies and GitHub secret setup.
