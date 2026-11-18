# Dhaba Orders

Seven services, each in its own folder with its own Dockerfile. Build each into an image, then deploy each as a Kubernetes Service.

| Folder | Kind | Stack | Port | Job |
|---|---|---|---|---|
| `web` | Stateless | React (Vite) on Nginx | 8080 | Order page, kitchen screen, stats panel; proxies `/api/*` |
| `menu-api` | Stateless | Python, FastAPI | 8000 | Menu from Postgres, cached in Redis |
| `orders-api` | Stateless | Go | 8080 | Saves orders, queues jobs, writes stats. `/info` shows version and pod |
| `kitchen-worker` | Stateless, no web port | Java, Spring Boot | none | Takes queue jobs, moves orders new, cooking, ready |
| `stats-api` | Stateless | PHP, Laravel 13 | 9000 | Orders per minute and top dishes from Redis |
| `postgres` | Stateful | PostgreSQL 16 | 5432 | Orders and menu. Volume at `/var/lib/postgresql/data` |
| `redis` | Stateful | Redis 7 | 6379 | Cache and job queue. Volume at `/data` |

## Data flow

1. `web` calls `/api/menu`. Nginx sends it to `menu-api`, which reads Redis first, then Postgres.
2. `web` posts to `/api/orders`. `orders-api` saves the order and its items in one transaction, then does `LPUSH orders:queue {"order_id": N}` and updates `stats:orders_ts` and `stats:top_dishes`.
3. `kitchen-worker` pops `orders:queue`, sets the order to `cooking`, waits 5 seconds, sets it to `ready`.
4. The kitchen tab polls `/api/orders` every 5 seconds. The stats tab polls `/api/stats`.

## Build the images and push them to ECR

See [docs/BUILD-AND-PUSH.md](docs/BUILD-AND-PUSH.md). Short version:

    scripts/create-ecr-repos.sh      # once
    scripts/build-and-push.sh        # build, tag with the commit, push

## Deploy to EKS

Kustomize manifests are in `k8s/base/` with staging and production overlays. The
current EKS cluster is `dhaba-orders` in account `940482421289`, region
`eu-north-1`. The worker-node IAM role has ECR pull-only access, so Kubernetes
does not need a long-lived ECR image-pull secret or a token-refresh CronJob.

Configure kubectl and create application secrets directly in both namespaces.
These commands generate credentials locally; never commit or share them:

    aws eks update-kubeconfig --profile afnan-personal --region eu-north-1 --name dhaba-orders
    for namespace in staging production; do
      kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f -
      DB_PASSWORD="$(openssl rand -hex 32)"
      APP_KEY="base64:$(openssl rand -base64 32)"
      kubectl create secret generic dhaba-db \
        --namespace "$namespace" \
        --from-literal=DB_USER=dhaba \
        --from-literal=DB_PASSWORD="$DB_PASSWORD" \
        --dry-run=client -o yaml | kubectl apply -f -
      kubectl create secret generic dhaba-app \
        --namespace "$namespace" \
        --from-literal=APP_KEY="$APP_KEY" \
        --dry-run=client -o yaml | kubectl apply -f -
      unset DB_PASSWORD APP_KEY
    done

The EBS CSI driver is installed as an EKS add-on. Install the NGINX Ingress
controller and cert-manager, then deploy with:

    helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
    helm repo update
    helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
      --namespace ingress-nginx --create-namespace \
      --set controller.service.type=LoadBalancer \
      --set-string 'controller.service.annotations.service\.beta\.kubernetes\.io/aws-load-balancer-scheme=internet-facing'

    helm repo add jetstack https://charts.jetstack.io
    helm repo update
    helm upgrade --install cert-manager jetstack/cert-manager \
      --version v1.21.3 --namespace cert-manager --create-namespace \
      --set crds.enabled=true
    kubectl apply -f k8s/cert-manager/cluster-issuer.yaml
    kubectl apply -k k8s/overlays/staging
    kubectl get pods,pvc -n staging -o wide

The worker nodes are `t3.small` instances with an 11-pod limit. The current
cluster runs staging and production; production has separate database and Redis
volumes. Each environment gets a static public IPv4 address via an Elastic-IP
backed Network Load Balancer in one Availability Zone.
The app has no authentication and its order API returns customer names and
order details, so do not use real customer data until authentication is added.
The load balancers and worker nodes incur ongoing AWS charges.

    kubectl apply -k k8s/overlays/production

Set the DuckDNS A records to these Elastic IPs:

| Environment | Hostname | Static IPv4 |
|---|---|---|
| Staging | `dhaba-staging.duckdns.org` | `51.21.36.232` |
| Production | `dhaba-production.duckdns.org` | `56.228.87.179` |

