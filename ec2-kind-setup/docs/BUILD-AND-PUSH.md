# Build the images and push them to ECR

No Docker Compose. Each service is built from its own Dockerfile, tagged with the Git commit, and pushed to its own ECR repository.

| Image | Build context | Listens on | Runs as |
|---|---|---|---|
| web | `web/` | 8080 | nginx (101) |
| menu-api | `menu-api/` | 8000 | app |
| orders-api | `orders-api/` | 8080 | 65534 |
| kitchen-worker | `kitchen-worker/` | none | app |
| stats-api | `stats-api/` | 9000 | app |
| postgres | `postgres/` | 5432 | image default |
| redis | `redis/` | 6379 | image default |
| ops-monitor | repository root (`-f ops-monitor/Dockerfile .`) | none | app |

## 1. Prerequisites

- Docker running on your laptop
- AWS CLI v2, signed in to your team's AWS account from your laptop with the access your trainer gave you (`aws sts get-caller-identity` must work). Use your own authorized AWS profile for local administrative commands; the GitHub IAM user credentials are separate.
- You are inside your Git clone, on the commit you want to build

## 2. Set the variables

    export TEAM=visionary-rebel
    export AWS_ACCOUNT=542811240173
    export AWS_REGION=ap-southeast-2
    export AWS_PROFILE=afnan-personal
    export REGISTRY=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
    export TAG=$(git rev-parse HEAD)

The tag is the commit SHA. Never push or deploy `latest`.

## 3. Create the ECR repositories (once)

    scripts/create-ecr-repos.sh

This creates `dhaba-TEAM/web`, `dhaba-TEAM/menu-api` and the other six, with scan on push and a rule that keeps the newest 20 images. A second run prints "already exists" and changes nothing.

## 4. Build one image by hand

Start with `web` to see what the script does for every service:

    docker build \
      --platform linux/amd64 \
      --build-arg APP_VERSION=$TAG \
      -t $REGISTRY/dhaba-$TEAM/web:$TAG \
      ./web

- `--platform linux/amd64` is needed on Apple Silicon and other ARM laptops. The cluster nodes run amd64, and an arm64 image fails there with `exec format error`.
- `--build-arg APP_VERSION=$TAG` puts the commit into the image, so the service can show it.

Same command for the others; only the last argument and the repository name change:

    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG -t $REGISTRY/dhaba-$TEAM/menu-api:$TAG        ./menu-api
    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG -t $REGISTRY/dhaba-$TEAM/orders-api:$TAG      ./orders-api
    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG -t $REGISTRY/dhaba-$TEAM/kitchen-worker:$TAG  ./kitchen-worker
    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG -t $REGISTRY/dhaba-$TEAM/stats-api:$TAG       ./stats-api
    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG -t $REGISTRY/dhaba-$TEAM/postgres:$TAG        ./postgres
    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG -t $REGISTRY/dhaba-$TEAM/redis:$TAG           ./redis

`ops-monitor` is built from the repository root, because it copies `k8s/ops/scripts/`:

    docker build --platform linux/amd64 --build-arg APP_VERSION=$TAG \
      -t $REGISTRY/dhaba-$TEAM/ops-monitor:$TAG -f ops-monitor/Dockerfile .

## 5. Check the images before pushing

Non-root user (an empty result means root; only postgres and redis may show that):

    docker image inspect --format '{{.Config.User}}' $REGISTRY/dhaba-$TEAM/web:$TAG

Sizes, for your pull request:

    docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' | grep dhaba-$TEAM

Run one image on its own. `web` starts without the backends:

    docker run --rm -p 8080:8080 $REGISTRY/dhaba-$TEAM/web:$TAG
    # in another terminal
    curl localhost:8080/healthz
    curl localhost:8080/version.txt        # prints the commit

## 6. Log in to ECR and push

    aws ecr get-login-password --profile $AWS_PROFILE --region $AWS_REGION \
      | docker login --username AWS --password-stdin $REGISTRY

    docker push $REGISTRY/dhaba-$TEAM/web:$TAG
    # repeat for the other services

The login lasts 12 hours.

## 7. Verify in ECR

    aws ecr describe-images --profile $AWS_PROFILE --region $AWS_REGION \
      --repository-name dhaba-$TEAM/web --query 'imageDetails[].imageTags'

After the scan finishes (a minute or two):

    aws ecr describe-image-scan-findings --profile $AWS_PROFILE --region $AWS_REGION \
      --repository-name dhaba-$TEAM/web --image-id imageTag=$TAG \
      --query 'imageScanFindings.findingSeverityCounts'

