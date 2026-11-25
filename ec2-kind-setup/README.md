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
```

The manifests currently use IngressClass `nginx`. The ingress-nginx project was
retired in March 2026, so migrate these Ingress manifests to a maintained
controller before exposing this cluster publicly. The EC2 port mappings in
`kind/kind.yaml` map host ports 80/443 to kind node ports 30080/30443.

## Install the SSM helper and bootstrap

The SSM document stack is deployed separately by an AWS administrator. It must
already contain the correct staging and production hostnames, matching DNS and
the Ingress host values in `k8s/overlays/`.

Install the deployment helper, then bootstrap the namespaces and resources:

```bash
sudo install -o root -g root -m 0755 scripts/deploy-kind.sh /usr/local/sbin/dhaba-kind-deploy

export AWS_ACCOUNT=542811240173
export AWS_REGION=ap-southeast-2
export TEAM=visionary-rebel
scripts/bootstrap-kind.sh
```

The bootstrap reads ECR credentials using the EC2 instance role. It creates
`staging`, `production`, and `ops`, adds namespace-local pull secrets, creates
the application secrets, and applies RBAC and workloads.

For the deployment and IAM details, see [BUILD-AND-PUSH.md](docs/BUILD-AND-PUSH.md).
