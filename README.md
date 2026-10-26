# Starlix demo MVP

Starlix is a compliance platform for payment networks. A top-level account (EMoney Plus) onboards PSPs,
watches their customers and correspondents, and acts on risky transactions. This repository is a demo MVP
of the whole system on AWS serverless. It is a TypeScript rewrite of the original Kotlin/Micronaut proof of concept.

Outside integrations are stubbed: KYC, KYB, AML, Companies House and email. Everything else is real:
the hierarchy, onboarding, checks, transaction risk rules, the review workflow, users and the UI.

## Architecture

```
            CloudFront ── S3 (React app + config.json)
                 │
 Browser ── Cognito (sign-in, ID token)
                 │
            API Gateway HTTP API (JWT authorizer)
   ┌────────┬────┴─────┬──────────┬──────────────┬────────┐
 identity clients  onboarding   checks     transactions  files      ← one Lambda per service
   │        │          │          │              │          │
 DynamoDB  DynamoDB  DynamoDB   DynamoDB      DynamoDB     S3        ← one table per service
                 │          │          │              │
                 └──────── EventBridge bus ───────────┘                ← services talk through events
```

| Service | Owns | Main routes |
|---|---|---|
| identity | accounts, branding, Cognito users | `GET /me`, `POST /invites`, `/admin/users`, `/admin/accounts` |
| clients | ROOT → PSP → customer hierarchy, correspondents, registry stub | `/psps`, `/clients/{id}`, `/customers`, `/correspondents`, `/registry/search` |
| onboarding | forms, sections, notes, review, expiry | `/clients/{id}/onboarding`, `/onboarding/{formId}/…` |
| checks | KYC/KYB/AML results per entity (stub providers) | `GET /onboarding/{formId}/checks` |
| transactions | transactions, risk rules, dashboard | `/transactions`, `/transactions/simulate`, `/dashboard` |
| files | presigned S3 upload and download URLs | `/files/upload-url`, `/files/download-url` |
| seed | demo data (invoked by `deploy.sh`) | none |

Events: `OnboardingSubmitted` → checks run → `ChecksCompleted` → onboarding updates status →
`OnboardingStatusChanged` → clients updates the PSP and transactions re-checks its holds.
`TxSettingsChanged` re-checks a customer's transactions. `UserActivated` moves an invited form
to "being filled in". A daily schedule marks approved onboardings as expiring or expired.

Tables use generic keys (`PK`, `SK`, `GSI1–3`) prefixed with `T#<tenant>#`, so one deployment can host
several tenants. A client also stores an "ancestor link" item for every client above it, which lets
the root list every descendant with one query.

Code layout:

```
infra/            CDK app (one stack: Starlix-<stage>)
services/         Lambda handlers, one folder per service
  domain/         pure business rules (onboarding states, risk rules), unit tested
  stubs/          fake KYC/KYB/AML and company registry
  shared/         types, DynamoDB access, HTTP routing, events
scripts/local.ts  the whole backend in one process, for local development
tests/            vitest suites
web/              React + Vite + Tailwind single-page app
deploy.sh         one-command deploy
destroy.sh        removes the stack
```

## Deploy

You need Node.js 20 or newer, npm, the AWS CLI v2 and AWS credentials that can create IAM roles,
Lambda, DynamoDB, API Gateway, Cognito, EventBridge, S3 and CloudFront resources.

```bash
./deploy.sh
```

The script installs dependencies, runs the tests, builds the web app, bootstraps CDK, deploys the stack
and loads the demo data. It then prints the web URL and the demo logins. The first run takes about
10 minutes, most of it CloudFront.

