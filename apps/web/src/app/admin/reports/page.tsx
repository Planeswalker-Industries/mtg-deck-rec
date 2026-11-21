import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ReportsView } from "@/components/admin/reports-view";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { PAGE_SHEET } from "@/lib/constants";

/**
 * /admin/reports — feedback reports (T077).
 *
 * A static segment, so it takes precedence over /admin/[...slug] and is *not* part of the React Admin app: this page
 * is the site's own design language, because it is read the way the rest of the app is read rather than administered
 * like a resource table.
 *
 * Three locks, the same three as /admin: `proxy.ts` answers a signed-out visitor with a redirect and a signed-in
 * non-admin with a real 404 (it has to, because this page streams); this check refuses to render; and the
 * /api/admin/reports routes check for themselves, which is what actually protects the data.
 */
export const metadata: Metadata = {
  title: "Feedback reports",
  robots: { index: false, follow: false },
};

export default function AdminReportsPage() {
  return (
    <div className="flex flex-col gap-4 py-6">
      <Suspense
        fallback={
          <p role="status" className={`${PAGE_SHEET} text-sm text-muted-foreground`}>
            Checking your access…
          </p>
        }
      >
        <Reports />
      </Suspense>
    </div>
  );
}

async function Reports() {
  const session = await requirePlatformAdmin();
  if ("error" in session) notFound();
  return <ReportsView />;
}
