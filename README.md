# OpenWA

WhatsApp + AI multi-tenant platform.

## Services

- **openwa-web** — Next.js 15 dashboard + API (this repo root)
- **openwa-gateway** — Node worker with open-wa (M2, `gateway/`)

## Quick start

```bash
cp .env.example .env.local
# fill in real values
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

## Environment

See `.env.example` for required variables.

## Build verification (dummy env)

```bash
DATABASE_URL="postgresql://dummy@localhost:5432/db" \
ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000" \
NEXTAUTH_SECRET="dev" \
BEDROCK_REGION="eu-central-1" \
npx next build
```

## Tests

```bash
npx vitest run
```
