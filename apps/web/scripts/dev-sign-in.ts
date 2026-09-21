/**
 * LOCAL ONLY. Prints a sign-in link for one of the seeded test accounts, so signing in during development costs no
 * email and does not spend the local 30-per-hour budget that the Mailpit-gated e2e tests share.
 *
 * It goes with supabase/seed.sql, whose header says why neither reaches the hosted project. Nothing in the app imports
 * it, so it is never bundled, and it refuses to run unless NEXT_PUBLIC_SUPABASE_URL points at a local database.
 *
 * Usage: yarn workspace @mtg/web tsx --env-file=.env.local scripts/dev-sign-in.ts [anon|admin|<email>] [next-path]
 *
 * `anon` and `admin` are the two accounts supabase/seed.sql creates. Any other argument is taken as the address of
 * an account that already exists — the demo cast from supabase/demo/admin-demo.sql, say.
 */
import { createAdminClient } from "../src/lib/server/supabase-admin";

const ACCOUNTS = { anon: "anon@test.local", admin: "admin@test.local" } as const;

async function main() {
  const who = process.argv[2] ?? "anon";
  const next = process.argv[3] ?? "/decks";
  const email = ACCOUNTS[who as keyof typeof ACCOUNTS] ?? (who.includes("@") ? who : undefined);
  if (!email) {
    console.error(`Unknown account "${who}". Use ${Object.keys(ACCOUNTS).join(", ")}, or an email address.`);
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

  const admin = createAdminClient();

  // Checked first, because generateLink("magiclink") *creates* the account when the address is unknown: a typo would
  // otherwise sign you in as a brand new person and quietly add them to the user list you were trying to look at.
  if (!(await userExists(admin, email))) {
    console.error(`No account with the address ${email}. This script signs in as someone who already exists.`);
    console.error("Run supabase/demo/admin-demo.sql for the demo cast, or supabase/seed.sql for anon and admin.");
    process.exitCode = 1;
    return;
  }

  const { data, error } = await admin.auth.admin.generateLink({
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

/** GoTrue's admin API has no lookup by address, so this pages the list. Local databases are small. */
async function userExists(admin: ReturnType<typeof createAdminClient>, email: string): Promise<boolean> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Couldn't list users: ${error.message}`);
    if (data.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) return true;
    if (data.users.length < 1000) return false;
  }
  return false;
}

void main();
