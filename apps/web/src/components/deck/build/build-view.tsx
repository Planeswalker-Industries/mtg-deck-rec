"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import type { Bracket, BuildResult, CardId, CardSummary } from "@mtg/core/contract";
import { deckDiff } from "@mtg/core/journey";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { UnsavedDeckExport } from "@/components/decks/deck-export";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRACKETS, bracketLabel, cardCategoryLabel } from "@/lib/labels";
import { cn } from "cn";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { ShuffleDeck } from "../shuffle-deck";
import {
  buildCards,
  buildDecklist,
  buildDecklistCsv,
  buildEntries,
  type BuildRequest,
  type BuildState,
} from "./use-deck-build";

/** What the open slots panel says, inline from sm up and behind its (?) on phones. */
const OPEN_SLOTS_HELP = "Your collection ran out of auto-includes. Hit continue and we'll fill the missing pieces together.";

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What the build managed, in a sentence: how many slots the collection filled (the open ones get their own panel). */
function summary(result: BuildResult, fromCollection: boolean): string {
  const { slots, filled } = result.feasibility;
  if (!fromCollection) return `All ${slots} cards picked from every card in print.`;
  return `${filled}/${slots} matched from collection.`;
}

/**
 * The commanders' art behind the header, fading in from the right like a card plate's; partners share the strip.
 * The left stays clear for the name.
 */
function CommanderArt({ commanders }: { commanders: CardSummary[] }) {
  const arts = commanders.flatMap((c) => (c.images?.front.artCrop ? [c.images.front.artCrop] : []));
  if (arts.length === 0) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 right-0 flex w-full [mask-image:linear-gradient(to_right,transparent,black_60%)] sm:w-3/4"
    >
      {arts.map((src) => (
        <span key={src} className="relative flex-1">
          <Image src={src} alt="" fill unoptimized sizes="(min-width: 640px) 75vw, 100vw" className="object-cover object-[center_30%]" />
        </span>
      ))}
    </div>
  );
}

