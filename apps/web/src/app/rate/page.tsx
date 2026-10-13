import type { Metadata } from "next";
import { Suspense } from "react";
import { CardRater } from "@/components/rater/card-rater";

export const metadata: Metadata = {
  title: "Rate replacements",
  description: "Pick a commander and rate replacements for the cards its decks play, one swipe at a time.",
  // Rating is interactive; indexable content lives on card and commander pages.
  robots: { index: false, follow: true },
};

/** The rater sets its own heading: an opening screen while a commander is picked, a plain one while rating. */
export default function RatePage({ searchParams }: PageProps<"/rate">) {
  return (
    <div className="flex flex-col gap-5">
      <Suspense fallback={null}>
        <RaterWithParams searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function RaterWithParams({ searchParams }: Pick<PageProps<"/rate">, "searchParams">) {
  const { commander } = await searchParams;
  return <CardRater initialCommanderSlug={typeof commander === "string" ? commander : null} />;
}
