// The nightly backup: what the workflow and script promise (static checks), and a real run of the script with stand-ins
// for pg_dump, pg_restore and aws, using the real gpg. Run with: npx tsx tests/backup.test.ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
let skipped = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

const root = path.join(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const toolAvailable = (cmd: string) => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
const canRun = toolAvailable("bash") && toolAvailable("gpg");

const PASSPHRASE = "test-passphrase-not-a-real-one-1234";
const DUMP_TEXT = "pretend pg_dump output: tables and rows\n";

/** Stand-in commands written as shell scripts. They record what they were asked and use a folder as the "bucket". */
function writeStubs(dir: string, bucket: string): void {
  const files: Record<string, string> = {
    pg_dump: `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then echo "\${FAKE_PG_DUMP_VERSION:-pg_dump (PostgreSQL) 17.6 (Ubuntu 17.6-1.pgdg24.04+1)}"; exit 0; fi
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) out="$2"; shift 2 ;;
    --dbname) url="$2"; shift 2 ;;
    *) args="$args $1"; shift ;;
  esac
done
echo "$url" > "${dir}/pg_dump.url"
echo "$args" > "${dir}/pg_dump.args"
printf '%s' "$FAKE_DUMP_TEXT" > "$out"
`,
    pg_restore: `#!/usr/bin/env bash
if [ "$1" = "--list" ]; then
  if [ "$FAKE_EMPTY_DUMP" = "1" ]; then echo "; no data"; else echo "1; 0 0 TABLE DATA public Product postgres"; echo "2; 0 0 TABLE DATA public Order postgres"; fi
  exit 0
fi
out=""; while [ $# -gt 0 ]; do case "$1" in --dbname) out="$2"; shift 2 ;; *) shift ;; esac; done
echo "restored into $out" > "${dir}/pg_restore.log"
`,
    aws: `#!/usr/bin/env bash
echo "$@" >> "${dir}/aws.calls"
if [ "$1" = "s3" ] && [ "$2" = "cp" ]; then
  cp "$3" "${bucket}/$(basename "$4")"
  exit 0
fi
if [ "$1" = "s3api" ] && [ "$2" = "head-object" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "--key" ] && key="$2"; shift; done
  if [ "$FAKE_SHORT_UPLOAD" = "1" ]; then echo 1; else wc -c < "${bucket}/$(basename "$key")" | tr -d ' '; fi
  exit 0
fi
exit 1
`,
  };
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    writeFileSync(file, body, { mode: 0o755 });
    chmodSync(file, 0o755);
  }
}

interface Run {
  status: number | null;
  output: string;
  dir: string;
  bucket: string;
}

function runBackup(overrides: Record<string, string> = {}, remove: string[] = []): Run {
  const dir = mkdtempSync(path.join(os.tmpdir(), "backup-test-")).split("\\").join("/");
  const bucket = path.join(dir, "bucket");
  mkdirSync(bucket);
  writeStubs(dir, bucket);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_DUMP_TEXT: DUMP_TEXT,
    BACKUP_DATABASE_URL: "postgresql://postgres.abc:secret-db-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    BACKUP_PASSPHRASE: PASSPHRASE,
    BACKUP_S3_BUCKET: "my-backups",
    AWS_ACCESS_KEY_ID: "AKIATESTONLY",
    AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
    AWS_REGION: "ap-southeast-1",
    ...overrides,
  };
  for (const name of remove) delete env[name];
  const result = spawnSync("bash", [path.join(root, "scripts", "backup", "db-backup.sh")], { env, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, dir, bucket };
}

