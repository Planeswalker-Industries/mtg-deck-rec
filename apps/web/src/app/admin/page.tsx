import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminShell } from "@/components/admin/admin-shell";
import { requirePlatformAdmin } from "@/lib/server/admin";

/**
 * /admin, and every path under it: React Admin routes on the client, so one catch-all serves the whole area.
 *
 * Three locks on the same door, because this one matters:
 *  - `proxy.ts` decides the response a non-admin gets: sign in when signed out, a real 404 otherwise. It has to be
 *    there rather than here, because this page streams and its shell is already sent by the time the check below
 *    runs;
 *  - this check refuses to render the shell at all, in case the proxy is ever bypassed. It can only answer with a
 *    streamed not-found body, which is why the proxy exists — but nothing of the admin area reaches the browser;
 *  - every /api/admin route checks for itself, which is the check that actually protects the data — the page is
 *    only a shell, and all of its data comes from there.
 */
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    // Full-bleed: the admin app brings its own layout and shouldn't be squeezed into the site's reading column.
    <div className="mx-[calc(50%-50vw)] w-[100vw]">
      <Suspense
        fallback={
          <p role="status" className="p-6 text-sm text-muted-foreground">
            Checking your access…
          </p>
        }
      >
        <AdminArea />
      </Suspense>
    </div>
  );
}

async function AdminArea() {
  const session = await requirePlatformAdmin();
  if ("error" in session) notFound();
  return <AdminShell userId={session.user.id} email={session.user.email} />;
}
