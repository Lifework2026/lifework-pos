// Sets a new password on one admin account. The password comes from the environment, never from the command line or the
// repository, and only its scrypt hash is stored.
//
//   NEW_PASSWORD='...' npx tsx scripts/reset-admin-password.ts            resets the oldest active ADMIN
//   NEW_PASSWORD='...' npx tsx scripts/reset-admin-password.ts <username> resets that account (it must be an ADMIN)
//   npx tsx scripts/reset-admin-password.ts --list                        lists the accounts, changes nothing
//
// If there is no active admin, it stops and says so; it does not create accounts.

import path from "node:path";
import { hashPassword } from "../lib/auth/password";

async function main(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve(process.cwd(), ".env"));
  } catch {
    // No .env file: the environment must already hold the settings.
  }
  const { prisma } = await import("../lib/prisma");
  const args = process.argv.slice(2);

  const users = await prisma.user.findMany({ select: { id: true, username: true, fullName: true, role: true, isActive: true }, orderBy: { createdAt: "asc" } });
  console.log("Accounts:");
  for (const u of users) console.log(`  ${u.username}  role ${u.role}  ${u.isActive ? "active" : "inactive"}  (${u.fullName})`);
  if (args.includes("--list")) {
    await prisma.$disconnect();
    return;
  }

  const password = process.env.NEW_PASSWORD;
  if (!password || password.length < 8) throw new Error("Set NEW_PASSWORD (at least 8 characters) in the environment.");
  const wanted = args.find((a) => !a.startsWith("--"));
  const admins = users.filter((u) => u.role === "ADMIN" && u.isActive);
  const target = wanted ? admins.find((u) => u.username === wanted) : admins[0];
  if (!target) throw new Error(wanted ? `"${wanted}" is not an active ADMIN account.` : "There is no active ADMIN account. No account was created.");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { passwordHash: hashPassword(password) } });
    await tx.auditLog.create({ data: { action: "USER_PASSWORD_RESET", entityType: "User", entityId: target.id, details: { username: target.username, by: "scripts/reset-admin-password" } } });
  });
  console.log(`Password changed for "${target.username}" (ADMIN).`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
