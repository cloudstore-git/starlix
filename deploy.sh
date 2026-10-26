#!/usr/bin/env bash
# Deploys the whole Starlix demo to your AWS account and loads the demo data.
#
# Usage:
#   ./deploy.sh                      # deploy stage "demo" to eu-west-2 and seed data
#   AWS_PROFILE=myprofile ./deploy.sh
#   AWS_REGION=eu-west-1 STAGE=test ./deploy.sh
#   DEMO_PASSWORD='Choose-a-Strong-1!' ./deploy.sh
#   RESET_DEMO=true ./deploy.sh      # wipe and reload the demo data
#   SEED=false ./deploy.sh           # infrastructure and UI only
#   RETAIN_DATA=true ./deploy.sh     # keep tables and the files bucket if the stack is deleted
#
# Requirements: Node.js 20+, npm, AWS CLI v2 with credentials that can create IAM roles,
# Lambda, DynamoDB, API Gateway, Cognito, EventBridge, S3 and CloudFront resources.
set -euo pipefail

cd "$(dirname "$0")"

STAGE="${STAGE:-demo}"
export AWS_REGION="${AWS_REGION:-eu-west-2}"
export AWS_DEFAULT_REGION="$AWS_REGION"
SEED="${SEED:-true}"
RESET_DEMO="${RESET_DEMO:-false}"
RETAIN_DATA="${RETAIN_DATA:-false}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@starlix.demo}"
STACK="Starlix-${STAGE}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

step "Checking prerequisites"
command -v node >/dev/null || fail "Node.js 20+ is required (https://nodejs.org)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20+ is required, found $(node -v)"
command -v npm >/dev/null || fail "npm is required"
command -v aws >/dev/null || fail "AWS CLI v2 is required (https://aws.amazon.com/cli/)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || fail "AWS credentials not found. Run 'aws configure' or set AWS_PROFILE."
export CDK_DEFAULT_ACCOUNT="$ACCOUNT"
export CDK_DEFAULT_REGION="$AWS_REGION"
echo "Account $ACCOUNT, region $AWS_REGION, stage $STAGE"

if [ "$SEED" = "true" ] && [ -z "${DEMO_PASSWORD:-}" ]; then
  DEMO_PASSWORD="$(node -e "
    const c=require('crypto');const s=['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnpqrstuvwxyz','23456789','!#%*'];
    let p=s.map(x=>x[c.randomInt(x.length)]).join('');const a=s.join('');
    while(p.length<16)p+=a[c.randomInt(a.length)];console.log(p)")"
  GENERATED_PASSWORD=true
fi

step "Installing dependencies"
npm ci --no-audit --no-fund
(cd web && npm ci --no-audit --no-fund)

step "Running tests"
npm test --silent

step "Building the web app"
(cd web && npm run build)

step "Bootstrapping CDK (safe to repeat)"
npx cdk bootstrap "aws://${ACCOUNT}/${AWS_REGION}" -c stage="$STAGE"

step "Deploying stack ${STACK} (first run takes about 10 minutes, mostly CloudFront)"
npx cdk deploy "$STACK" -c stage="$STAGE" -c retainData="$RETAIN_DATA" --require-approval never --outputs-file cdk-outputs.json

output() { node -p "require('./cdk-outputs.json')['${STACK}']['$1']"; }
WEB_URL="$(output WebUrl)"
API_URL="$(output ApiUrl)"
SEED_FN="$(output SeedFunctionName)"

# Lets 'cd web && npm run dev' talk to the deployed backend
node -e "
  const o=require('./cdk-outputs.json')['${STACK}'];
  require('fs').writeFileSync('web/public/config.json', JSON.stringify({apiUrl:o.ApiUrl,region:o.Region,userPoolId:o.UserPoolId,userPoolClientId:o.UserPoolClientId,stage:'${STAGE}'},null,2));"

if [ "$SEED" = "true" ]; then
  step "Loading demo data"
  PAYLOAD="$(node -e "console.log(JSON.stringify({reset: process.argv[1]==='true', demoPassword: process.argv[2], adminEmail: process.argv[3]}))" "$RESET_DEMO" "$DEMO_PASSWORD" "$ADMIN_EMAIL")"
  aws lambda invoke --function-name "$SEED_FN" --cli-binary-format raw-in-base64-out \
    --payload "$PAYLOAD" --cli-read-timeout 300 seed-result.json >/dev/null
  cat seed-result.json; echo
  rm -f seed-result.json
fi

step "Done"
cat <<MSG
Starlix is live:
  Web app:  ${WEB_URL}
  API:      ${API_URL}
MSG
if [ "$SEED" = "true" ]; then
  cat <<MSG

Demo logins (all share one password):
  compliance@emoneyplus.demo   top-level account (EMoney Plus): PSPs, customers, transactions, reviews
  ops@clickcash.demo           a PSP user (ClickCash Ltd)
  ${ADMIN_EMAIL}          platform admin: user management
MSG
  if [ "${GENERATED_PASSWORD:-false}" = "true" ]; then
    echo "  Password: ${DEMO_PASSWORD}   (generated; set DEMO_PASSWORD to choose your own)"
  else
    echo "  Password: the DEMO_PASSWORD you set"
  fi
fi
echo
echo "If the web app shows an old version, CloudFront may need a minute to refresh."
