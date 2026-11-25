import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ErrorsView } from "@/components/admin/errors-view";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { PAGE_SHEET } from "@/lib/constants";

/**
 * /admin/errors — error tickets: every failure the site hit, on the server or in a browser, grouped by kind.
 *
 * Like /admin/reports, a static segment outside the React Admin app, behind the same three locks: `proxy.ts` (redirect
 * signed out, 404 for a non-admin), this check, and the /api/admin/errors routes, which are what protect the data.
 */
export const metadata: Metadata = {
  title: "Error tickets",
  robots: { index: false, follow: false },
};

export default function AdminErrorsPage() {
  return (
    <div className="flex flex-col gap-4 py-6">
      <Suspense
        fallback={
          <p role="status" className={`${PAGE_SHEET} text-sm text-muted-foreground`}>
            Checking your access…
          </p>
        }
      >
        <Errors />
      </Suspense>
    </div>
  );
}

async function Errors() {
  const session = await requirePlatformAdmin();
  if ("error" in session) notFound();
  return <ErrorsView />;
}