Any `CRITICAL` count above zero fails the pipeline in Phase 3, so fix it now.

## The same thing with one script

    scripts/build-and-push.sh                 # all services
    scripts/build-and-push.sh web stats-api   # only these
    PUSH=0 scripts/build-and-push.sh          # build and show sizes, no push

It logs in to ECR, builds with the commit as tag, pushes, and prints a table of sizes and users to paste into the pull request. `ops-monitor` is built when its Dockerfile or monitoring scripts change.

## GitHub Actions build and push (C7)

`.github/workflows/ci.yml` builds and pushes changed service images after all test and lint jobs pass on a push to `main`. Images use the commit SHA as the tag. The build disables provenance attestations so images remain a single manifest that ECR basic scanning can scan. Runtime base-image packages are upgraded during builds where supported. ECR scan-on-push starts asynchronously, so CI waits for every changed image scan to appear and complete, reports findings for all images, then fails if any scan fails or any image has critical findings. Changing the shared build script triggers a rebuild of all service images.

Configure the non-secret **repository variables** under **Settings → Secrets and variables → Actions → Variables**:

| Variable | Value |
|---|---|
| `TEAM` | `visionary-rebel` |
| `AWS_REGION` | `ap-southeast-2` |
| `AWS_ACCOUNT` | `542811240173` |
| `KIND_INSTANCE_ID` | EC2 instance ID running kind |

The workflow uses three IAM users because OIDC is unavailable. Their inline policy templates are in `aws/policies/`: `ecr-publish.json`, `staging-deploy.json`, and `production-deploy.json`. Replace the `REGION`, `ACCOUNT_ID`, `TEAM`, and `INSTANCE_ID` placeholders before attaching each policy. Create the access keys and attach the policies from an AWS administrator session; do not attach these policies to the EC2 instance role.

Store the ECR publisher user's keys as **repository secrets** named `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. Create GitHub environments named `staging` and `production`; put the staging deploy user's keys under the same two secret names in the staging environment, and the production deploy user's keys under those names in production. Environment secrets take precedence for their respective deploy jobs. Add required reviewers to the production environment. The workflow grants no `id-token: write` permission and does not assume roles.

## Kubernetes manifests and deployment

The shared base and staging/production overlays are under `k8s/`. CI renders
and validates the app overlays and ops manifests. For kind, Postgres and Redis
use the local-path provisioner rather than EBS. The EC2 host role supplies ECR
read access; an `ops` CronJob refreshes the namespaced `ecr-registry` secrets
every six hours. Secrets are created in all three project namespaces because
Kubernetes Secrets are namespace-scoped.

On a push to `main`, after checks, builds, and ECR scans succeed, CI sends an
SSM command to the configured kind EC2 instance. The instance runs
`/usr/local/sbin/dhaba-kind-deploy` as `ubuntu`; install it from
`scripts/deploy-kind.sh` after cloning. It uses a short-lived token for the
`pipeline-deployer` ServiceAccount, which has patch-only Roles for named app
workload types and `dhaba-config` in `staging` and `production`. It has no ops
or cluster-wide binding. Configure GitHub environment `production` with required
reviewers to gate that deploy.

Keep the IAM users and access keys separate: the ECR publisher user can push and inspect images only in the project ECR repositories; the staging deploy user can send only the `DhabaKindDeployStaging` SSM document to the configured instance; the production deploy user can send only `DhabaKindDeployProduction`. Both deploy policies include `ssm:GetCommandInvocation` for polling. Do not grant either deploy user access to `AWS-RunShellScript`. The production credentials are stored as environment secrets and are available to the job only after any required environment reviewers approve it.

The access-key policy templates are in `aws/policies/`. The ECR IAM user policy grants `ecr:GetAuthorizationToken` plus image upload and scan-read actions on the team's repositories. Deploy IAM policies are restricted to the SSM document ARN and EC2 instance ARN. Rotate access keys periodically; if a key is exposed, deactivate and delete it in IAM, then replace the matching GitHub secret.

The `ops` namespace runs three monitoring checks every minute under a separate
read-only ServiceAccount. The ECR refresh CronJob uses a public Python image so
it can still start when its ECR token is expired; it obtains credentials from
the EC2 role through IMDSv2 and can patch only the named pull secret. Its
`hostNetwork` setting permits metadata access; restrict IMDS and do not run
untrusted workloads on this cluster.

