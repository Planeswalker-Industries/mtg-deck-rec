"use client";

import type { DeckCoverageResult } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { PHONE_HIT_AREA } from "@/lib/constants";
import type { useDeckCoverage } from "./use-deck-coverage";

type CoverageStatus = NonNullable<ReturnType<typeof useDeckCoverage>>;
type Allocation = DeckCoverageResult["coverage"]["cards"][number]["allocations"][number];

const SECTIONS = ["owned", "stand-in", "basic", "conflict", "missing"] as const;

function allocationLabel(allocation: Allocation, targetId: number, cards: Map<number, DeckCoverageResult["cards"][number]>) {
  switch (allocation.status) {
    case "owned": return "Owned";
    case "stand-in": return `Owned as ${cards.get(allocation.sourceCardId)?.name ?? "unknown card"}`;
    case "basic": return "Basic land — assumed available";
    case "conflict": return `In another deck${allocation.sourceCardId === targetId ? "" : ` as ${cards.get(allocation.sourceCardId)?.name ?? "unknown card"}`}: ${allocation.decks.map((deck) => deck.name).join(", ")}`;
    case "missing": return "Not owned";
  }
}

/** Compact second-line count, with copy-level allocation in a sheet. */
export function DeckCoverage({ status, retry }: { status: CoverageStatus; retry: () => void }) {
  if (status.status === "loading") return <span role="status" className="whitespace-nowrap">Checking collection…</span>;
  if (status.status === "error") {
    return (
      <span role="status" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
        Coverage unavailable
        <button type="button" onClick={retry} className={`${PHONE_HIT_AREA} max-sm:min-w-11 rounded-sm text-primary underline focus-visible:outline-2 focus-visible:outline-primary`}>Retry</button>
      </span>
    );
  }
  const { coverage, cards } = status.data;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const available = coverage.owned + coverage.standIn + coverage.basic;
  const fullName = `${available} of ${coverage.total} available: ${coverage.owned} owned, ${coverage.standIn} stand-in, ${coverage.basic} basic lands, ${coverage.conflict} conflicts, ${coverage.missing} missing`;
  return (
    <Sheet>
      <SheetTrigger
        aria-label={fullName}
        title={fullName}
        className={`${PHONE_HIT_AREA} shrink-0 whitespace-nowrap rounded-sm font-mono text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
      >
        {available}/{coverage.total} available
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] w-full max-w-xl gap-0 overflow-y-auto rounded-t-2xl border-seam bg-sleeve px-4 pt-5 pb-6">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle className="font-heading text-xl font-semibold tracking-tight">Your collection and this deck</SheetTitle>
          <SheetDescription>Basic lands are assumed available. Cards in another built deck aren&apos;t free copies.</SheetDescription>
        </SheetHeader>
        <p className="mt-3 text-sm tabular-nums">{fullName}</p>
        {coverage.total === 0 ? <p className="mt-4 text-muted-foreground">No cards to check.</p> : (
          <div className="mt-4 flex flex-col gap-5">
            {SECTIONS.map((section) => {
              const rows = coverage.cards.flatMap((entry) => entry.allocations
                .filter((allocation) => allocation.status === section)
                .map((allocation) => ({ entry, allocation })));
              if (!rows.length) return null;
              return (
                <section key={section} aria-label={section === "conflict" ? "In another deck" : section === "missing" ? "Not owned" : section === "stand-in" ? "Owned as another card" : section === "basic" ? "Basic land" : "Owned"}>
                  <h3 className="mb-2 font-heading font-semibold">{section === "conflict" ? "In another deck" : section === "missing" ? "Not owned" : section === "stand-in" ? "Owned as another card" : section === "basic" ? "Basic land" : "Owned"}</h3>
                  <ul className="flex flex-col gap-2">
                    {rows.map(({ entry, allocation }, i) => {
                      const card = byId.get(entry.cardId);
                      if (!card) return null;
                      return (
                        <li key={`${entry.cardId}-${i}`} className="flex items-center gap-3 rounded-lg border border-seam p-2">
                          <CardImage card={card} variant="small" alt="" className="w-12 shrink-0" />
                          <div className="min-w-0 text-sm">
                            <p className="font-semibold">{allocation.quantity}× {card.name}</p>
                            <p className="text-muted-foreground">{allocationLabel(allocation, entry.cardId, byId)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
