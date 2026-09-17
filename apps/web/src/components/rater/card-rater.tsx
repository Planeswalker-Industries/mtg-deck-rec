"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { ActionsApi, CardSummary, RaterDeal, RecContext } from "@mtg/core/contract";
import { ColorIdentity } from "@/components/deck/color-identity";
import { PanelError } from "@/components/deck/panel-state";
import { ShuffleDeck } from "@/components/deck/shuffle-deck";
import { SwipeRater } from "@/components/deck/swipe-rater";
import { Button } from "@/components/ui/button";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";
import { shuffled } from "@/lib/shuffle";
import { CommanderPicker } from "./commander-picker";

/** Cards per round; "Keep rating" deals another round from the same commander's cards. */
const ROUND_SIZE = 10;
const WUBRG = "WUBRG";

type Deal = { status: "idle" } | { status: "loading" } | { status: "ready"; data: RaterDeal } | { status: "error"; message: string };
type DealInput = Parameters<ActionsApi["dealRaterCards"]>[0];

/**
 * The standalone card rater: pick a commander, then rate replacements for cards its decks play, one swipe at a time.
 * Opens straight onto a commander when the page has one (a link from a commander page).
 */
export function CardRater({ initialCommanderSlug }: { initialCommanderSlug: string | null }) {
  const [deal, setDeal] = useState<Deal>({ status: "idle" });
  const [round, setRound] = useState<{ n: number; cards: CardSummary[] }>({ n: 0, cards: [] });
  const [rated, setRated] = useState(0);
  const [finished, setFinished] = useState(false);
  const dealRequest = useRef(0);
  const dealt = useRef(new Set<number>());
  const started = useRef(false);
  const scrollWanted = useRef(false);

  const context = useMemo<RecContext | null>(
    () =>
      deal.status === "ready"
        ? {
            deck: { commanders: deal.data.commanderKey.commanders.map((c) => c.id), cards: [] },
            bracket: 3,
            bracketSource: "inferred",
            includeGameChangers: true,
            ownership: null,
          }
        : null,
    [deal],
  );
  const targets = useMemo(() => round.cards.map((card) => ({ card })), [round]);

  /** Deals the next round: cards not dealt yet this sitting, at random, starting over once every card has come up. */
  function nextRound(cards: readonly CardSummary[]) {
    let fresh = cards.filter((c) => !dealt.current.has(c.id));
    if (fresh.length === 0) {
      dealt.current.clear();
      fresh = [...cards];
    }
    const next = shuffled(fresh).slice(0, ROUND_SIZE);
    for (const c of next) dealt.current.add(c.id);
    setRound((r) => ({ n: r.n + 1, cards: next }));
    setRated(0);
    setFinished(false);
    scrollWanted.current = true;
  }

  async function startDeal(input: DealInput) {
    const id = ++dealRequest.current;
    dealt.current.clear();
    setDeal({ status: "loading" });
    const r = await getApis().actions.dealRaterCards(input);
    if (id !== dealRequest.current) return;
    if (!r.ok) {
      setDeal({ status: "error", message: r.error.message });
      return;
    }
    setDeal({ status: "ready", data: r.data });
    nextRound(r.data.cards);
  }

  function pickAnother() {
    dealRequest.current++;
    setDeal({ status: "idle" });
    setFinished(false);
  }

  /** Element ref for the rater and its summary: scrolls them into place when they first show after a deal or a round. */
  function scrollIfWanted(element: HTMLElement | null) {
    if (!element || !scrollWanted.current) return;
    scrollWanted.current = false;
    element.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  // A link from a commander page opens the rater straight onto that commander.
  useEffect(() => {
    if (started.current || !initialCommanderSlug) return;
    started.current = true;
    void startDeal({ commanderSlug: initialCommanderSlug });
  });

  if (deal.status === "idle") return <CommanderPicker onPick={(card) => void startDeal({ commanderIds: [card.id] })} />;
  if (deal.status === "loading") return <ShuffleDeck label="Dealing cards" />;
  if (deal.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3">
        <PanelError message={deal.message} />
        <Button type="button" variant="outline" onClick={pickAnother}>
          Pick a commander
        </Button>
      </div>
    );
  }

  const { commanderKey, cards } = deal.data;
  const names = commanderKey.commanders.map(displayName).join(" and ");
  const identity = [...WUBRG].filter((color) => commanderKey.commanders.some((c) => c.colorIdentity.includes(color))).join("");
  const art = commanderKey.commanders[0]?.images?.front.artCrop;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-seam bg-sleeve px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          {art && <Image src={art} alt="" width={64} height={46} unoptimized className="h-11 w-16 shrink-0 rounded-md object-cover ring-1 ring-seam" />}
          <div className="min-w-0">
            <p className="truncate font-heading text-lg leading-tight font-extrabold">{names}</p>
            <ColorIdentity identity={identity} />
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={pickAnother}>
          Change
        </Button>
      </div>

      {cards.length === 0 ? (
        <p className="text-sm">{`There aren't any cards to rate for ${names} yet.`}</p>
      ) : finished ? (
        <RaterSummary rated={rated} onKeepRating={() => nextRound(cards)} onPickAnother={pickAnother} viewRef={scrollIfWanted} />
      ) : (
        context && (
          <SwipeRater
            key={round.n}
            mode="rater"
            targets={targets}
            context={context}
            commanderKeyId={commanderKey.id}
            onVote={() => setRated((n) => n + 1)}
            onFinish={() => {
              setFinished(true);
              scrollWanted.current = true;
            }}
            viewRef={scrollIfWanted}
          />
        )
      )}
    </div>
  );
}

function RaterSummary({
  rated,
  onKeepRating,
  onPickAnother,
  viewRef,
}: {
  rated: number;
  onKeepRating: () => void;
  onPickAnother: () => void;
  viewRef: (element: HTMLElement | null) => void;
}) {
  return (
    <section ref={viewRef} aria-labelledby="rater-summary-heading" className="flex scroll-mt-4 flex-col gap-3">
      <h2 id="rater-summary-heading" className="font-heading text-3xl leading-none font-extrabold tracking-tight">
        {rated === 0 ? "Nothing rated this round" : `${rated} replacement${rated === 1 ? "" : "s"} rated`}
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        {rated === 0
          ? "Deal another round, or pick a different commander."
          : "Your ratings are saved. Once enough come in, they'll help decide which replacements show up first."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={onKeepRating}>
          Keep rating
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onPickAnother}>
          Pick another commander
        </Button>
      </div>
    </section>
  );
}
