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

envsubst < "$GITHUB_WORKSPACE/mfe-infra/k8s/base-deployment.yaml" > .preview-temp/deployment.yaml

envsubst < "$GITHUB_WORKSPACE/mfe-infra/k8s/base-service.yaml" > .preview-temp/service.yaml

envsubst < "$GITHUB_WORKSPACE/mfe-infra/k8s/base-ingress.yaml" > .preview-temp/ingress.yaml

# Delete existing Ingress if it exists to avoid validation errors
kubectl delete ingress "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE" --ignore-not-found=true

# Apply manifests
kubectl apply -n "$INPUT_NAMESPACE" -f .preview-temp

# Copy TLS secret if it exists in ingress-nginx namespace
kubectl get secret mfe-wildcard-tls -n ingress-nginx -o yaml 2>/dev/null \
  | sed "s/namespace: ingress-nginx/namespace: $INPUT_NAMESPACE/" \
  | kubectl apply -f - 2>/dev/null || true

# Copy image pull secret if it exists
kubectl get secret ghcr-pull -n default -o yaml 2>/dev/null \
  | sed "s/namespace: default/namespace: $INPUT_NAMESPACE/" \
  | kubectl apply -f - 2>/dev/null || true

# Patch deployment with image pull secret
kubectl patch deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE" \
  -p '{"spec":{"template":{"spec":{"imagePullSecrets":[{"name":"ghcr-pull"}]}}}}' 2>/dev/null || true

# Load provider config for URL resolution
PROVIDER="${PROVIDER:-local}"
PROVIDER_CONFIG="$GITHUB_WORKSPACE/mfe-infra/k8s/providers/${PROVIDER}/config.env"
if [ -f "$PROVIDER_CONFIG" ]; then
  source "$PROVIDER_CONFIG"
fi
MFE_DOMAIN="${MFE_DOMAIN:-localtest.me}"
PROTOCOL="${PROTOCOL:-http}"

# Inject .env.services with short format resolution
if [ -f .env.services ]; then
  echo "🔧 Resolving .env.services"

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
    KEY=$(echo "$KEY" | xargs)
    VALUE=$(echo "$VALUE" | xargs)

    # Strip quotes
    if [[ "$VALUE" =~ ^\"(.*)\"$ ]]; then VALUE="${BASH_REMATCH[1]}"; fi
    if [[ "$VALUE" =~ ^\'(.*)\'$ ]]; then VALUE="${BASH_REMATCH[1]}"; fi

    [[ -z "$KEY" ]] && continue

    # Check if value is a full URL or a short version
    if [[ "$VALUE" =~ ^https?:// ]]; then
      # Full URL — use as-is
      ENV_ARGS+=("${KEY}=${VALUE}")
      echo "  ${KEY}=${VALUE}"
    else
      # Short format: KEY=version → resolve to URL
      # MFE_API=rel-0.0.0 → service=mfe-api, slug=rel-0-0-0
      SERVICE=$(echo "$KEY" | tr '[:upper:]' '[:lower:]' | tr '_' '-')
      VERSION_SLUG=$(echo "$VALUE" | tr '.' '-')
      URL="${PROTOCOL}://${VERSION_SLUG}--${SERVICE}.${MFE_DOMAIN}"
      ENV_ARGS+=("${KEY}_URL=${URL}")
      echo "  ${KEY}=${VALUE} → ${KEY}_URL=${URL}"
    fi
  done < .env.services

  if [ ${#ENV_ARGS[@]} -gt 0 ]; then
    kubectl set env deployment "$INPUT_SERVICE_NAME" \
      -n "$INPUT_NAMESPACE" \
      --overwrite=true \
      "${ENV_ARGS[@]}"
  fi
fi

# Apply TLS ingress if available
if kubectl get secret mfe-wildcard-tls -n "$INPUT_NAMESPACE" >/dev/null 2>&1; then
  kubectl apply -n "$INPUT_NAMESPACE" -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${INPUT_SERVICE_NAME}
  annotations:
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "*"
    nginx.ingress.kubernetes.io/cors-allow-methods: "GET, OPTIONS"
    nginx.ingress.kubernetes.io/cors-allow-headers: "*"
spec:
  ingressClassName: nginx
  tls:
    - hosts:
        - ${INPUT_HOST}
      secretName: mfe-wildcard-tls
  rules:
    - host: ${INPUT_HOST}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${INPUT_SERVICE_NAME}
                port:
                  number: ${INPUT_PORT}
EOF
fi

kubectl rollout restart deployment "$INPUT_SERVICE_NAME" -n "$INPUT_NAMESPACE"
echo "✅ Preview deployed at ${PROTOCOL}://${INPUT_HOST}"
