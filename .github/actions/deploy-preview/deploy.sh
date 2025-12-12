#!/bin/bash
set -e

echo "🚀 Deploy preview for $INPUT_SERVICE_NAME in namespace $INPUT_NAMESPACE"

# Ensure namespace exists
kubectl get ns "$INPUT_NAMESPACE" >/dev/null 2>&1 \
  || kubectl create ns "$INPUT_NAMESPACE"

# Prepare temp directory
mkdir -p .preview-temp

# Copy and patch manifests
sed \
  -e "s/SERVICE_NAME_PLACEHOLDER/$INPUT_SERVICE_NAME/g" \
  -e "s/IMAGE_PLACEHOLDER/$INPUT_IMAGE/g" \
  -e "s/PORT_PLACEHOLDER/$INPUT_PORT/g" \
  "$GITHUB_WORKSPACE/mf-infra/k8s/base-deployment.yaml" \
  > .preview-temp/deployment.yaml

sed \
  -e "s/SERVICE_NAME_PLACEHOLDER/$INPUT_SERVICE_NAME/g" \
  -e "s/PORT_PLACEHOLDER/$INPUT_PORT/g" \
  "$GITHUB_WORKSPACE/mf-infra/k8s/base-service.yaml" \
  > .preview-temp/service.yaml

echo "Source ingress.yaml content:"
cat "$GITHUB_WORKSPACE/mf-infra/k8s/base-ingress.yaml"
echo "---"

sed \
  -e "s/SERVICE_NAME_PLACEHOLDER/$INPUT_SERVICE_NAME/g" \
  -e "s/HOST_PLACEHOLDER/$INPUT_HOST/g" \
  -e "s/PORT_PLACEHOLDER/$INPUT_PORT/g" \
  "$GITHUB_WORKSPACE/mf-infra/k8s/base-ingress.yaml" \
  > .preview-temp/ingress.yaml

echo "Generated ingress.yaml content:"
cat .preview-temp/ingress.yaml
echo "---"

# Delete existing Ingress if it exists to avoid validation errors
kubectl delete ingress "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE" --ignore-not-found=true

# Apply manifests
kubectl apply -n "$INPUT_NAMESPACE" -f .preview-temp

# Inject services if .env.services exists
if [ -f .env.services ]; then
  echo "🔧 Injecting .env.services"
  JSON="{\"spec\":{\"template\":{\"spec\":{\"containers\":[{\"name\":\"${INPUT_SERVICE_NAME}\",\"env\":["

  FIRST=true
  while IFS= read -r line; do
    [[ "$line" =~ ^# ]] && continue
    [[ -z "$line" ]] && continue
    KEY=$(echo "$line" | cut -d '=' -f 1)
    VALUE=$(echo "$line" | cut -d '=' -f 2-)
    if [ "$FIRST" = true ]; then FIRST=false; else JSON="${JSON},"; fi
    JSON="${JSON}{\"name\":\"${KEY}\",\"value\":\"${VALUE}\"}"
  done < .env.services

  JSON="${JSON}]}]}}}}"

  kubectl patch deployment "$INPUT_SERVICE_NAME" \
    -n "$INPUT_NAMESPACE" \
    --type=merge \
    -p "$JSON"
fi

kubectl rollout restart deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE"
echo "✅ Preview deployed"