These web Services currently expose HTTP on port 80. The cert-manager
configuration for the shared Ingress controller does not terminate TLS on
these direct NLB endpoints; do not use HTTPS until TLS is configured for them.
Each NLB is in one Availability Zone to provide exactly one IP, so an outage in
that zone will interrupt the corresponding environment.

The overlays pin application images to the verified commit tag. Update the
`images` and `APP_VERSION` values in both overlays when deploying a later
verified release.

For local smoke testing, forward the Ingress controller to localhost and send
the staging host header:

    kubectl port-forward -n ingress-nginx service/ingress-nginx-controller 8080:80
    curl -H 'Host: dhaba-staging.duckdns.org' http://127.0.0.1:8080/

Each environment keeps separate database and Redis volumes. Do not copy a
production secret into Git or use the staging database for production. The
Ingress controller routes only web traffic; APIs and databases remain internal
Services.

## Environment variables

| Service | Variable | Default |
|---|---|---|
| menu-api | `DATABASE_URL`, `REDIS_URL`, `CACHE_TTL_SECONDS`, `APP_VERSION` | `postgres://dhaba:dhaba@postgres:5432/dhaba`, `redis://redis:6379`, 300 |
| orders-api | `DATABASE_URL` (needs `?sslmode=disable` in-cluster), `REDIS_URL`, `PORT`, `POD_NAME`, `APP_VERSION` | as above, 8080 |
| kitchen-worker | `DB_URL` (JDBC form), `DB_USER`, `DB_PASSWORD`, `REDIS_URL`, `COOK_MILLIS` | `jdbc:postgresql://postgres:5432/dhaba`, dhaba, dhaba, 5000 |
| stats-api | `REDIS_HOST`, `REDIS_PORT`, `APP_KEY` (optional), `APP_VERSION` | `redis`, 6379 |
| postgres | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | none, set them |

Kubernetes details:

- Keep the Service names `menu-api`, `orders-api`, `stats-api`, `postgres`, `redis`. Nginx and the defaults rely on them.
- In `orders-api`, set `POD_NAME` from the downward API (`metadata.name`) so `/info` shows the pod.
- `kitchen-worker` has no port. For a liveness probe use an exec probe: `test -n "$(find /tmp/kitchen-heartbeat -mmin -1)"`.
- Use a StatefulSet (or a Deployment with a PVC) for `postgres` and `redis`.
- EKS node IAM permissions provide short-lived ECR pulls; no static AWS keys or
  12-hour ECR token need to live in Kubernetes.
- `k8s/overlays/production` runs two replicas of every stateless service and
  spreads them across nodes; staging uses one replica per service. Deployments
  use no-surge rolling updates to avoid requiring extra pod slots during rollout.
- The Ingress objects expect an `nginx` IngressClass. Install an Ingress
  controller before expecting the hostnames to resolve to the application.

## Changes from the first draft

- `KitchenScreen` used the status `pending`; the database uses `new`. Fixed.
- `orders-api`: `-X main.version` cannot override a variable set from `os.Getenv`; fixed. The `--health-check` flag the Dockerfile used did not exist; added. Name and price now come from the menu table, not the client. Stats keys the stats-api reads are now written by orders-api.
- `redis.conf`: `allkeys-lru` could evict queued jobs. Changed to `noeviction`.
- `kitchen-worker`: `DATABASE_URL` conflicted with the `postgres://` form the other services use, so it now reads `DB_URL`. The Docker health check pointed at an actuator that does not exist; it now uses a heartbeat file. Constructor injection makes it testable without a Spring context. Checkstyle removed from the build because it can fail the image build on style warnings.
- `stats-api`: `config:cache` makes `env()` return null at runtime; replaced with `getenv`. The image now builds a stock Laravel 13 app (no dev packages) and applies `overlay/` on top, so no framework boilerplate is committed. It runs PHP-FPM and Nginx as a non-root user, and caches config and routes when the container starts.
- `web`: runs as a non-root Nginx on port 8080. The API hosts are resolved per request, so the container starts without the backends.
- Every image carries the commit as `APP_VERSION` and as an image label. `docker-compose.yml` was removed; images are built and pushed with the scripts in `scripts/`.

## Continuous integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs checks on pull requests and pushes to `main`, validates both Kustomize overlays, and after all checks pass on `main`, builds, scans, and pushes only changed images to personal-account ECR using GitHub OIDC. See [docs/BUILD-AND-PUSH.md](docs/BUILD-AND-PUSH.md) for the required repository variables and AWS role trust setup.