## Problems you may hit

| Message | Cause and fix |
|---|---|
| `exec format error` when the pod starts | Image was built for arm64. Rebuild with `--platform linux/amd64` |
| `no basic auth credentials` on push | ECR login expired or was for another region. Repeat step 6 |
| `name unknown: The repository ... does not exist` | Run `scripts/create-ecr-repos.sh` first |
| `go.sum` missing in `orders-api` | Run `go mod tidy` in `orders-api/` once and commit `go.sum` |
| Pods say `ErrImagePull` | The cluster cannot pull from ECR yet. That is the ECR credential choice in Phase 3 (C9) |

### Create IAM users and GitHub secrets

Run these commands from a trusted admin shell with permission to manage IAM users and inline policies. Set the values first:

```bash
export AWS_ACCOUNT=542811240173
export AWS_REGION=ap-southeast-2
export TEAM=visionary-rebel
export KIND_INSTANCE_ID=i-0123456789abcdef0

policy_dir=$(mktemp -d)
trap 'rm -rf "$policy_dir"' EXIT
for policy in ecr-publish staging-deploy production-deploy; do
  sed -e "s/REGION/${AWS_REGION}/g" \
      -e "s/ACCOUNT_ID/${AWS_ACCOUNT}/g" \
      -e "s/TEAM/${TEAM}/g" \
      -e "s/INSTANCE_ID/${KIND_INSTANCE_ID}/g" \
      "aws/policies/${policy}.json" > "${policy_dir}/${policy}.json"
done

aws iam create-user --user-name DhabaGitHubECRPublisher
aws iam put-user-policy --user-name DhabaGitHubECRPublisher \
  --policy-name DhabaECRPublish \
  --policy-document "file://${policy_dir}/ecr-publish.json"
aws iam create-user --user-name DhabaGitHubStagingDeployer
aws iam put-user-policy --user-name DhabaGitHubStagingDeployer \
  --policy-name DhabaStagingDeploy \
  --policy-document "file://${policy_dir}/staging-deploy.json"
aws iam create-user --user-name DhabaGitHubProductionDeployer
aws iam put-user-policy --user-name DhabaGitHubProductionDeployer \
  --policy-name DhabaProductionDeploy \
  --policy-document "file://${policy_dir}/production-deploy.json"
```

Create one access key for each user and store the returned values immediately. AWS only returns the secret access key at creation time:

```bash
aws iam create-access-key --user-name DhabaGitHubECRPublisher --output json
aws iam create-access-key --user-name DhabaGitHubStagingDeployer --output json
aws iam create-access-key --user-name DhabaGitHubProductionDeployer --output json
```

In GitHub, open **Settings → Secrets and variables → Actions**:

1. Under **Secrets**, add repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` using the ECR publisher user's key pair.
2. Under **Environments**, create `staging` and add environment secrets with those same names using the staging deploy user's pair.
3. Create `production`, add required reviewers, and add environment secrets with those same names using the production deploy user's pair.
4. Under **Variables**, set `AWS_ACCOUNT`, `AWS_REGION`, `TEAM`, and `KIND_INSTANCE_ID`.

The workflow's build job reads repository secrets. The deploy jobs reference their matching GitHub environments, so environment-scoped values take precedence over repository secrets. This lets the staging user send only the staging document and keeps production keys behind approval. The three keys are long-lived IAM user credentials: do not print them in workflow logs, commit them, or use them on EC2. Rotate them periodically and delete old keys after replacement.

The EC2 instance role also needs SSM managed-node permissions and ECR read-only access. The ECR refresh CronJob runs with `hostNetwork` inside the kind node container to reach EC2 IMDSv2. Configure instance metadata to require IMDSv2 and set the response hop limit to 2 so the nested kind container can reach it. The role used by the instance should remain limited to ECR read and SSM managed-node permissions; any pod able to reach IMDS can request those instance-role credentials.

The SSM document stack is deployed from `aws/ssm-deployment-documents.yaml`. The AWS administrator creating that stack needs permission to create and update SSM documents.

The ops check scripts are generated into a ConfigMap from `k8s/ops/scripts/` and mounted by the CronJob. An ops administrator applies `kubectl apply -k k8s/ops` to roll out script or ops manifest changes. The pipeline identity has no ops RoleBinding. If the `ops-monitor` utility Dockerfile changes, CI builds that image but an ops administrator must update the CronJob image to the pushed commit SHA.
