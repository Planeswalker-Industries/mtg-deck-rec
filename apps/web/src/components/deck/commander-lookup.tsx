"use client";

import { CircleCheck, LoaderCircle } from "lucide-react";
import type { CardSummary, CommanderRequest } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { displayName } from "@/lib/cards";
import type { CommanderLookup, LookupState } from "./use-commander-lookup";

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** Archidekt reports 1,000 for any larger count. */
const listedDecks = (n: number) => (n >= 1000 ? "1,000+ decks" : plural(n, "deck"));

function minutes(seconds: number): string {
  const n = Math.max(1, Math.round(seconds / 60));
  return plural(n, "minute");
}

function timeLeft(seconds: number | null): string | null {
  if (seconds === null) return null;
  return seconds < 60 ? "Less than a minute left" : `About ${minutes(seconds)} left`;
}

function statusText(state: LookupState): string {
  if (state.phase === "complete") return "Complete!";
  if (state.phase !== "running") return "";
  const { request, stage, found } = state;
  if (stage === "rating") return "Rating cards";
  if (stage === "cuts") return "Making cuts";
  if (stage === "adds") return "Making recommendations";
  switch (request.status) {
    case "queued":
      if (!request.collectorOnline) return "Waiting for the deck collector to start";
      if (request.queuePosition > 0) return `In line behind ${plural(request.queuePosition, "other lookup")}`;
      // First in line: the collector picks it up within seconds.
      return "Scanning for decks with your commander";
    case "checking":
      return "Scanning for decks with your commander";
    case "collecting": {
      const listed = request.decksListed ?? request.decksTarget;
      if (found || request.decksCollected === 0) return `Commander found: ${listedDecks(listed)} on Archidekt`;
      return `Scanning deck ${request.decksCollected.toLocaleString("en-US")} of ${Math.min(request.decksTarget, listed).toLocaleString("en-US")}`;
    }
    case "aggregating":
      return "Analyzing";
    default:
      return "";
  }
}

/** Percent done, or null while the size of the job is still unknown. */
function progressValue(state: LookupState): number | null {
  if (state.phase === "complete") return 100;
  if (state.phase !== "running") return null;
  const { request, stage } = state;
  if (stage === "rating") return 90;
  if (stage === "cuts") return 94;
  if (stage === "adds") return 97;
  if (request.status === "aggregating") return 85;
  if (request.status !== "collecting") return null;
  const total = Math.max(1, Math.min(request.decksTarget, request.decksListed ?? request.decksTarget));
  return Math.round(5 + 75 * Math.min(request.decksCollected / total, 1));
}

function notEnoughMessage(request: CommanderRequest): string {
  const name = displayName(request.commander);
  if (request.status === "done") {
    return `We pulled ${plural(request.decksCollected, "deck")} for ${name}, but too few of them could be used for play rates. Recommendations are based on what cards do.`;
  }
  return `Archidekt only has ${plural(request.decksListed ?? request.decksCollected, "public deck")} for ${name} so far, not enough for play rates. Recommendations are based on what cards do.`;
}

function sheetCommander(state: LookupState): CardSummary | null {
  switch (state.phase) {
    case "prompt":
    case "declined":
    case "failed":
      return state.commander;
    case "running":
    case "complete":
    case "not_enough":
      return state.request.commander;
    default:
      return null;
  }
}

