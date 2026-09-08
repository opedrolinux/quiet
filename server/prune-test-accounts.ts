/*
 * Removes accounts left behind by earlier test runs.
 *
 * The suites used to be pointed at whatever server was running, which was the
 * real one, so smoke-*, stranger-* and converge-* accounts accumulated beside
 * the real user's. `node server/test.ts` now runs against a throwaway database
 * and cannot add more; this clears what the old behaviour left.
 *
 * It refuses to touch anything that is not obviously a test account, and it
 * copies the database first.
 *
 *   node server/prune-test-accounts.ts          # show what would go
 *   node server/prune-test-accounts.ts --apply  # actually delete
 */
import { copyFileSync } from "node:fs";
import { db, DB_PATH } from "./src/db.ts";

const APPLY = process.argv.includes("--apply");

// Deliberately narrow: only the shapes the suites generate. A real address is
// never deleted by accident because it never matches.
const TEST = /^(smoke|stranger|converge)-\d+@example\.com$/;

const doomed = db
  .prepare("SELECT id, email FROM users")
  .all()
  .filter((u: any) => TEST.test(u.email)) as { id: string; email: string }[];

if (doomed.length === 0) {
  console.log("No test accounts found. Nothing to do.");
  process.exit(0);
}

console.log(`${doomed.length} test account(s):`);
for (const u of doomed) {
  const notes: any = db
    .prepare("SELECT COUNT(*) c FROM notes WHERE user_id = ?")
    .get(u.id);
  const devices: any = db
    .prepare("SELECT COUNT(*) c FROM devices WHERE user_id = ?")
    .get(u.id);
  console.log(`   ${u.email}  — ${notes.c} notes, ${devices.c} devices`);
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to delete these.");
  process.exit(0);
}

const backup = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
copyFileSync(DB_PATH, backup);
console.log(`\nBacked up to ${backup}`);

db.exec("BEGIN IMMEDIATE");
let notes = 0;
let devices = 0;
try {
  for (const u of doomed) {
    notes += db.prepare("DELETE FROM notes WHERE user_id = ?").run(u.id).changes as number;
    devices += db.prepare("DELETE FROM devices WHERE user_id = ?").run(u.id).changes as number;
    db.prepare("DELETE FROM auth_requests WHERE email = ?").run(u.email);
    db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

console.log(`Deleted ${doomed.length} accounts, ${notes} notes, ${devices} devices.`);
console.log("\nRemaining:");
for (const u of db.prepare("SELECT id, email FROM users").all() as any[]) {
  const n: any = db
    .prepare("SELECT COUNT(*) c FROM notes WHERE user_id = ? AND deleted_at IS NULL")
    .get(u.id);
  console.log(`   ${u.email}  — ${n.c} notes`);
}
