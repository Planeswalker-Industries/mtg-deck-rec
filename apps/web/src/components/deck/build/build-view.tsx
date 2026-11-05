"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, CircleCheck, CircleHelp, LoaderCircle, TriangleAlert } from "lucide-react";
import type { Bracket, BuildResult, CardId, CardSummary } from "@mtg/core/contract";
import { cardsShort, deckDiff, shortOfTarget, type StatLine } from "@mtg/core/journey";
import { CardPlate } from "@/components/cards/card-plate";
import { CardZoomLayer } from "@/components/cards/card-zoom";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { UnsavedDeckExport } from "@/components/decks/deck-export";
import { DeckViewToggle, useDeckView, type DeckView } from "@/components/decks/deck-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRACKETS, bracketLabel, cardCategoryLabel } from "@/lib/labels";
import { cn } from "cn";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { ShuffleDeck } from "../shuffle-deck";
import { ScoreExplainer } from "../score-explainer";
import {
  buildCards,
  buildDecklist,
  buildDecklistCsv,
  buildEntries,
  type BuildRequest,
  type BuildState,
} from "./use-deck-build";
import { useBuildStats } from "./use-build-stats";

/** What the open slots panel says, inline from sm up and behind its (?) on phones. */
const OPEN_SLOTS_HELP = "Your collection ran out of auto-includes. Hit continue and we'll fill the missing pieces together.";

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** What the build managed, in a few words: how many slots the collection filled (the open ones get their own panel). */
function summary(result: BuildResult, fromCollection: boolean): string {
  const { slots, filled } = result.feasibility;
  if (!fromCollection) return `All ${slots} cards picked from every card in print.`;
  return count(filled, "match", "matches");
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
function RoleShortfalls({ lines }: { lines: readonly StatLine[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-2">
        <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        Adjustments needed:
      </p>
      <ul aria-label="Roles the deck is short of" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:pl-7">
        {lines.map((line) => (
          <li
            key={line.key}
            className="flex min-w-0 items-center justify-between gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-sm"
          >
            <span className="truncate">{line.label}</span>
            <span className="shrink-0 font-mono text-warning">
              −{cardsShort(line)}
              <span className="sr-only"> {cardsShort(line) === 1 ? "card" : "cards"} short</span>
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

/** The build's estimated bracket against the one asked for: a status, so its colour comes with an icon and a word. */
function BracketEstimate({ asked, estimated }: { asked: Bracket; estimated: Bracket }) {
  const fits = estimated <= asked;
  const Icon = fits ? CircleCheck : TriangleAlert;
  return (
    <p className="flex items-center gap-2">
      <Icon aria-hidden className={cn("size-5 shrink-0", fits ? "text-success" : "text-destructive")} />
      {fits ? `Bracket ${asked}` : `Over bracket ${asked}`}
      <span className="text-xs text-muted-foreground">Estimated</span>
    </p>
  );
}

/**
 * One group of the build's cards, as whole card images or as plates (the toggle above the groups). In the image grid a
 * card with several copies says how many; `alwaysCount` says it for one copy too (basic lands).
 */
function BuildCards({
  view,
  label,
  entries,
  mark,
  alwaysCount = false,
  onSelect,
}: {
  view: DeckView;
  label: string;
  entries: readonly { card: CardSummary; quantity: number }[];
  mark?: "cut" | "add";
  alwaysCount?: boolean;
  /** Opens a card's zoom with its score. */
  onSelect?: (cardId: CardId) => void;
}) {
  if (view === "plates") {
    return (
      <ul aria-label={label} className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(({ card, quantity }) => (
          <CardPlate key={card.id} card={card} quantity={quantity} mark={mark} onSelect={onSelect ? () => onSelect(card.id) : undefined} />
        ))}
      </ul>
    );
  }
  return (
    <PocketGrid
      // A pocket that opens the zoom with its score doesn't need the magnifier.
      zoomable={!onSelect}
      label={label}
      {...(onSelect ? { onSelect: (card: CardSummary) => onSelect(card.id) } : {})}
      items={entries.map(({ card, quantity }) => ({
        card,
        ...(mark ? { mark } : {}),
        ...(alwaysCount || quantity > 1
          ? { caption: <span className="font-mono text-muted-foreground">{count(quantity, "copy", "copies")}</span> }
          : {}),
      }))}
    />
  );
}

/** The list's cards and the build's, side by side as what went out and what came in. */
/** A section of the built deck that folds from its heading; every one starts open. */
function BuildSection({ id, title, className, children }: { id: string; title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <details open className="group/section">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 marker:content-none [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <h2 id={id} className={cn("font-heading text-xl leading-none font-semibold", className)}>
            {title}
          </h2>
          <ChevronDown aria-hidden className="size-5 shrink-0 text-primary transition-transform group-open/section:rotate-180" />
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    </section>
  );
}

function FitChanges({ request, result, view }: { request: BuildRequest; result: BuildResult; view: DeckView }) {
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
    <BuildCards view={view} label={label} entries={entries} mark={mark} />
  );
  const out = named(diff.removed, list.cards);
  const into = named(diff.added, built);
  return (
    <>
      {out.length > 0 && (
        <BuildSection id="fit-out" className="text-cut" title="Out: not in your collection">
          {grid(out, "Cards from the list you don't own", "cut")}
        </BuildSection>
      )}
      {into.length > 0 && (
        <BuildSection id="fit-in" className="text-add" title="In: from your collection">
          {grid(into, "Cards from your collection that took their place", "add")}
        </BuildSection>
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
  onUpgrade: (decklist: string) => Promise<void>;
  onSave: (decklist: string) => Promise<void>;
  onPickAnother: () => void;
}) {
  const [view, setView] = useDeckView("build");
  const [detail, setDetail] = useState<CardId | null>(null);
  const [opening, setOpening] = useState<"upgrade" | "save" | null>(null);
  /** Set at once, so a second tap before the re-render can't open the deck twice. */
  const openingNow = useRef(false);
  // The built deck graded by Deck stats, the report Add reads after Continue; shown once the analysis is in.
  const ready = state.status === "ready" ? state : null;
  const builtList = useMemo(() => (ready ? buildDecklist(ready.result) : null), [ready]);
  const stats = useBuildStats(ready?.result ?? null, builtList, state.request.bracket);
  const shortRoles = stats?.stats.filter((s) => s.group === "roles" && shortOfTarget(s)) ?? [];
  /** One open at a time: the deck tool reads the list first, which takes a moment on a phone. */
  async function openDeck(kind: "upgrade" | "save", run: (decklist: string) => Promise<void>, decklist: string) {
    if (openingNow.current) return;
    openingNow.current = true;
    setOpening(kind);
    try {
      await run(decklist);
    } finally {
      openingNow.current = false;
      setOpening(null);
    }
  }
  const busy = (kind: "upgrade" | "save", label: string) =>
    opening === kind ? (
      <>
        <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
        Opening…
      </>
    ) : (
      label
    );
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
  const decklist = builtList ?? buildDecklist(result);
  const { open } = result.feasibility;
  const basicCount = result.basics.reduce((n, b) => n + b.quantity, 0);
  const builtCards = new Map(result.groups.flatMap((g) => g.cards).map((c) => [c.card.id, c]));
  const detailCard = detail === null ? null : (builtCards.get(detail) ?? null);
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
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className={cn("flex items-center gap-2", request.list && "text-sm text-muted-foreground")}>
            {fromCollection && <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />}
            {summary(result, fromCollection)}
          </p>
          <BracketEstimate asked={request.bracket} estimated={result.estimatedBracket} />
        </div>
        {shortRoles.length > 0 && <RoleShortfalls lines={shortRoles} />}
        {/* Continue is the way on, so it takes two parts of the row to Save for Later's one. */}
        <div className="grid grid-cols-[2fr_1fr] gap-2 sm:max-w-md">
          <Button
            type="button"
            size="lg"
            className="lit"
            disabled={opening !== null}
            aria-busy={opening === "upgrade"}
            onClick={() => void openDeck("upgrade", onUpgrade, decklist)}
          >
            {busy("upgrade", "Continue")}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="px-2"
            disabled={opening !== null}
            aria-busy={opening === "save"}
            onClick={() => void openDeck("save", onSave, decklist)}
          >
            {busy("save", "Save for Later")}
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
      {/* On phones the open slots panel shares a row with the view toggle, so the cards start higher. */}
      <div className="flex items-center gap-2 sm:flex-col sm:items-stretch sm:gap-6">
        {fromCollection && open > 0 && (
          // The buy side is shelved. The slot it will fill stays visible, honestly empty.
          <aside aria-labelledby="build-open-slots" className="rounded-panel border border-dashed border-seam p-4 max-sm:min-w-0 max-sm:flex-1 max-sm:px-3 max-sm:py-0">
            {/* Phones keep the panel to its heading; what the slots mean waits behind the (?). */}
            <div className="flex items-center justify-between gap-2">
              <h2 id="build-open-slots" className="font-semibold max-sm:text-sm">
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
        <DeckViewToggle view={view} onChange={setView} className="ml-auto max-sm:self-center" />
      </div>

      <FitChanges request={request} result={result} view={view} />

      {result.groups.map((group) => (
        <BuildSection
          key={group.category}
          id={`build-${group.category}`}
          title={
            <>
              {cardCategoryLabel[group.category]} <span className="font-mono text-base font-normal text-muted-foreground">{group.cards.length}</span>
            </>
          }
        >
          <BuildCards
            view={view}
            label={cardCategoryLabel[group.category]}
            entries={group.cards.map((c) => ({ card: c.card, quantity: 1 }))}
            onSelect={setDetail}
          />
        </BuildSection>
      ))}
      {result.basics.length > 0 && (
        <BuildSection
          id="build-basics"
          title={
            <>
              Basic Lands <span className="font-mono text-base font-normal text-muted-foreground">{basicCount}</span>
            </>
          }
        >
          <BuildCards view={view} label="Basic Lands" entries={result.basics.map((b) => ({ card: b.card, quantity: b.quantity }))} alwaysCount />
        </BuildSection>
      )}
      {detailCard && (
        <CardZoomLayer
          card={detailCard.card}
          onClose={() => setDetail(null)}
          footer={<ScoreExplainer score={detailCard.score} className="mt-0 bg-sleeve" />}
        />
      )}
    </section>
  );
}