/** The roles the build is still short of, by how many cards. Two equal columns on phones, a row from sm up. */
function RoleShortfalls({ shortfalls }: { shortfalls: BuildResult["feasibility"]["roleShortfalls"] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        Adjustments needed:
      </p>
      <ul aria-label="Roles the deck is short of" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:pl-7">
        {shortfalls.map(({ role, short }) => (
          <li
            key={role.id}
            className="flex min-w-0 items-center justify-between gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-sm"
          >
            <span className="truncate">{role.label}</span>
            <span className="shrink-0 font-mono text-warning">
              −{short}
              <span className="sr-only"> {short === 1 ? "card" : "cards"} short</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a fitted list lost and gained against the build; null when the build fitted no list. */
function fitDiff(request: BuildRequest, result: BuildResult) {
  if (!request.list) return null;
  const commanders = request.commanders.map((c) => c.id);
  return deckDiff({ commanders, cards: request.list.entries }, { commanders, cards: buildEntries(result) });
}

const copies = (changes: readonly { quantity: number }[]) => changes.reduce((n, c) => n + c.quantity, 0);

/** What fitting a list changed, as a sentence: how much of it stayed, and how much came from the collection instead. */
function fitSummary(listCopies: number, removed: number, added: number): string {
  const kept = listCopies - removed;
  return `Kept ${kept} of the list's ${listCopies} cards. ${count(removed, "card")} you don't own ${removed === 1 ? "was" : "were"} swapped for ${count(added, "card")} from your collection.`;
}

/** The list's cards and the build's, side by side as what went out and what came in. */
function FitChanges({ request, result }: { request: BuildRequest; result: BuildResult }) {
  const list = request.list;
  const diff = fitDiff(request, result);
  if (!list || !diff) return null;
  const built = buildCards(result);
  const named = (changes: { cardId: CardId; quantity: number }[], from: ReadonlyMap<CardId, CardSummary>) =>
    changes.flatMap(({ cardId, quantity }) => {
      const card = from.get(cardId);
      return card ? [{ card, quantity }] : [];
    });
  const grid = (entries: { card: CardSummary; quantity: number }[], label: string, mark: "cut" | "add") => (
    <PocketGrid
      zoomable
      label={label}
      items={entries.map(({ card, quantity }) => ({
        card,
        mark,
        ...(quantity > 1 ? { caption: <span className="font-mono text-muted-foreground">{quantity} copies</span> } : {}),
      }))}
    />
  );
  const out = named(diff.removed, list.cards);
  const into = named(diff.added, built);
  return (
    <>
      {out.length > 0 && (
        <section aria-labelledby="fit-out" className="flex flex-col gap-2">
          <h2 id="fit-out" className="font-heading text-xl leading-none font-semibold text-cut">
            Out: not in your collection
          </h2>
          {grid(out, "Cards from the list you don't own", "cut")}
        </section>
      )}
      {into.length > 0 && (
        <section aria-labelledby="fit-in" className="flex flex-col gap-2">
          <h2 id="fit-in" className="font-heading text-xl leading-none font-semibold text-add">
            In: from your collection
          </h2>
          {grid(into, "Cards from your collection that took their place", "add")}
        </section>
      )}
    </>
  );
}

/**
 * A deck built for one commander: what the build picked, grouped like the deck tool's lists, the basic lands, and
 * what it couldn't fill. From here the player continues card by card (Upgrade), saves it for later (the Deckbuilder
 * with the name form open), or copies or downloads it. Buying cards for the open slots is shelved: a placeholder
 * says so. A pasted list fitted to the collection also shows what went out of the list and what came in.
 */
export function BuildView({
  state,
  collectionImportHref,
  onBracket,
  onUpgrade,
  onSave,
  onPickAnother,
}: {
  state: Exclude<BuildState, { status: "idle" }>;
  collectionImportHref: Route;
  onBracket: (bracket: Bracket) => void;
  /** Takes the built decklist into the deck tool's Upgrade round, or into the Deckbuilder to save it. */
  onUpgrade: (decklist: string) => void;
  onSave: (decklist: string) => void;
  onPickAnother: () => void;
}) {
  const { request } = state;
  const fitting = request.list !== undefined;
  const commanderName = request.commanders.map((c) => c.name).join(" and ");
  // A build from the collection needs no line: the summary below says how much of it is the player's.
  const tagline = fitting
    ? "Here's that list, made from your cards."
    : state.status === "ready" && !state.fromCollection
      ? "Here's a deck to start from."
      : null;
  const header = (
    <header className="relative isolate overflow-hidden rounded-panel border border-seam bg-sleeve">
      <CommanderArt commanders={request.commanders} />
      <div className="relative flex min-h-32 flex-col justify-between gap-4 p-4 sm:min-h-40 sm:p-5">
        <h1 className="max-w-xl font-heading text-2xl font-semibold tracking-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.9)] sm:text-3xl">
          {commanderName}
          {tagline && (
            <span className="mt-1 block font-drama text-xl font-normal tracking-normal italic text-foreground/85 sm:text-2xl">
              {tagline}
            </span>
          )}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(request.bracket)} onValueChange={(value) => onBracket(Number(value) as Bracket)} disabled={state.status === "loading"}>
            <SelectTrigger aria-label="Bracket" size="sm" className="bg-sleeve">
              <SelectValue>Bracket {request.bracket}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {BRACKETS.map((b) => (
                <SelectItem key={b} value={String(b)}>
                  {bracketLabel[b]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" className="bg-background/70" onClick={onPickAnother}>
            {fitting ? "Back to the list" : "Change commander"}
          </Button>
        </div>
      </div>
    </header>
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
          <Button type="button" variant="outline" onClick={() => onBracket(request.bracket)}>
            Try again
          </Button>
        </div>
      </section>
    );
  }

  const { result, fromCollection } = state;
  const decklist = buildDecklist(result);
  const { open, roleShortfalls } = result.feasibility;
  const basicCount = result.basics.reduce((n, b) => n + b.quantity, 0);
  const fit = fitDiff(request, result);

  return (
    <section aria-label="Your built deck" className="flex flex-col gap-6">
      {/* Taking the list away sits under the plate, apart from the two ways on. */}
      <div className="flex flex-col gap-2">
        {header}
        <div className="flex justify-end">
          <UnsavedDeckExport
            text={decklist}
            csv={buildDecklistCsv(result)}
            commanders={result.commanderKey.commanders.map((c) => c.name)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-panel border border-seam bg-sleeve p-4 sm:p-5">
        {request.list && fit && <p>{fitSummary(copies(request.list.entries), copies(fit.removed), copies(fit.added))}</p>}
        <p className={cn("flex items-start gap-2", request.list && "text-sm text-muted-foreground")}>
          {fromCollection && <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />}
          {summary(result, fromCollection)}
        </p>
        {roleShortfalls.length > 0 && <RoleShortfalls shortfalls={roleShortfalls} />}
        {/* Continue is the way on, so it takes two parts of the row to Save for Later's one. */}
        <div className="grid grid-cols-[2fr_1fr] gap-2 sm:max-w-md">
          <Button type="button" size="lg" className="lit" onClick={() => onUpgrade(decklist)}>
            Continue
          </Button>
          <Button type="button" size="lg" variant="outline" className="px-2" onClick={() => onSave(decklist)}>
            Save for Later
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
        // The buy side is shelved. The slot it will fill stays visible, honestly empty.
        <aside aria-labelledby="build-open-slots" className="rounded-panel border border-dashed border-seam p-4 max-sm:py-2">
          {/* Phones keep the panel to its heading; what the slots mean waits behind the (?). */}
          <div className="flex items-center justify-between gap-2">
            <h2 id="build-open-slots" className="font-semibold">
              {count(open, "open slot")}
            </h2>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className={cn(PHONE_HIT_AREA, "sm:hidden")} aria-label="What open slots mean">
                  <CircleHelp aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{count(open, "open slot")}</DialogTitle>
                  <DialogDescription>{OPEN_SLOTS_HELP}</DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </div>
          <p className="mt-1 text-sm text-muted-foreground max-sm:hidden">{OPEN_SLOTS_HELP}</p>
        </aside>
      )}

      <FitChanges request={request} result={result} />

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
            Basic Lands <span className="font-mono text-base font-normal text-muted-foreground">{basicCount}</span>
          </h2>
          <PocketGrid
            zoomable
            label="Basic Lands"
            items={result.basics.map((b) => ({
              card: b.card,
              caption: <span className="font-mono text-muted-foreground">{count(b.quantity, "copy", "copies")}</span>,
            }))}
          />
        </section>
      )}
    </section>
  );
}
