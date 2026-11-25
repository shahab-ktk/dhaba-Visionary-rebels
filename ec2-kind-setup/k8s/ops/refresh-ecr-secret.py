import base64
import json
import os
import ssl
import urllib.request
from datetime import datetime, timezone

import boto3

region = os.environ["AWS_REGION"]
account = os.environ["AWS_ACCOUNT"]
registry = f"{account}.dkr.ecr.{region}.amazonaws.com"
auth_data = boto3.client("ecr", region_name=region).get_authorization_token()["authorizationData"][0]
docker_config = json.dumps({"auths": {registry: {"auth": auth_data["authorizationToken"]}}}).encode()
encoded_config = base64.b64encode(docker_config).decode()

host = os.environ["KUBERNETES_SERVICE_HOST"]
port = os.environ.get("KUBERNETES_SERVICE_PORT", "443")
api = f"https://{host}:{port}"
token_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
ca_path = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
with open(token_path, encoding="utf-8") as token_file:
    token = token_file.read().strip()
context = ssl.create_default_context(cafile=ca_path)


def patch(namespace, resource, name, data):
    url = f"{api}/api/v1/namespaces/{namespace}/{resource}/{name}"
    request = urllib.request.Request(
        url,
        data=json.dumps(data).encode(),
        method="PATCH",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/merge-patch+json",
        },
    )
    with urllib.request.urlopen(request, context=context, timeout=15) as response:
        response.read()


for namespace in ("staging", "production", "ops"):
    patch(namespace, "secrets", "ecr-registry", {"data": {".dockerconfigjson": encoded_config}})

refreshed_at = datetime.now(timezone.utc).isoformat()
patch("ops", "configmaps", "ecr-refresh-state", {"data": {"last-refresh": refreshed_at}})
print(f"Updated namespace ECR pull secrets at {refreshed_at}")