Options (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `AWS_PROFILE` | your default | AWS CLI profile to deploy with |
| `AWS_REGION` | `eu-west-2` | region |
| `STAGE` | `demo` | stack name suffix, so you can deploy several copies |
| `DEMO_PASSWORD` | generated | password for the demo users (12+ chars, upper, lower, digit, symbol) |
| `ADMIN_EMAIL` | `admin@starlix.demo` | email of the platform admin user |
| `SEED` | `true` | load demo data |
| `RESET_DEMO` | `false` | wipe and reload the demo data |
| `RETAIN_DATA` | `false` | keep the tables and files bucket when the stack is deleted |

To remove everything: `./destroy.sh` (add `STAGE=…` if you used one). Tables and buckets are deleted
with the stack unless you deployed with `RETAIN_DATA=true`.

The demo users have permanent passwords, so Cognito sends them no email. Users you add later get
their temporary password by Cognito's built-in email, which is limited to a few emails a day. For more,
connect SES in the user pool settings.

## Demo walkthrough

Sign in with the password printed by `deploy.sh`.

| Login | Sees |
|---|---|
| `compliance@emoneyplus.demo` | the top-level account: dashboard, PSPs, customers, correspondents, transactions, onboarding reviews |
| `ops@clickcash.demo` | one PSP: its own customers, correspondents and transactions |
| `admin@starlix.demo` | platform admin: user management |

The seed creates seven PSPs, each taken through the real onboarding flow:

| PSP | Onboarding | Why |
|---|---|---|
| ClickCash, PayMate, Walletly | Approved | checks passed; each has 3 customers, correspondents and transactions |
| Bluepeak Money | In review | filled in by the PSP itself after an invite, waiting for your decision |
| CreditBond | Checks failed | its director Sophie Fail fails the AML stub |
| DigiCash Services | Expired | approved 13 months ago with a 12 month validity |
| Northwind Remit | Not started | start one yourself |

Things to try:

1. **Dashboard**: transactions on hold and why, PSPs needing attention.
2. **Review an onboarding**: Onboarding → Bluepeak Money → approve, request changes or reject with a note.
3. **Onboard a PSP**: PSPs → Add PSP → search the registry (try "Failsafe" to see failing checks, or
   "Kestrel" for passing ones) → Onboarding tab → start, optionally inviting the PSP by email. The company
   and directors are prefilled from the registry. Submit and watch the checks run.
4. **Transactions**: open a held transaction, upload a supporting document and see it re-checked.
5. **Limits**: Customers → a customer → Transaction limits. Changing them re-checks that customer's transactions.
6. **Simulate**: a customer's overview page creates random incoming or outgoing transactions.
7. **Users**: as the admin, add a user for any client.

### Stub behaviour

| Stub | Behaviour |
|---|---|
| KYC / KYB / AML | a name containing `FAIL` fails, `ERROR` returns a provider error, anything else passes |
| Company registry | 17 fictional UK companies (search by name or number) |
| Email | Cognito's built-in sender, only for invites and new users |

### Transaction risk rules

A transaction is put on hold when any rule fails. Amounts are compared in GBP.

| Rule | Fails when |
|---|---|
| PSP onboarding | the customer's PSP is not approved |
| Amount | above the customer's maximum amount |
| Monthly limits | the month's count or total is above the customer's limit |
| Missing documents | above the "documents required" amount with no supporting document |
| Correspondent | the correspondent's licence has expired |
| Bank jurisdiction | the counterparty bank's country is not in the customer's allowed list |

## Local development

The whole backend can run in one Node process with in-memory data, no AWS needed:

```bash
npm install && (cd web && npm install)
npm run local                  # API on http://localhost:4000, seeded with the demo data
cd web && npm run dev:local    # UI on http://localhost:5173
```

In local mode you sign in with any seeded email and any password. Data resets when the API restarts.

To run the UI against a deployed backend instead, run `cd web && npm run dev` after `./deploy.sh`,
which writes `web/public/config.json`.

Tests and type checks:

```bash
npm test            # vitest: risk rules, onboarding states, end-to-end service flows, seed
npm run build       # backend type check
cd web && npm run build
```

## Differences from the original proof of concept

- MongoDB with a schema per tenant is replaced by DynamoDB with tenant-prefixed keys.
- Micronaut services become one Lambda per service; in-process calls between services become EventBridge events.
- Server-rendered Pebble pages become a React single-page app with the same Tailwind look.
- Session login becomes Cognito, with optional TOTP MFA.
- Dashboard numbers are computed on request rather than kept in a running totals item. That is fine at
  demo volumes; at scale, a stream-fed totals item would replace it.
- Secrets that were hard-coded in the original configuration (MailerSend and Companies House keys) are not
  used here. Rotate them if they were ever real.
