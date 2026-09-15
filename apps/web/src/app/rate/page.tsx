import type { Metadata } from "next";
import { Suspense } from "react";
import { CardRater } from "@/components/rater/card-rater";

export const metadata: Metadata = {
  title: "Rate replacements",
  description: "Pick a commander and rate replacements for the cards its decks play, one swipe at a time.",
  // Rating is interactive; indexable content lives on card and commander pages.
  robots: { index: false, follow: true },
};

export default function RatePage({ searchParams }: PageProps<"/rate">) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight">Rate replacements</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          {"Pick a commander to see cards its decks play and replacements that do the same job. Swipe right when a replacement is a good fit, left when it isn't."}
        </p>
      </div>
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
