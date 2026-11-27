# EC2 kind setup bundle

This directory contains the host and Kubernetes files needed to prepare the kind
cluster on EC2. It is a packaged copy of the project setup files, so update this
bundle whenever the root `kind/`, `scripts/`, `k8s/`, or `aws/` setup files
change.

## Get this directory on EC2

Push the `dev` branch, then on EC2 you can check out only this directory:

```bash
git clone --filter=blob:none --sparse --branch dev https://github.com/shahab-ktk/dhaba-Visionary-rebels.git
cd dhaba-Visionary-rebels
git sparse-checkout set ec2-kind-setup
cd ec2-kind-setup
```

Install Docker, AWS CLI v2, kubectl, kind, Helm, curl, git, jq, and openssl on
Ubuntu first. Attach the EC2 instance role with ECR read-only and SSM managed
instance permissions. Do not configure GitHub IAM user access keys on EC2.

## Create the cluster

Run from this directory as the `ubuntu` user:

```bash
kind create cluster --name dhaba --config kind/kind.yaml
kubectl cluster-info --context kind-dhaba
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.37/deploy/local-path-storage.yaml
helm repo add traefik https://traefik.github.io/charts
helm repo update
helm upgrade --install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  --set service.spec.type=NodePort \
  --set ports.web.nodePort=30080 \
  --set ports.websecure.nodePort=30443 \
  --set providers.kubernetesIngress.enabled=true \
  --set ingressClass.enabled=true \
  --set ingressClass.name=traefik \
  --set ingressClass.isDefaultClass=false
kubectl -n traefik rollout status deployment/traefik --timeout=180s

helm upgrade --install cert-manager \
  oci://quay.io/jetstack/charts/cert-manager \
  --version v1.21.3 \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true
kubectl -n cert-manager rollout status deployment/cert-manager --timeout=180s
kubectl -n cert-manager rollout status deployment/cert-manager-webhook --timeout=180s
kubectl -n cert-manager rollout status deployment/cert-manager-cainjector --timeout=180s
```

That provisioner creates the `local-path` StorageClass used by Postgres and
Redis. The app manifests use that existing class instead of trying to change
its immutable reclaim policy.

The manifests use the maintained Traefik IngressClass. The Traefik Service uses
NodePorts 30080/30443, which `kind/kind.yaml` maps to EC2 host ports 80/443.
The ingress overlays use `visionary-rebel-staging.duckdns.org` and
`visionary-rebel-production.duckdns.org`. Point both DuckDNS records at the
EC2 public IP and allow inbound TCP 80 and 443 so HTTP-01 certificate
validation and HTTPS traffic can reach Traefik. The production ClusterIssuer
is defined in `k8s/cert-manager/cluster-issuer.yaml`; set its optional ACME
contact email to an address you monitor before applying it. The bootstrap
script applies the issuer and the ingress overlays after cert-manager is ready.

## Install the SSM helper and bootstrap

The SSM document stack is deployed separately by an AWS administrator. It must
already contain the correct staging and production hostnames, matching DNS and
the Ingress host values in `k8s/overlays/`. The CloudFormation template defaults
to the DuckDNS hostnames above.

Install the deployment helper, then bootstrap the namespaces and resources:

```bash
sudo install -o root -g root -m 0755 scripts/deploy-kind.sh /usr/local/sbin/dhaba-kind-deploy

export AWS_ACCOUNT="<your-12-digit-account-id>"
export AWS_REGION="<your-aws-region>"
export TEAM="<your-team>"
scripts/bootstrap-kind.sh
```

The bootstrap reads ECR credentials using the EC2 instance role. It creates
`staging`, `production`, and `ops`, adds namespace-local pull secrets, creates
the application secrets, and applies RBAC and workloads.

For the deployment and IAM details, see [BUILD-AND-PUSH.md](docs/BUILD-AND-PUSH.md).
