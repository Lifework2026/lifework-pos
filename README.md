# Lifework POS

Point-of-sale and back-office for a Thai fashion-retail branch (Mega Bangna). Next.js 14 (App Router), Prisma 6, Supabase Postgres, Tailwind v4. Thai and English throughout (default Thai, switch in the header).

## What is in it

**Till (`/pos`)** — shift open/close with a declared cash float, product grid with photos and category tabs, barcode scanner and search, cart with shopping bags, member lookup and points, promotions and codes, split payments (cash, card/EDC, PromptPay QR, bank transfer), receipt preview (store code, branch, staff), hold and resume bills, and manager-only itemized refunds and full voids that restore stock and reverse points automatically.

**Back-office (`/admin`, managers and admins)**

| Page | What it does |
| --- | --- |
| Dashboard | Daily and monthly sales, hourly/daily chart, split by payment method, stock alerts, one-click Excel/CSV exports |
| Sales | Order list, receipts, refunds and voids |
| Shifts | Every cash-drawer session: float, expected cash, counted cash, over/short; manager review and sign-off; force-close a forgotten shift; export |
| Products | Search, create, edit, delete or deactivate; sizes, colors, prices, barcodes; photo upload |
| Products > Import | Excel/CSV bulk import with a downloadable template, a dry-run check, and an all-or-nothing commit |
| Stock / Receive | Stock overview; receive shipments and post adjustments with a reason (damaged, lost, count correction, found, other) |
| Stock history | The full stock ledger: every sale, refund, void, restock and adjustment with exact time, quantity, reason and staff member; filters and export |
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
3. Run `npm run db:migrate` against the production database before the new version goes live, and again whenever a migration is added. Checkout needs the shift tables, so deploying code before its migration breaks selling.
4. Check `GET /api/health` after deploy.

## Tests

```bash
npm test          # pricing engine, catalogue import/storage, cash-drawer maths and role-guard tests
npx tsc --noEmit  # typecheck
npm run build     # production build
```

## Shifts and cash

A cashier opens a shift by declaring the starting cash in the drawer; nothing can be sold until a shift is open, and every receipt is tied to the shift that rang it up. At the end the cashier counts the drawer and declares the total. The count is blind: the expected amount is only shown after closing.

    expected cash = starting float
                  + cash taken on the shift's sales (net of change given)
                  - cash refunded to customers from this drawer
                  - cash returned on bills voided from this drawer

The expected amount is computed on the server from the receipts, never sent by the browser. A difference (over or short) needs a written note. The closing figures and a per-channel summary are saved on the shift, an audit entry is written, and managers review each closed shift under **Shifts**. Refunds and voids are paid from the drawer of the shift that took the sale if it is still open, otherwise from the acting user's open shift, otherwise from the most recently opened shift. If cash has to be paid back and no shift is open, the refund or void is refused so the cash is never unrecorded. Each user can have one open shift at a time (enforced by the database).

## Stock ledger

Every stock change writes a row to `InventoryMovement` in the same transaction as the change itself: `SALE`, `RETURN` (refund), `VOID`, `STOCK_IN` (restock, opening stock, import) and `ADJUSTMENT`. Each row stores the variant, quantity change, stock before and after, the receipt or supplier reference, a note (for refunds and voids, the reason given), a reason code for manual adjustments, the staff member, and the exact time. **Stock history** shows and exports them; it also warns if a variant's stock no longer matches its last ledger entry (stock changed outside the app).

## Printing receipts (80mm thermal)

The Print button renders the receipt into a separate `#print-root` element and the print stylesheet removes everything else from the page, so no buttons or navigation reach the paper and no blank pages are fed out. Set up the printer once:

1. Install the thermal printer's driver and set its default paper to the 80mm roll (for example "80mm x Receipt"). A browser cannot request "80mm wide, any height" from CSS, so the roll size comes from the driver.
2. In the browser's print dialog choose that printer, scale 100%, margins none, and turn off headers and footers. The page already asks for no margin.
3. For one-click printing, start Chrome or Edge with `--kiosk-printing` so the dialog is skipped.

## Master data and catalog codes

Categories and colours have a **code** that spreadsheets use, for example `CAT-SHIRT` or `COL-BLK`. Codes are unique, upper case, 2 to 20 letters, digits or dashes. Edit them under **สินค้า → หมวดหมู่และไซซ์** (categories) and **สี** (colours).