export function CommanderLookupSheet({ lookup }: { lookup: CommanderLookup }) {
  const { state } = lookup;
  const commander = sheetCommander(state);
  return (
    <Sheet open={lookup.open && commander !== null} onOpenChange={(open) => !open && lookup.close()}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] w-full max-w-xl gap-0 overflow-y-auto rounded-t-2xl border-seam bg-sleeve p-0"
      >
        {commander && (
          <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 px-4 pt-5 pb-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <CardImage card={commander} sizes="(min-width: 640px) 128px, 104px" eager className="row-span-2" />
            <SheetBody lookup={lookup} commander={commander} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SheetBody({ lookup, commander }: { lookup: CommanderLookup; commander: CardSummary }) {
  const { state } = lookup;
  const name = displayName(commander);

  if (state.phase === "prompt" || state.phase === "declined") {
    const starting = state.phase === "prompt" && state.starting;
    return (
      <>
        <SheetHeader className="p-0 pr-8">
          <SheetTitle className="font-heading text-2xl leading-tight font-extrabold tracking-tight">
            {name} isn&apos;t in our database yet
          </SheetTitle>
          <SheetDescription className="text-base text-foreground">
            Mind waiting about {minutes(state.estimatedSeconds)} while we pull public decks for it from Archidekt? You can
            keep using the deck tool meanwhile.
          </SheetDescription>
        </SheetHeader>
        <div className="col-span-2 mt-4 flex flex-col gap-3 sm:col-span-1">
          {!state.collectorOnline && (
            <p className="text-sm text-muted-foreground">Our deck collector is offline right now, so this may take longer.</p>
          )}
          {state.phase === "prompt" && state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => void lookup.approve()} disabled={starting}>
              {starting ? "Starting…" : "Pull decks"}
            </Button>
            <Button size="lg" variant="ghost" onClick={lookup.close} disabled={starting}>
              Not now
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (state.phase === "running" || state.phase === "complete") {
    const { request } = state;
    const joined = state.phase === "running" && request.joined && state.stage === null;
    const value = progressValue(state);
    const eta = state.phase === "running" && state.stage === null ? timeLeft(request.etaSeconds) : null;
    return (
      <>
        <SheetHeader className="p-0 pr-8">
          <SheetTitle className="font-heading text-2xl leading-tight font-extrabold tracking-tight">
            {state.phase === "complete"
              ? `${name} is in`
              : joined
                ? `Good news, looks like someone else is also looking for ${name}`
                : `Pulling decks for ${name}`}
          </SheetTitle>
          <SheetDescription className="text-base text-foreground">
            {state.phase === "complete"
              ? "Cuts and adds now use play rates from its decks."
              : joined
                ? "We're already working on it!"
                : "Your recommendations update when it's done."}
          </SheetDescription>
        </SheetHeader>
        <div className="col-span-2 mt-5 flex flex-col gap-2 sm:col-span-1">
          <p aria-live="polite" className="flex items-center gap-2 font-bold">
            {state.phase === "complete" ? (
              <CircleCheck aria-hidden className="size-5 text-primary" />
            ) : (
              <LoaderCircle aria-hidden className="size-5 text-primary motion-safe:animate-spin" />
            )}
            {statusText(state)}
          </p>
          <ProgressBar value={value} label={`Deck lookup for ${name}`} />
          {eta && <p className="text-sm text-muted-foreground tabular-nums">{eta}</p>}
          <div className="mt-2">
            {state.phase === "complete" ? (
              <Button size="lg" onClick={lookup.close}>
                See recommendations
              </Button>
            ) : (
              <Button size="lg" variant="outline" onClick={lookup.close}>
                Hide
              </Button>
            )}
          </div>
        </div>
      </>
    );
  }

  if (state.phase === "not_enough" || state.phase === "failed") {
    return (
      <>
        <SheetHeader className="p-0 pr-8">
          <SheetTitle className="font-heading text-2xl leading-tight font-extrabold tracking-tight">
            {state.phase === "not_enough" ? `Not enough decks for ${name} yet` : `Couldn't pull decks for ${name}`}
          </SheetTitle>
          <SheetDescription className="text-base text-foreground">
            {state.phase === "not_enough" ? notEnoughMessage(state.request) : `${state.message} Try again in a few minutes.`}
          </SheetDescription>
        </SheetHeader>
        <div className="col-span-2 mt-4 sm:col-span-1">
          <Button size="lg" variant="outline" onClick={lookup.close}>
            OK
          </Button>
        </div>
      </>
    );
  }

  return null;
}

/** The lookup in the deck tool while its sheet is closed: progress, a way back to the prompt, or why there's no data. */
export function CommanderLookupBar({ lookup }: { lookup: CommanderLookup }) {
  const { state } = lookup;
  if (lookup.open) return null;

  if (state.phase === "running") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-seam bg-sleeve px-3 py-2">
        <LoaderCircle aria-hidden className="size-4 shrink-0 text-primary motion-safe:animate-spin" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p aria-live="polite" className="truncate text-sm font-bold">
            {statusText(state)}
          </p>
          <ProgressBar value={progressValue(state)} label={`Deck lookup for ${displayName(state.request.commander)}`} className="h-1.5" />
        </div>
        <Button size="sm" variant="ghost" onClick={lookup.show}>
          Show
        </Button>
      </div>
    );
  }

  if (state.phase === "declined") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-seam bg-sleeve px-3 py-2">
        <p className="text-sm">No play data for {displayName(state.commander)} yet.</p>
        <Button size="sm" variant="outline" onClick={lookup.reconsider}>
          Pull decks
        </Button>
      </div>
    );
  }

  if (state.phase === "not_enough") {
    return <p className="text-sm text-muted-foreground">{notEnoughMessage(state.request)}</p>;
  }

  if (state.phase === "failed") {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t pull decks for {displayName(state.commander)}: {state.message}
      </p>
    );
  }

  return null;
}
