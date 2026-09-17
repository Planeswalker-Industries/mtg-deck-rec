/**
 * LOCAL ONLY. Prints a sign-in link for one of the seeded test accounts, so signing in during development costs no
 * email and does not spend the local 30-per-hour budget that the Mailpit-gated e2e tests share.
 *
 * TODO before any launch: this and supabase/seed.sql go together. Delete both, or prove they cannot reach the
 * hosted project.
 *
 * Usage: yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts [anon|admin] [next-path]
 */
import { createAdminClient } from "../src/lib/server/supabase-admin";

const ACCOUNTS = { anon: "anon@test.local", admin: "admin@test.local" } as const;

async function main() {
  const who = (process.argv[2] ?? "anon") as keyof typeof ACCOUNTS;
  const next = process.argv[3] ?? "/decks";
  const email = ACCOUNTS[who];
  if (!email) {
    console.error(`Unknown account "${process.argv[2]}". Use one of: ${Object.keys(ACCOUNTS).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
    console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is ${url}, which is not a local database.`);
    process.exitCode = 1;
    return;
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${site}/auth/confirm?next=${encodeURIComponent(next)}`;

  const { data, error } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  if (error) {
    console.error(`Couldn't mint a link for ${email}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // type=email, not magiclink: /auth/confirm verifies with verifyOtp({ type: "email" }) and ignores anything else.
  // The hashed token is what it checks, so the link works in any browser.
  const token = data.properties?.hashed_token;
  console.log(`\nSigned-in link for ${email}:\n`);
  console.log(`${redirectTo}&token_hash=${token}&type=email\n`);
}

void main();
