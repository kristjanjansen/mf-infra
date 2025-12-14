#!/bin/bash
set -e

echo "🚀 Deploy preview for $INPUT_SERVICE_NAME in namespace $INPUT_NAMESPACE"

# Ensure namespace exists
kubectl get ns "$INPUT_NAMESPACE" >/dev/null 2>&1 \
  || kubectl create ns "$INPUT_NAMESPACE"

# Prepare temp directory
mkdir -p .preview-temp

# Copy and patch manifests using envsubst
export SERVICE_NAME="$INPUT_SERVICE_NAME"
export HOST="$INPUT_HOST"
export PORT="$INPUT_PORT"
export IMAGE="$INPUT_IMAGE"

envsubst < "$GITHUB_WORKSPACE/mf-infra/k8s/base-deployment.yaml" > .preview-temp/deployment.yaml

envsubst < "$GITHUB_WORKSPACE/mf-infra/k8s/base-service.yaml" > .preview-temp/service.yaml

envsubst < "$GITHUB_WORKSPACE/mf-infra/k8s/base-ingress.yaml" > .preview-temp/ingress.yaml

# Delete existing Ingress if it exists to avoid validation errors
kubectl delete ingress "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE" --ignore-not-found=true

# Apply manifests
kubectl apply -n "$INPUT_NAMESPACE" -f .preview-temp

# Inject services if .env.services exists
if [ -f .env.services ]; then
  echo "🔧 Injecting .env.services"
  
  # Create a temporary file with the env variables
  ENV_FILE=".preview-temp/env.json"
  echo "[" > "$ENV_FILE"
 
  FIRST=true
  ENV_ARGS=()
  while IFS= read -r line; do
    [[ "$line" =~ ^# ]] && continue
    [[ -z "$line" ]] && continue
    KEY=$(echo "$line" | cut -d '=' -f 1)
    VALUE=$(echo "$line" | cut -d '=' -f 2-)
    if [ "$FIRST" = true ]; then FIRST=false; else echo "," >> "$ENV_FILE"; fi
    echo "{\"name\":\"${KEY}\",\"value\":\"${VALUE}\"}" >> "$ENV_FILE"
    ENV_ARGS+=("${KEY}=${VALUE}")
  done < .env.services
  
  echo "]" >> "$ENV_FILE"
  
  # Use kubectl to set the env variables directly
  if [ ${#ENV_ARGS[@]} -gt 0 ]; then
    echo "🔎 Parsed env keys:"
    for kv in "${ENV_ARGS[@]}"; do
      echo "- ${kv%%=*}"
    done

    kubectl set env deployment "$INPUT_SERVICE_NAME" \
      -n "$INPUT_NAMESPACE" \
      --overwrite=true \
      "${ENV_ARGS[@]}"

    echo "🔎 Verifying env injection on deployment..."
    kubectl get deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE" \
      -o jsonpath='{.spec.template.spec.containers[0].env}'
    echo

    if ! kubectl get deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE" \
      -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' \
      | tr ' ' '\n' \
      | grep -qx "BILLING_BACKEND_URL"; then
      echo "❌ BILLING_BACKEND_URL was not found on the deployment after injection"
      exit 1
    fi
  fi
fi

kubectl rollout restart deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE"
echo "✅ Preview deployed"
#
