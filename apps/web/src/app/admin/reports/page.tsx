import type { Metadata } from "next";
import { cn } from "cn";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReportsView } from "@/components/admin/reports-view";
import { requirePlatformAdmin } from "@/lib/server/admin";
import { TEXT_LINK } from "@/lib/constants";

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
    <div className="flex flex-col gap-6 py-6">
      <Link href="/admin" className={cn(TEXT_LINK, "inline-flex w-fit items-center gap-1.5 text-sm font-semibold")}>
        <ArrowLeft aria-hidden className="size-4" />
        Admin
      </Link>
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted-foreground">
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
