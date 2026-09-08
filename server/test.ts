/*
 * Runs both suites against a server of their own.
 *
 * They used to be pointed at whatever server happened to be running, which
 * meant the real one: every run left smoke-*, stranger-* and converge-*
 * accounts sitting in the database next to the user's. Tests that dirty the
 * thing they are testing are worse than no tests, because you stop trusting
 * what you find in there.
 *
 * So this starts a server on a spare port with its own database and its own
 * mail log in a temp directory, runs the suites against that, and deletes the
 * lot afterwards -- pass or fail.
 *
 *   node server/test.ts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.QUIET_TEST_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), "quiet-test-"));
const MAIL_LOG = join(dir, "magic-links.txt");

const env = {
  ...process.env,
  PORT: String(PORT),
  HOST: "127.0.0.1",
  QUIET_DB: join(dir, "test.db"),
  QUIET_MAIL_LOG: MAIL_LOG,
  QUIET_PUBLIC_URL: BASE,
};

function run(script: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, BASE], {
      env,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForServer(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Any answer at all proves it is listening; 401 is the expected one.
      await fetch(BASE + "/sync", { method: "POST", body: "{}" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return false;
}

let server: ChildProcess | undefined;

function cleanup(): void {
  server?.kill();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A Windows file lock on the sqlite handle is not worth failing a run over.
  }
}

async function main(): Promise<number> {
  server = spawn(process.execPath, ["server/src/index.ts"], {
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });

  if (!(await waitForServer())) {
    console.error(`\nTest server never came up on ${BASE}.`);
    return 1;
  }

  console.log(`\n=== server smoke (${BASE}, throwaway database) ===\n`);
  const smoke = await run("server/smoke.ts");

  console.log(`\n=== client convergence ===\n`);
  const converge = await run("server/converge.ts");

  const failed = smoke !== 0 || converge !== 0;
  console.log(failed ? "\nSUITE FAILED\n" : "\nboth suites passed\n");
  return failed ? 1 : 0;
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

main()
  .then((code) => {
    cleanup();
    process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    cleanup();
    process.exit(1);
  });
