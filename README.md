# mf-infra

Microfrontends infrastructure.

## Links

## mf-frontends

https://github.com/kristjanjansen/mf-frontends

- http://mf-layout-pr-2.localtest.me
- http://mf-navigation-pr-2.localtest.me
- http://mf-dashboard-pr-2.localtest.me
- http://mf-billing-pr-2.localtest.me

## mf-api

https://github.com/kristjanjansen/mf-api

http://mf-api-pr-1.localtest.me

## mf-translations

https://github.com/kristjanjansen/mf-translations

http://mf-translations-pr-1.localtest.me

## mf-infra

https://github.com/kristjanjansen/mf-host-web

http://mf-host-web-pr-10.localtest.me

## Overview

Centralized infrastructure for **multi-repo PR preview environments**.

This repo provides:

- Reusable GitHub Actions:
  - `deploy-preview` – deploy PR preview to Kubernetes
  - `delete-preview` – delete preview namespace on PR close
  - `comment-preview` – PR comment with preview URL
- Shared Kubernetes base manifests (deployment, service, ingress)
- Single-source preview deployment logic
- Local action runner via self-hosted Github Actions runner and OrbStack Kubernetes

## Create service preview

Add `Dockerfile` to your service that exposes port `4000` or similar.

Then add `.github/workflows/preview.yml`:

```yml
name: Preview

on:
  pull_request:
    types: [opened, reopened, synchronize, closed]

jobs:
  preview:
    uses: kristjanjansen/mf-infra/.github/workflows/pr-preview.yml@main
    with:
      service_name: my-service
      port: 4000
```

When creating pull requires with id of `123`, your service will now be available at `https://my-service-pr-123.localtest.me`.

## Local setup on Mac

Install OrbStack:

```bash
brew install orbstack kubectl
```

Run OrbStack:

```bash
orb
```

Verify cluster readiness:

```bash
kubectl get nodes
```

Expected output:

```
orbstack   Ready   control-plane,master   ...
```

### Install NGINX Ingress Controller

Run:

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/baremetal/deploy.yaml
```

Check status:

```bash
kubectl get pods -n ingress-nginx
```

Ingress routing is now enabled for `*.localtest.me` hostnames.

### Set Up a Self-Hosted GitHub Runner

Go to:

> GitHub → Repo → Settings → Actions → Runners → New self-hosted runner

Follow the instructions on each repo that has a preview workflow.

### Set Github Actions Permissions

Go to:

> GitHub → Repo → Settings → Actions → General → Workflow permissions

Select "Read and write permissions".

.
