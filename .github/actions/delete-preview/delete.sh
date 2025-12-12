#!/bin/bash
set -e
echo "🧹 Deleting namespace $INPUT_NAMESPACE"
kubectl delete namespace "$INPUT_NAMESPACE" --ignore-not-found=true
echo "✓ Deleted"
