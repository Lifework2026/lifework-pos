# Lifework POS

Point-of-sale and back-office for a Thai fashion-retail branch (Mega Bangna). Next.js 14 (App Router), Prisma 6, Supabase Postgres, Tailwind v4. Thai and English throughout (default Thai, switch in the header).

## What is in it

**Till (`/pos`)** — product grid with photos and category tabs, barcode scanner and search, cart with shopping bags, member lookup and points, promotions and codes, split payments (cash, card/EDC, PromptPay QR, bank transfer), receipt preview (store code, branch, staff), hold and resume bills, and manager-only itemized refunds and full voids that restore stock and reverse points automatically.

**Back-office (`/admin`, managers and admins)**

| Page | What it does |
| --- | --- |
| Dashboard | Daily and monthly sales, hourly/daily chart, split by payment method, stock alerts, one-click Excel/CSV exports |
| Sales | Order list, receipts, refunds and voids |
| Products | Search, create, edit, delete or deactivate; sizes, colors, prices, barcodes; photo upload |
| Products > Import | Excel/CSV bulk import with a downloadable template, a dry-run check, and an all-or-nothing commit |
| Stock / Receive | Stock overview; receive shipments and post adjustments (every change is logged to the stock ledger) |
| Categories & sizes | Add, rename, reorder and delete categories and sizes |
| Members | Member list, edit, spend, manual point adjustments with a reason |
| Promotions | Percent or baht discounts, whole bill or one category, minimum spend, dates, optional code |

## Setup

```bash
npm install
cp .env.example .env     # then fill in the values
npm run check:env        # validates the environment, never prints secrets
npm run db:migrate       # applies prisma/migrations to DIRECT_URL
ADMIN_PASSWORD=... CASHIER_PASSWORD=... npm run db:seed
npm run dev
```

### Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Supabase pooled connection (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | yes | Supabase direct connection (port 5432), used by migrations |
| `AUTH_SECRET` | yes | 32+ random characters. Sessions are signed with it |
| `EDC_MODE` | no | `simulator` (default) or `bridge` |
| `EDC_BRIDGE_URL`, `EDC_BRIDGE_TOKEN`, `EDC_WEBHOOK_SECRET` | with `bridge` | Card terminal bridge |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | for photos | Server-side only. Without them the till works and photo upload is disabled |
| `SUPABASE_STORAGE_BUCKET` | no | Defaults to `product-images` |
| `ADMIN_PASSWORD`, `CASHIER_PASSWORD` | seed only | Needed the first time each account is created; setting one later changes that password |

Generate a signing key:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Seed

`npm run db:seed` only creates missing rows and never overwrites prices, stock, names or sales, so it is safe against a live database. It creates the `admin` (ADMIN role) and `cashier` (CASHIER role) accounts, the shopping-bag items, a small demo catalogue, Thai names, and the default size list. Passwords come from the environment and are never stored in the repository.

### Product photos

Photos live in a public-read Supabase Storage bucket (`product-images`). Uploads go through the server (`/api/admin/uploads/product-image`) with the service-role key, after an admin check and a byte-signature check (JPEG, PNG or WebP, 2 MB max; the browser shrinks large photos first). The bucket is created on first upload, or run `supabase/storage.sql` in the SQL editor. A product can only point at images inside this bucket.

### Importing products

Download the template from **Products > Import**. Columns: `SKU`, `Name`, `Category`, `Size`, `Price`, `Stock` (colour, brand, barcode and Thai names are optional, in any order). The file is checked first and every problem is listed by row; if anything is wrong nothing is imported. You choose what happens when a SKU already exists (skip, or update price and details) and whether stock is set from the file (recorded as a stock adjustment). Up to 2000 rows per file, `.xlsx` or UTF-8 `.csv` (with or without a BOM).

## Database

Schema changes are real migrations in `prisma/migrations` (`0_baseline` captures the original schema).

```bash
npm run db:migrate                          # production and CI: prisma migrate deploy
npx prisma migrate dev --name <change>      # local: create a new migration
```

## Deploying on Vercel

1. Add the environment variables above under Project Settings > Environment Variables (Production).
2. `npm run build` runs `prisma generate` and `next build`.
3. Run `npm run db:migrate` once against the production database (and again whenever a new migration is added).
4. Check `GET /api/health` after deploy.

## Tests

```bash
npm test          # pricing engine and catalogue import/storage unit tests
npx tsc --noEmit  # typecheck
npm run build     # production build
```

## Roles

- **CASHIER**: the till, including hold and resume.
- **MANAGER / ADMIN**: back-office, refunds and voids, catalogue, members, promotions, exports.
