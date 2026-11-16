"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { TEXT_LINK } from "@/lib/constants";
import { feedbackHref } from "@/lib/feedback";

/**
 * "Send feedback" for the site footer, carrying the page it was pressed on. The path is request data on dynamic
 * routes, so until it resolves the link goes to the form without one.
 */
export function FeedbackLink() {
  return (
    <Suspense fallback={<Shown href="/feedback" />}>
      <AtPath />
    </Suspense>
  );
}

function AtPath() {
  const pathname = usePathname();
  // The form's own page has nothing to report about itself.
  return <Shown href={pathname === "/feedback" ? "/feedback" : feedbackHref(pathname)} />;
}

function Shown({ href }: { href: string }) {
  return (
    <Link href={href as `/feedback?from=${string}`} className={TEXT_LINK}>
      Send feedback
    </Link>
  );
}
