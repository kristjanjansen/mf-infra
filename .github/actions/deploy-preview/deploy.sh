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
  
  ENV_ARGS=()
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    line=${line#${line%%[![:space:]]*}}
    line=${line%${line##*[![:space:]]}}

    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^# ]] && continue

    if [[ "$line" =~ ^export[[:space:]]+ ]]; then
      line=${line#export }
      line=${line#${line%%[![:space:]]*}}
    fi

    [[ "$line" != *"="* ]] && continue

    KEY=${line%%=*}
    VALUE=${line#*=}
    KEY=${KEY#${KEY%%[![:space:]]*}}
    KEY=${KEY%${KEY##*[![:space:]]}}
    VALUE=${VALUE#${VALUE%%[![:space:]]*}}
    VALUE=${VALUE%${VALUE##*[![:space:]]}}

    if [[ "$VALUE" =~ ^\".*\"$ ]]; then
      VALUE=${VALUE:1:${#VALUE}-2}
    elif [[ "$VALUE" =~ ^\'.*\'$ ]]; then
      VALUE=${VALUE:1:${#VALUE}-2}
    fi

    [[ -z "$KEY" ]] && continue
    ENV_ARGS+=("${KEY}=${VALUE}")
  done < .env.services

  # Use kubectl to set the env variables directly
  if [ ${#ENV_ARGS[@]} -gt 0 ]; then
    kubectl set env deployment "$INPUT_SERVICE_NAME" \
      -n "$INPUT_NAMESPACE" \
      --overwrite=true \
      "${ENV_ARGS[@]}"
  fi
fi

kubectl rollout restart deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE"
echo "✅ Preview deployed"
