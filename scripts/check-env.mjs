// scripts/check-env.mjs
//
// Checks that the environment is ready before a deploy or a seed run. Reads .env when present
// (existing environment variables win, like Next.js). It never prints secret values.
//
//   npm run check:env            local or CI check
//   npm run check:env -- --strict   also fail when optional photo storage is missing

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(file) {
  if (!existsSync(file)) return false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith("#")) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
  return true;
}

const strict = process.argv.includes("--strict");
const loaded = loadDotEnv(resolve(process.cwd(), ".env"));
const env = process.env;
const problems = [];
const warnings = [];
const ok = [];

function isPostgresUrl(value) {
  return /^postgres(ql)?:\/\/[^\s]+$/.test(value ?? "");
}

// Database
for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
  if (!env[key]) problems.push(`${key} is not set.`);
  else if (!isPostgresUrl(env[key])) problems.push(`${key} must be a postgresql:// connection string.`);
  else ok.push(`${key} is set.`);
}
if (env.DATABASE_URL && isPostgresUrl(env.DATABASE_URL) && env.DATABASE_URL.includes(":6543") && !/pgbouncer=true/.test(env.DATABASE_URL)) {
  warnings.push("DATABASE_URL uses the Supabase pooler (port 6543). Add ?pgbouncer=true to it.");
}

// Session signing key
const secret = env.AUTH_SECRET ?? "";
if (!secret) problems.push("AUTH_SECRET is not set. Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"");
else if (secret.length < 32) problems.push(`AUTH_SECRET is only ${secret.length} characters. It must be at least 32.`);
else if (/^(changeme|secret|password|replace)/i.test(secret)) problems.push("AUTH_SECRET looks like a placeholder. Generate a random value.");
else ok.push(`AUTH_SECRET is set (${secret.length} characters).`);

// Card terminal
const edcMode = (env.EDC_MODE ?? "simulator").toLowerCase();
if (edcMode !== "simulator" && edcMode !== "bridge") problems.push('EDC_MODE must be "simulator" or "bridge".');
else {
  ok.push(`EDC_MODE is ${edcMode}.`);
  if (edcMode === "bridge") {
    for (const key of ["EDC_BRIDGE_URL", "EDC_BRIDGE_TOKEN", "EDC_WEBHOOK_SECRET"]) {
      if (!env[key]) problems.push(`${key} is required when EDC_MODE=bridge.`);
    }
  }
}

// Photo storage (optional: the till works without it, only photo upload is disabled)
const storageMissing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !env[key]);
if (storageMissing.length === 0) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(env.SUPABASE_URL.trim())) {
    warnings.push("SUPABASE_URL does not look like https://<project-ref>.supabase.co.");
  } else {
    ok.push("Photo storage is configured.");
  }
} else {
  (strict ? problems : warnings).push(`Photo upload is disabled: ${storageMissing.join(" and ")} not set.`);
}

// Seller details printed on full tax invoices. Tax invoices are refused until they are set.
const sellerMissing = ["STORE_LEGAL_NAME", "STORE_TAX_ID", "STORE_ADDRESS"].filter((key) => !env[key]);
if (sellerMissing.length > 0) {
  warnings.push(`Tax invoices are disabled until these are set: ${sellerMissing.join(", ")}.`);
} else if (!/^\d{13}$/.test(env.STORE_TAX_ID.trim())) {
  problems.push("STORE_TAX_ID must be the 13-digit tax ID of the company.");
} else {
  ok.push("Tax invoice seller details are set.");
}

// Seed passwords: needed only the first time an account is created
for (const key of ["ADMIN_PASSWORD", "CASHIER_PASSWORD"]) {
  if (env[key] && env[key].length < 10) warnings.push(`${key} is shorter than 10 characters.`);
}

console.log(loaded ? "Read .env" : "No .env file found; using the process environment.");
for (const line of ok) console.log(`  ok    ${line}`);
for (const line of warnings) console.log(`  warn  ${line}`);
for (const line of problems) console.log(`  FAIL  ${line}`);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) found. Fix them before deploying.`);
  process.exit(1);
}
console.log("\nEnvironment is ready.");
