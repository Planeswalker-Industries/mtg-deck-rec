"use client";

import Link from "next/link";
import type { Route } from "next";
import type { Bracket, BuildResult } from "@mtg/core/contract";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { CopyDecklistButton } from "@/components/decks/deck-export";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRACKETS, bracketLabel, cardCategoryLabel } from "@/lib/labels";
import { downloadText, deckFileName } from "@/lib/deck-download";
import { cn } from "cn";
import { TEXT_LINK } from "@/lib/constants";
import { ShuffleDeck } from "../shuffle-deck";
import { buildDecklist, type BuildState } from "./use-deck-build";

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What the build managed, in a sentence: how many slots the collection filled, and what's still open. */
function summary(result: BuildResult, fromCollection: boolean): string {
  const { slots, filled, open } = result.feasibility;
  if (!fromCollection) return `All ${slots} cards picked from every card in print, basic lands included.`;
  if (open === 0) return `All ${slots} cards come from your collection, basic lands included.`;
  return `${filled} of ${slots} cards come from your collection, basic lands included. ${count(open, "slot")} ${open === 1 ? "is" : "are"} still open.`;
}

/**
 * A deck built for one commander (goal 2): what the build picked, grouped like the deck tool's lists, the basic lands
 * to gather, and what it couldn't fill. From here the player goes through it card by card (Upgrade), edits it in the
 * Deckbuilder, or takes it away as text. Buying cards for the open slots is shelved (D-12): a placeholder says so.
 */
export function BuildView({
  state,
  collectionImportHref,
  onBracket,
  onUpgrade,
  onEdit,
  onPickAnother,
}: {
  state: Exclude<BuildState, { status: "idle" }>;
  collectionImportHref: Route;
  onBracket: (bracket: Bracket) => void;
  /** Takes the built decklist into the deck tool's Upgrade round, or into the Deckbuilder. */
  onUpgrade: (decklist: string) => void;
  onEdit: (decklist: string) => void;
  onPickAnother: () => void;
}) {
  const commanderName = state.commander.name;
  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {commanderName}
          <span className="mt-1 block font-drama text-xl font-normal tracking-normal italic text-foreground/85 sm:text-2xl">
            {state.status === "ready" && state.fromCollection ? "Here's what your cards make." : "Here's a deck to start from."}
          </span>
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <Select value={String(state.bracket)} onValueChange={(value) => onBracket(Number(value) as Bracket)} disabled={state.status === "loading"}>
          <SelectTrigger aria-label="Bracket" size="sm" className="bg-sleeve">
            <SelectValue>Bracket {state.bracket}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {BRACKETS.map((b) => (
              <SelectItem key={b} value={String(b)}>
                {bracketLabel[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" variant="ghost" onClick={onPickAnother}>
          Pick another commander
        </Button>
      </div>
    </div>
  );

  if (state.status === "loading") {
    return (
      <section aria-label="Building your deck" className="flex flex-col gap-6">
        {header}
        <ShuffleDeck label="Building your deck" />
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section aria-label="Building your deck" className="flex flex-col gap-6">
        {header}
        <div role="alert" className="flex flex-col items-start gap-3 rounded-panel border border-seam bg-sleeve p-4">
          <p>{state.message}</p>
          <Button type="button" variant="outline" onClick={() => onBracket(state.bracket)}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const { result, fromCollection } = state;
  const decklist = buildDecklist(result);
  const { open, roleShortfalls } = result.feasibility;
  const fileName = deckFileName(result.commanderKey.commanders.map((c) => c.name));

  return (
    <section aria-label="Your built deck" className="flex flex-col gap-6">
      {header}

      <div className="flex flex-col gap-4 rounded-panel border border-seam bg-sleeve p-4 sm:p-5">
        <p>{summary(result, fromCollection)}</p>
        {roleShortfalls.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Still short of {roleShortfalls.map((s) => `${s.role.label.toLowerCase()} (${s.short})`).join(", ")} against what this commander&apos;s decks run.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Estimated bracket {result.estimatedBracket}. {result.landTarget} lands, basics included.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="lg" className="lit" onClick={() => onUpgrade(decklist)}>
            Go through it card by card
          </Button>
          <Button type="button" size="lg" variant="outline" onClick={() => onEdit(decklist)}>
            Edit in the deckbuilder
          </Button>
          <CopyDecklistButton text={decklist} size="lg" />
          <Button type="button" size="lg" variant="outline" onClick={() => downloadText(decklist, fileName)}>
            Download text
          </Button>
        </div>
      </div>

      {!fromCollection && (
        <p className="text-sm text-muted-foreground">
          This deck draws on every card.{" "}
          <Link href={collectionImportHref} className={cn(TEXT_LINK, "font-semibold")}>
            Import your collection
          </Link>{" "}
          to build from the cards you own instead.
        </p>
      )}
      {fromCollection && open > 0 && (
        // D-12: the buy side is shelved. The slot it will fill stays visible, honestly empty.
        <aside aria-labelledby="build-open-slots" className="rounded-panel border border-dashed border-seam p-4">
          <h2 id="build-open-slots" className="font-semibold">
            {count(open, "open slot")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your collection ran out of cards that fit. Fill them by hand in the deckbuilder, or with basic lands. Suggestions
            for cards to pick up are coming later.
          </p>
        </aside>
      )}

      {result.groups.map((group) => (
        <section key={group.category} aria-labelledby={`build-${group.category}`} className="flex flex-col gap-2">
          <h2 id={`build-${group.category}`} className="font-heading text-xl leading-none font-semibold">
            {cardCategoryLabel[group.category]} <span className="font-mono text-base font-normal text-muted-foreground">{group.cards.length}</span>
          </h2>
          <PocketGrid zoomable label={cardCategoryLabel[group.category]} items={group.cards.map((c) => ({ card: c.card }))} />
        </section>
      ))}
      {result.basics.length > 0 && (
        <section aria-labelledby="build-basics" className="flex flex-col gap-2">
          <h2 id="build-basics" className="font-heading text-xl leading-none font-semibold">
            Basic lands to gather
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {result.basics.map((b) => (
              <li key={b.card.id}>
                <span className="font-mono">{b.quantity}</span> {b.card.name}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
