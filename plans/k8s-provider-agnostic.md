# Plan: Provider-Agnostic Kubernetes Setup

## Goal

Make the K8s infrastructure portable across providers instead of being tied to local OrbStack. Target providers: **local OrbStack**, **DigitalOcean Kubernetes (DOKS)**, with a clean path for adding more.

## Current State

What's already generic:
- Base manifests (`k8s/base-deployment.yaml`, `base-service.yaml`, `base-ingress.yaml`) are pure K8s with `${VAR}` placeholders
- NGINX Ingress Controller is a standard choice
- Namespace-per-preview isolation is portable
- Event recording and dashboard are application-level, no K8s dependency

What's OrbStack-specific:
- **Runners**: Workflows use `self-hosted` runners (OrbStack machine)
- **DNS**: Hardcoded `localtest.me` hostnames (OrbStack's wildcard DNS)
- **TLS**: No TLS — `http://` only, fine for local, not for cloud
- **Docker images**: Built locally, not pushed to a registry
- **kubeconfig**: Implicitly uses OrbStack's local cluster

## Changes

### 1. Provider Configuration Layer

Create a `providers/` directory with per-provider config:

```
k8s/
  providers/
    local/
      config.env        # DOMAIN=localtest.me, TLS=false, REGISTRY=local, ...
      ingress-patch.yaml  # (if needed)
    digitalocean/
      config.env        # DOMAIN=mfe.fachwerk.dev, TLS=true, REGISTRY=ghcr.io/...
      ingress-patch.yaml  # cert-manager annotations, DO-specific LB config
```

Each `config.env` exports:
- `DOMAIN` — base domain for ingress hosts
- `TLS_ENABLED` — whether to add TLS block to ingress
- `REGISTRY` — container registry prefix (empty for local, full URL for cloud)
- `RUNNER_LABEL` — GitHub Actions runner label (`self-hosted` vs provider-specific)

### 2. Ingress TLS Support

Update `base-ingress.yaml` to conditionally include TLS:
- Add a `base-ingress-tls.yaml` variant (or use kustomize overlay)
- For DigitalOcean: add cert-manager annotations for Let's Encrypt
- For local: keep as-is (no TLS)

### 3. Container Registry

Currently images are built and used locally (OrbStack). For cloud:
- Add a `docker push` step to `deploy.sh` when `REGISTRY` is set
- Tag images as `${REGISTRY}/${SERVICE_NAME}:${TAG}`
- Update `base-deployment.yaml` image reference accordingly
- For local: keep current behavior (build = available to local cluster)

### 4. Workflow Runner Abstraction

In `pr-preview.yml` and `release-preview.yml`:
- Replace hardcoded `self-hosted` with a workflow input or variable
- DigitalOcean option: use GitHub-hosted runners + doctl CLI + remote kubeconfig
- Local option: keep self-hosted runners on OrbStack

### 5. DNS / Domain Strategy

| Provider | Domain | How |
|----------|--------|-----|
| Local OrbStack | `*.localtest.me` | OrbStack DNS (resolves to 127.0.0.1) |
| DigitalOcean | `*.mfe.fachwerk.dev` | Wildcard DNS A record pointing to DO load balancer IP |

Update `deploy.sh` to construct hostname from `$DOMAIN` variable instead of hardcoding `localtest.me`.

### 6. Deploy Script Changes (`deploy.sh`)

Current flow: envsubst -> kubectl apply. New flow:

```
1. Source provider config.env
2. If REGISTRY is set: docker tag + push
3. Construct HOST from SERVICE_NAME + NAMESPACE_SUFFIX + DOMAIN
4. envsubst on base manifests
5. If TLS_ENABLED: also apply TLS ingress variant
6. kubectl apply (using KUBECONFIG from provider)
```

### 7. Kubeconfig Management

- Local: implicit (OrbStack sets default context)
- DigitalOcean: `doctl kubernetes cluster kubeconfig save <cluster>` in workflow, or store as GitHub secret `KUBECONFIG_DO`
- Use `KUBECONFIG` env var to switch contexts

### 8. Rename `mf` to `mfe` Everywhere

Rename the `mf-` prefix to `mfe-` across the entire project:
- Repository names (`mf-frontends` -> `mfe-frontends`, `mf-host-web` -> `mfe-host-web`, etc.)
- GitHub Actions workflows and composite actions
- K8s namespaces, service names, ingress hosts
- Web Component tag names (`<mf-billing>` -> `<mfe-billing>`)
- Docker image names and build args
- Environment variable prefixes (`VITE_MF_*` -> `VITE_MFE_*`, `EXPO_PUBLIC_MF_*` -> `EXPO_PUBLIC_MFE_*`)
- CSS classes, config keys, directory names (`src/apps/mf-*`)
- Self-hosted runner directories and scripts
- Dashboard datasets and event records
- Domain: `*.mfe.fachwerk.dev`

## Migration Order

0. Rename `mf` to `mfe` across all repos, tags, env vars, configs, and domains
1. Extract current hardcoded values into `providers/local/config.env` — no behavior change
2. Update `deploy.sh` and `delete.sh` to read from config.env
3. Update workflow files to parameterize runner label
4. Add `providers/digitalocean/config.env` with real domain + registry
5. Add registry push step (conditional on REGISTRY being set)
6. Add TLS ingress variant
7. Test on DigitalOcean

## Decisions

- **Domain**: `*.mfe.fachwerk.dev` — wildcard A record pointing to the DO load balancer, zero per-PR DNS config. Preview URLs like `mfe-billing-pr-3.mfe.fachwerk.dev`.
- **Registry**: **ghcr.io** — already on GitHub for source/runners/Actions, authenticates with the existing `GITHUB_TOKEN` (no extra secrets), avoids DO registry pricing, and keeps the setup provider-agnostic.
- **Cert manager**: **cert-manager + Let's Encrypt** — K8s-native, works identically across providers. A single wildcard cert (`*.mfe.fachwerk.dev`) covers all previews. DO-managed certs are tied to their load balancer and wouldn't transfer.
- **Cost**: **Always-on smallest DOKS cluster** (single-node basic droplet, ~$12/mo). Spin-up/down per PR adds latency and orchestration complexity. Clean up idle namespaces instead (already deleting on PR close).
- **Third provider**: **Hetzner** is the natural next target — cheapest K8s in Europe, same NGINX ingress + cert-manager stack works unchanged. AWS/GKE add IAM complexity without clear benefit for preview environments. The provider config layer supports adding them later if needed.

## Setup Script

Nearly everything can be automated via `doctl`, `gh`, and `kubectl`. Only the DO API token creation is manual (requires web UI for security).

### Prerequisites

```bash
# One manual step: create a DO API token at https://cloud.digitalocean.com/account/api/tokens
# Then authenticate:
doctl auth init --access-token <YOUR_TOKEN>
gh auth login
```

### DigitalOcean + K8s Setup

```bash
# Create DOKS cluster (single node, smallest size)
doctl kubernetes cluster create mfe-preview \
  --region fra1 \
  --node-pool "name=default;size=s-1vcpu-2gb;count=1"

# Save kubeconfig (also sets kubectl context)
doctl kubernetes cluster kubeconfig save mfe-preview

# Install NGINX Ingress Controller (creates a DO Load Balancer automatically)
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/do/deploy.yaml

# Wait for Load Balancer IP
kubectl get svc -n ingress-nginx ingress-nginx-controller -w

# Get the external IP
LB_IP=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Ensure domain is registered in DO DNS (no-op if already there)
doctl compute domain create fachwerk.dev 2>/dev/null || true

# Add wildcard DNS record: *.mfe.fachwerk.dev -> LB IP
doctl compute domain records create fachwerk.dev \
  --record-type A \
  --record-name "*.mfe" \
  --record-data "$LB_IP" \
  --record-ttl 300

# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.17.2/cert-manager.yaml

# Store DO token as K8s secret for cert-manager DNS-01 challenge
kubectl create namespace cert-manager 2>/dev/null || true
kubectl create secret generic digitalocean-dns \
  --from-literal=access-token=<YOUR_TOKEN> \
  -n cert-manager

# Create Let's Encrypt ClusterIssuer with DNS-01 challenge
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: <YOUR_EMAIL>
    privateKeySecretRef:
      name: letsencrypt-account-key
    solvers:
      - dns01:
          digitalocean:
            tokenSecretRef:
              name: digitalocean-dns
              key: access-token
EOF
```

### GitHub Setup

```bash
GH_ORG=<your-org-or-user>
DO_TOKEN=<YOUR_TOKEN>
KUBECONFIG_B64=$(doctl kubernetes cluster kubeconfig show mfe-preview | base64)

# Rename repos
for repo in mf-frontends mf-host-web mf-host-expo mf-api mf-translations mf-infra; do
  gh repo rename "${repo/mf-/mfe-}" --repo "$GH_ORG/$repo" --yes
done

# Update local remotes
for dir in mf-*; do
  new_name="${dir/mf-/mfe-}"
  git -C "$dir" remote set-url origin "git@github.com:$GH_ORG/$new_name.git"
done

# Set secrets on each repo
for repo in mfe-frontends mfe-host-web mfe-host-expo mfe-api mfe-translations mfe-infra; do
  gh secret set DIGITALOCEAN_ACCESS_TOKEN --body "$DO_TOKEN" --repo "$GH_ORG/$repo"
  gh secret set KUBECONFIG_DO --body "$KUBECONFIG_B64" --repo "$GH_ORG/$repo"
done

# Enable GITHUB_TOKEN write permissions (needed for ghcr.io push)
for repo in mfe-frontends mfe-host-web mfe-host-expo mfe-api mfe-translations mfe-infra; do
  gh api -X PUT "repos/$GH_ORG/$repo/actions/permissions/workflow" \
    -f default_workflow_permissions=write
done
```
