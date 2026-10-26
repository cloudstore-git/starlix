#!/usr/bin/env bash
# Removes the Starlix demo stack and all its data (tables, files, users).
set -euo pipefail
cd "$(dirname "$0")"
STAGE="${STAGE:-demo}"
export AWS_REGION="${AWS_REGION:-eu-west-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
read -r -p "Delete stack Starlix-${STAGE} in ${AWS_REGION} and all its data? Type the stage name to confirm: " answer
[ "$answer" = "$STAGE" ] || { echo "Cancelled."; exit 1; }
npm ci --no-audit --no-fund
npx cdk destroy "Starlix-${STAGE}" -c stage="$STAGE" --force