- Template A refers to a category and a colour only by code (`Category_Code`, `Color_Code`). Both are required. A code that is not in the database refuses that row, and the message names the code.
- Template A includes a **Master_Data_Codes** sheet listing every current category and colour, so the codes can be copied exactly.
- Products store a link to their colour. Renaming a colour renames it on every variant. A colour or category still in use cannot be deleted.

## Excel bulk actions

**Excel bulk actions** (managers) has three spreadsheets. Download each template, fill it in, press **Check file**, then **Import**. Nothing is saved until the check passes.

- **A. New products:** `Barcode, SKU, Name_TH, Name_EN, Category, Size, Price, Cost, Initial_Stock, Promo_Tag`. Creates products, sizes and categories that do not exist yet.
- **B. Price and promo update:** `Barcode, New_Price, Promo_Tag`, matched by barcode. Blank cells keep the current value. Each change is written to the audit log.
- **C. Stock in and out:** `Barcode, Quantity_Change, Reason`. Reason `Restock` (above 0), `Damage` (below 0) or `Count` (non-zero). Each row is written to the stock history with its reason. A row that would take stock below zero stops the whole file.

Row 2 of each template is an example with an `EXAMPLE-` barcode. Every importer refuses that row, so it cannot be imported by accident.

**Product photos:** photos are stored in the Supabase Storage bucket named by `SUPABASE_STORAGE_BUCKET` (default `product-images`). To use another name, such as `products`, create the public bucket in Supabase Storage and set the variable to that name. `supabase/storage.sql` creates the default bucket.

## Tax invoices (ใบกำกับภาษีเต็มรูป)

Managers issue a full tax invoice from **Sales → detail → ใบกำกับภาษี**. The buyer's name, branch (00000 for head office or a 5-digit branch number), address and 13-digit tax ID are required, and the tax ID's check digit is verified before sending. Each sale gets one invoice, numbered `TI-YYYYMM-NNNNN` (restarts each month), and the invoice is printed on A4 with the VAT split out of the VAT-inclusive total. Voided sales cannot be invoiced.

Set the company's own details on the host before issuing (they are printed on every invoice and are not stored in the repository):

- `STORE_LEGAL_NAME`, `STORE_TAX_ID` (13 digits), `STORE_BRANCH_NO` (default `00000`), `STORE_ADDRESS`

Issuing is refused until these are set. Refunds after an invoice is issued need a credit note (ใบลดหนี้), which this version does not produce.

**VAT assumption:** shelf prices are treated as VAT-inclusive at 7%, so VAT = total × 7 / 107. The accountant must confirm this before the figures are filed.

## Daily close (EOD / Z-report)

**Daily close (EOD)** (managers) shows, for one store day: net sales, VAT, cash and card totals, other channels, refunds, voids, tax invoices issued, and the over/short total across the day's closed shifts. It warns while any shift is still open and marks the day ready to file only when every shift is closed. **Export (Excel / CSV)** produces the summary and a row per shift for the accounting department.

## Offline guard

A red banner (`No Internet Connection - System Paused`) appears when the browser loses its connection. Payment, cart checkout, void, refund, tax invoice and shift buttons are disabled until it returns, so no transaction starts that would only time out.

## Roles and access

| | Cashier | Manager / Admin |
| --- | --- | --- |
| Till: sell, hold and resume bills | yes | yes |
| Open and close own shift | yes | yes |
| Member lookup at the till | yes | yes |
| Register a new member | no | yes |
| Record a card payment by typing the terminal reference (manual entry) | no | yes |
| Sign out | only after closing the open shift | yes |
| Back-office pages, dashboards, exports | no | yes |
| Refunds and voids | no | yes |
| Stock receive and adjustments, catalogue, import | no | yes |
| Members admin and point adjustments, promotions | no | yes |
| Review shifts, close someone else's shift | no | yes |

Sign-out is refused while the user has an open cash-drawer shift. The till then asks for the shift to be closed and the cash declared first.

Access is enforced three times: the middleware sends cashiers away from `/admin` and answers `/api/admin` with 403; every `/api/admin` handler checks for a manager itself (`requireManager`, which re-reads the role from the database, so a demoted or deactivated account loses access immediately even with a valid session); and a unit test fails the build if an admin handler is added without that check.
