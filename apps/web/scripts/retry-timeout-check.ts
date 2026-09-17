/**
 * Checks the statement-timeout retry without touching a database: the call is faked so each case can decide what it
 * returns and how many times it was asked.
 *
 * Usage: yarn workspace @mtg/web tsx scripts/retry-timeout-check.ts
 */
import { isStatementTimeout, retryOnTimeout } from "../src/lib/server/retry-timeout";

const failures: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures.push(label);
};

const timeout = { code: "57014", message: "canceling statement due to statement timeout" };
const otherError = { code: "42883", message: "function does not exist" };

/** Fails with `error` for the first `failures` calls, then succeeds. */
function fakeCall(failuresBeforeSuccess: number, error: { code: string; message: string }) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    run: () => {
      calls++;
      return Promise.resolve(calls <= failuresBeforeSuccess ? { data: null, error } : { data: ["ok"], error: null });
    },
  };
}

async function main() {
  check("recognises a timeout by SQLSTATE", isStatementTimeout({ code: "57014" }), "57014");
  check(
    "recognises a timeout by message alone",
    isStatementTimeout({ message: "canceling statement due to statement timeout" }),
    "no code",
  );
  check("does not treat another error as a timeout", !isStatementTimeout(otherError), "42883");
  check("treats no error as no timeout", !isStatementTimeout(null), "null");

  const first = fakeCall(0, timeout);
  const firstResult = await retryOnTimeout("succeeds first time", first.run);
  check("a call that works is not repeated", first.calls === 1 && firstResult.error === null, `${first.calls} call(s)`);

  const second = fakeCall(1, timeout);
  const secondResult = await retryOnTimeout("one timeout", second.run);
  check(
    "retries once after a timeout and returns the data",
    second.calls === 2 && secondResult.error === null && secondResult.data?.[0] === "ok",
    `${second.calls} calls`,
  );

  const third = fakeCall(2, timeout);
  const thirdResult = await retryOnTimeout("two timeouts", third.run);
  check("retries twice after two timeouts", third.calls === 3 && thirdResult.error === null, `${third.calls} calls`);

  const always = fakeCall(99, timeout);
  const alwaysResult = await retryOnTimeout("always times out", always.run);
  check(
    "gives up after three attempts and returns the timeout",
    always.calls === 3 && isStatementTimeout(alwaysResult.error),
    `${always.calls} calls`,
  );

  const other = fakeCall(99, otherError);
  const otherResult = await retryOnTimeout("another error", other.run);
  check(
    "does not retry an error that is not a timeout",
    other.calls === 1 && otherResult.error?.code === "42883",
    `${other.calls} call(s)`,
  );

  console.log(failures.length === 0 ? "\nAll checks passed." : `\nFAILED: ${failures.join(", ")}`);
  process.exitCode = failures.length === 0 ? 0 : 1;
}

void main();
