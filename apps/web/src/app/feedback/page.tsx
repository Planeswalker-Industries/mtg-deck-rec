import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FeedbackForm } from "@/components/feedback/feedback-form";
import { TEXT_LINK } from "@/lib/constants";
import { feedbackFromPath, feedbackHref } from "@/lib/feedback";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata: Metadata = {
  title: "Send feedback",
  robots: { index: false, follow: false },
};

/**
 * /feedback?from=/decks/… — a message to the site's admins, about the page in `from`. Signed in only (T077): a
 * signed-out visitor sees the sign-in link straight away, before writing anything.
 */
export default function FeedbackPage({ searchParams }: PageProps<"/feedback">) {
  return (
    <div className="flex max-w-prose flex-col gap-4 py-6">
      <h1 className="font-heading text-2xl leading-none font-semibold tracking-tight">Send feedback</h1>
      <Suspense
        fallback={
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        }
      >
        <FeedbackBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function FeedbackBody({ searchParams }: Pick<PageProps<"/feedback">, "searchParams">) {
  const { from } = await searchParams;
  const fromPath = feedbackFromPath(from);
  const user = await getCurrentUser();
  if (!user) {
    return (
      <p>
        <Link href={`/sign-in?next=${encodeURIComponent(feedbackHref(fromPath))}`} className={`${TEXT_LINK} font-semibold`}>
          Sign in
        </Link>{" "}
        to send feedback.
      </p>
    );
  }
  return <FeedbackForm fromPath={fromPath} />;
}