(async () => {
  await test("workflow: runs every night and on demand, with read-only repository access", () => {
    const yml = read(".github/workflows/db-backup.yml");
    assert.match(yml, /schedule:\s*\n\s*- cron: "0 19 \* \* \*"/, "02:00 Bangkok = 19:00 UTC");
    assert.ok(yml.includes("workflow_dispatch:"), "can be started by hand to test it");
    assert.match(yml, /permissions:\s*\n\s*contents: read/);
    assert.ok(yml.includes("timeout-minutes:") && yml.includes("concurrency:"));
  });

  await test("workflow: installs PostgreSQL 17, points every client tool at it, and fails if pg_dump is not 17", () => {
    const yml = read(".github/workflows/db-backup.yml");
    assert.ok(yml.includes("postgresql-client-17"));
    for (const tool of ["pg_dump", "pg_restore", "psql"]) assert.ok(yml.includes(tool));
    assert.ok(yml.includes("/usr/lib/postgresql/17/bin") && yml.includes('ln -sf "/usr/lib/postgresql/17/bin/${tool}" "/usr/local/bin/${tool}"'));
    assert.ok(yml.includes('>> "$GITHUB_PATH"') && yml.includes("pg_dump --version"));
    assert.ok(yml.includes('grep -q "(PostgreSQL) 17\\."'), "the step fails unless pg_dump reports 17");
    assert.ok(yml.indexOf("Use the PostgreSQL 17 client") < yml.indexOf("Dump, encrypt and upload"), "the check runs before the dump");
  });

  await test("workflow: every secret reaches the script through env, never inline in a command", () => {
    const yml = read(".github/workflows/db-backup.yml");
    // Every line of a `run:` step: the one-line form, and the indented body of the `run: |` form.
    const runLines: string[] = [];
    let blockIndent = -1;
    for (const line of yml.split("\n")) {
      const indent = line.length - line.trimStart().length;
      if (blockIndent >= 0 && (line.trim() === "" || indent > blockIndent)) {
        runLines.push(line);
        continue;
      }
      blockIndent = -1;
      const match = /^(\s+)run:\s*(.*)$/.exec(line);
      if (!match) continue;
      runLines.push(match[2]);
      if (match[2] === "|") blockIndent = match[1].length;
    }
    assert.ok(runLines.length > 5, "the run steps were found");
    assert.ok(!runLines.some((l) => l.includes("secrets.")), "no secret is written into a shell command");
    for (const name of ["BACKUP_DATABASE_URL", "BACKUP_PASSPHRASE", "BACKUP_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"]) {
      assert.match(yml, new RegExp(`${name}: \\$\\{\\{ secrets\\.`), `${name} comes from a secret`);
    }
  });

  await test("script: dumps the public schema in custom format, encrypts with AES-256, and never traces commands", () => {
    const sh = read("scripts/backup/db-backup.sh");
    assert.ok(sh.startsWith("#!/usr/bin/env bash") && sh.includes("set -euo pipefail"));
    assert.ok(sh.includes("--format=custom") && sh.includes("--schema=public"));
    assert.ok(sh.includes("--cipher-algo AES256") && sh.includes("--symmetric"));
    assert.ok(!/set -[a-z]*x/.test(sh), "set -x would print secrets");
    assert.ok(!/aws s3 (rm|sync)|s3api delete|rm -rf \//.test(sh), "the script deletes nothing in storage");
  });

  await test("repository: LF line endings are forced for shell scripts and dumps are ignored by git", () => {
    assert.ok(read(".gitattributes").includes("*.sh text eol=lf"));
    const ignore = read(".gitignore");
    assert.ok(ignore.includes("*.dump") && ignore.includes("*.dump.gpg"));
  });

  await test("docs: the guide lists every secret the workflow reads", () => {
    const doc = read("docs/backup-and-restore.md");
    for (const name of [
      "BACKUP_DATABASE_URL",
      "BACKUP_PASSPHRASE",
      "BACKUP_S3_BUCKET",
      "BACKUP_S3_ENDPOINT",
      "BACKUP_AWS_ACCESS_KEY_ID",
      "BACKUP_AWS_SECRET_ACCESS_KEY",
      "BACKUP_AWS_REGION",
    ]) {
      assert.ok(doc.includes(name), `${name} is explained`);
    }
    assert.ok(doc.includes("db-restore.sh") && doc.includes("Storage") && doc.includes("lifecycle"));
  });

  if (!canRun) {
    skipped += 1;
    console.log("SKIP  script runs: bash or gpg is not installed here");
  } else {
    await test("run: a backup is encrypted, uploaded under a dated name, and decrypts back to the dump", () => {
      const run = runBackup();
      try {
        assert.equal(run.status, 0, run.output);
        const uploaded = readdirSync(run.bucket);
        assert.equal(uploaded.length, 1);
        assert.match(uploaded[0], /^lifework-pos-\d{4}-\d{2}-\d{2}T\d{6}Z\.dump\.gpg$/);
        const encrypted = readFileSync(path.join(run.bucket, uploaded[0]));
        assert.ok(!encrypted.includes(Buffer.from("pretend pg_dump output")), "the stored file is not readable text");
        const decrypted = spawnSync(
          "gpg",
          ["--batch", "--quiet", "--pinentry-mode", "loopback", "--passphrase", PASSPHRASE, "--decrypt", path.join(run.bucket, uploaded[0])],
          { encoding: "utf8" },
        );
        assert.equal(decrypted.stdout, DUMP_TEXT);
        const wrong = spawnSync(
          "gpg",
          ["--batch", "--quiet", "--pinentry-mode", "loopback", "--passphrase", "not-the-passphrase", "--decrypt", path.join(run.bucket, uploaded[0])],
          { encoding: "utf8" },
        );
        assert.notEqual(wrong.status, 0, "the wrong passphrase cannot open it");
        assert.ok(readFileSync(path.join(run.dir, "aws.calls"), "utf8").includes("s3://my-backups/lifework-pos/daily/lifework-pos-"));
        assert.ok(readFileSync(path.join(run.dir, "pg_dump.args"), "utf8").includes("--schema=public"));
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: no secret is printed in the log", () => {
      const run = runBackup();
      try {
        assert.equal(run.status, 0, run.output);
        for (const secret of [PASSPHRASE, "secret-db-password", "test-secret-access-key"]) {
          assert.ok(!run.output.includes(secret), "a secret appeared in the output");
        }
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: Prisma-only options on the connection string are removed before pg_dump sees it", () => {
      const run = runBackup({
        BACKUP_DATABASE_URL: "postgresql://u:p@host.pooler.supabase.com:5432/postgres?pgbouncer=true&connection_limit=1&sslmode=require",
      });
      try {
        assert.equal(run.status, 0, run.output);
        assert.equal(readFileSync(path.join(run.dir, "pg_dump.url"), "utf8").trim(), "postgresql://u:p@host.pooler.supabase.com:5432/postgres?sslmode=require");
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: a connection string with only Prisma options ends clean, with no stray ?", () => {
      const run = runBackup({ BACKUP_DATABASE_URL: "postgresql://u:p@host:5432/postgres?pgbouncer=true&connection_limit=1" });
      try {
        assert.equal(run.status, 0, run.output);
        assert.equal(readFileSync(path.join(run.dir, "pg_dump.url"), "utf8").trim(), "postgresql://u:p@host:5432/postgres");
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: a custom endpoint (Cloudflare R2, Backblaze) is passed to every storage call", () => {
      const run = runBackup({ BACKUP_S3_ENDPOINT: "https://example.r2.cloudflarestorage.com" });
      try {
        assert.equal(run.status, 0, run.output);
        const calls = readFileSync(path.join(run.dir, "aws.calls"), "utf8").trim().split("\n");
        assert.equal(calls.length, 2);
        assert.ok(calls.every((c) => c.includes("--endpoint-url https://example.r2.cloudflarestorage.com")));
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: an empty endpoint secret means plain AWS S3", () => {
      const run = runBackup({ BACKUP_S3_ENDPOINT: "" });
      try {
        assert.equal(run.status, 0, run.output);
        assert.ok(!readFileSync(path.join(run.dir, "aws.calls"), "utf8").includes("--endpoint-url"));
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: a missing setting stops the backup before anything is dumped or uploaded", () => {
      for (const name of ["BACKUP_DATABASE_URL", "BACKUP_PASSPHRASE", "BACKUP_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"]) {
        const run = runBackup({}, [name]);
        try {
          assert.equal(run.status, 2, `${name}: ${run.output}`);
          assert.ok(run.output.includes(name));
          assert.deepEqual(readdirSync(run.bucket), []);
          assert.ok(!existsSync(path.join(run.dir, "pg_dump.url")), "pg_dump was not started");
        } finally {
          rmSync(run.dir, { recursive: true, force: true });
        }
      }
    });

    await test("run: a short passphrase is refused", () => {
      const run = runBackup({ BACKUP_PASSPHRASE: "too-short" });
      try {
        assert.equal(run.status, 2, run.output);
        assert.deepEqual(readdirSync(run.bucket), []);
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: an older pg_dump first on PATH stops the backup before any dump, as happened on the first GitHub run", () => {
      const run = runBackup({ FAKE_PG_DUMP_VERSION: "pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-1.pgdg24.04+2)" });
      try {
        assert.equal(run.status, 5, run.output);
        assert.ok(run.output.includes("version 17 or newer") && run.output.includes("16.15"));
        assert.ok(!existsSync(path.join(run.dir, "pg_dump.url")), "pg_dump did not try to dump");
        assert.deepEqual(readdirSync(run.bucket), []);
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: a newer pg_dump (18) is accepted, and the version is read from PostgreSQL, not the Ubuntu build number", () => {
      const run = runBackup({ FAKE_PG_DUMP_VERSION: "pg_dump (PostgreSQL) 18.1 (Ubuntu 16.15-1.pgdg24.04+2)" });
      try {
        assert.equal(run.status, 0, run.output);
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: a dump with no table data is never uploaded", () => {
      const run = runBackup({ FAKE_EMPTY_DUMP: "1" });
      try {
        assert.equal(run.status, 3, run.output);
        assert.deepEqual(readdirSync(run.bucket), []);
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("run: if storage reports a different size than was sent, the run fails", () => {
      const run = runBackup({ FAKE_SHORT_UPLOAD: "1" });
      try {
        assert.equal(run.status, 4, run.output);
        assert.ok(run.output.includes("Upload check failed"));
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });

    await test("restore: a backup made by the script is decrypted and handed to pg_restore for the target database", () => {
      const run = runBackup();
      try {
        assert.equal(run.status, 0, run.output);
        const file = path.join(run.bucket, readdirSync(run.bucket)[0]);
        const env = { ...process.env, PATH: `${run.dir}${path.delimiter}${process.env.PATH ?? ""}`, BACKUP_PASSPHRASE: PASSPHRASE };
        const restore = spawnSync("bash", [path.join(root, "scripts", "backup", "db-restore.sh"), file, "postgresql://target/empty"], { env, encoding: "utf8" });
        assert.equal(restore.status, 0, `${restore.stdout}${restore.stderr}`);
        assert.equal(readFileSync(path.join(run.dir, "pg_restore.log"), "utf8").trim(), "restored into postgresql://target/empty");
        const wrong = spawnSync("bash", [path.join(root, "scripts", "backup", "db-restore.sh"), file, "postgresql://target/empty"], {
          env: { ...env, BACKUP_PASSPHRASE: "wrong-passphrase-wrong-passphrase" },
          encoding: "utf8",
        });
        assert.notEqual(wrong.status, 0, "a wrong passphrase restores nothing");
      } finally {
        rmSync(run.dir, { recursive: true, force: true });
      }
    });
  }

  await test("restore script: it never cleans or drops, so a database that already has the tables is not overwritten", () => {
    const sh = read("scripts/backup/db-restore.sh");
    assert.ok(!/--clean|--create|DROP /i.test(sh.replace(/^#.*$/gm, "")));
    assert.ok(sh.includes("--exit-on-error"));
  });

  console.log(`\n${passed} backup groups passed${skipped ? `, ${skipped} skipped` : ""}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
