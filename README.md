# Micofrontends infra

Centralized infrastructure for **multi-repo PR preview environments**.

This repo provides:

- Reusable GitHub Actions:
  - `deploy-preview` – deploy PR preview to Kubernetes
  - `delete-preview` – delete preview namespace on PR close
  - `comment-preview` – sticky PR comment with preview URL
- Shared Kubernetes base manifests (deployment, service, ingress)
- Single-source preview deployment logic
- Local testing via [`act`](https://github.com/nektos/act) + OrbStack Kubernetes

## Setup for service providers

Add `.github/workflows/preview.yml`

```yml
name: Preview

on:
  pull_request:
    types: [opened, reopened, synchronize, closed]

jobs:
  preview:
    uses: kristjanjansen/mf-infra/.github/workflows/preview.yml@main
    with:
      service_name: servicename
      port: 3000
```

### Setup for service consumers

Add `.github/workflows/preview.yml`

```yml
name: Preview

on:
  pull_request:
    types: [opened, reopened, synchronize, closed]

jobs:
  preview:
    uses: kristjanjansen/mf-infra/.github/workflows/preview.yml@main
    with:
      service_name: consumername
      port: 3000
```

Add `.env.services`

```env
SERVICE_URL=https://servicename-pr-12.localtest.me
```

## Local setup on Mac

### Install OrbStack & Enable Kubernetes

OrbStack provides a lightweight Kubernetes cluster with perfect macOS integration.

Install OrbStack:

```bash
brew install orbstack kubectl act
```

Enable Kubernetes:

```bash
orb kube enable
```

Verify cluster readiness:

```bash
kubectl get nodes
```

Expected output:

```
orbstack-control-plane   Ready   control-plane   ...
```

You now have a working local Kubernetes cluster.

### Install NGINX Ingress Controller

Preview URLs such as `https://servicename-pr-12.localtest.me` require an ingress controller. OrbStack does not ship one by default.

Install NGINX Ingress:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/baremetal/deploy.yaml
```

Check status:

```bash
kubectl get pods -n ingress-nginx
```

Wait until all pods are running.

Ingress routing is now enabled for `*.localtest.me` hostnames.

### Set Up a Self-Hosted GitHub Runner

Go on each repo that has a preview workflow:

```
GitHub → Repo → Settings → Actions → Runners → New self-hosted runner
```

Choose:

- macOS
- architecture: arm64 (Apple Silicon)

Prepare local directory:

```bash
mkdir servicename-runner
cd servicename-runner
```

Download runner files (via GitHub UI) and configure:

```bash
./config.sh --url https://github.com/<ORG>/<REPO> \
 --token <YOUR_RUNNER_TOKEN>
```

Start runner:

```bash
./run.sh
```

Leave it running.

### Set up arc

For each repo that has a preview workflow, add the `.arcrc` file:

```bash
-P ubuntu-latest=ghcr.io/catthehacker/ubuntu:act-latest
--container-architecture linux/amd64
--bind $HOME/.kube:/root/.kube
--pull=false
```

Then run:

```bash
act pull_request
```
