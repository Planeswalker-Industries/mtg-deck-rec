"use client";

import { useState, type ReactNode } from "react";
import { Minus, Plus, Repeat2, Trash2 } from "lucide-react";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import type { CardSummary, DeckAnalysis, RecContext } from "@mtg/core/contract";
import { deckStats, isBasicLand } from "@mtg/core/journey";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { GameChangerBadge } from "@/components/deck/card-label";
import { groupHeading } from "@/components/deck/deck-group-id";
import { SwapSheet } from "@/components/deck/swap-sheet";
import { displayName } from "@/lib/cards";
import { formatAsOf, formatUsd } from "@/lib/format";
import { CardSearchPanel } from "./card-search-panel";
import type { DeckBuilderState } from "./use-deck-builder";

/** Average mana value to one decimal: finer than that is noise at deck scale. */
const MANA_VALUE_DECIMALS = 1;

const WUBRG = "WUBRG";

function IconButton({ label, onClick, children, tone }: { label: string; onClick: () => void; children: ReactNode; tone?: "cut" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        tone === "cut" && "hover:text-cut",
      )}
    >
      {children}
    </button>
  );
}

/** One card in the deck: its image, its name, and what can be done to it. */
function DeckCard({
  card,
  quantity,
  onRemove,
  onQuantity,
  onReplace,
}: {
  card: CardSummary;
  quantity: number;
  onRemove: () => void;
  onQuantity?: ((quantity: number) => void) | undefined;
  onReplace?: (() => void) | undefined;
}) {
  const name = displayName(card);
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <ZoomableCard card={card}>
        <CardImage card={card} alt="" sizes="(min-width: 1024px) 140px, 30vw" />
      </ZoomableCard>
      <span className="line-clamp-2 text-[0.8125rem] leading-tight font-bold">{name}</span>
      {card.gameChanger && <GameChangerBadge />}
      <div className="flex flex-wrap items-center gap-0.5">
        {onQuantity && (
          <>
            <IconButton label={`One fewer ${name}`} onClick={() => onQuantity(quantity - 1)}>
              <Minus aria-hidden className="size-4" />
            </IconButton>
            <span className="min-w-6 text-center text-sm font-bold tabular-nums" aria-label={`${quantity} copies`}>
              {quantity}
            </span>
            <IconButton label={`One more ${name}`} onClick={() => onQuantity(quantity + 1)}>
              <Plus aria-hidden className="size-4" />
            </IconButton>
          </>
        )}
        {onReplace && (
          <IconButton label={`Replace ${name}`} onClick={onReplace}>
            <Repeat2 aria-hidden className="size-4" />
          </IconButton>
        )}
        <IconButton label={`Remove ${name}`} onClick={onRemove} tone="cut">
          <Trash2 aria-hidden className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

const GRID = "grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 xl:grid-cols-5";

/**
 * The deckbuilder: the deck by card type with every card editable, and a search to add more. On a phone the two are
 * tabs; from `lg` up they sit side by side and the search stays in view while the deck scrolls.
 *
 * `analysis` is the host's latest reading of the deck (legality, bracket, commander), used for the problems list and
 * for asking for replacements; it lags an edit by the host's debounce, which is why card counts come from the builder.
 */
export function DeckBuilder({
  builder,
  analysis,
  swapContext,
  showIssues = true,
}: {
  builder: DeckBuilderState;
  analysis: DeckAnalysis | null;
  /** Bracket and Game Changer choice for replacements; null hides Replace until the deck has been read. */
  swapContext: RecContext | null;
  /** The deck tool lists the deck's issues above the builder already, so it turns this copy off. */
  showIssues?: boolean;
}) {
  const [tab, setTab] = useState<"deck" | "add">("deck");
  const stats = deckStats([...builder.commanders.map((card) => ({ card, quantity: 1 })), ...builder.main]);
  const identity = builder.commanders.length === 0 ? undefined : [...WUBRG].filter((c) => builder.commanders.some((cmd) => cmd.colorIdentity.includes(c))).join("");
  const issues = analysis?.issues ?? [];
  const swapTarget = builder.swap ? (builder.cards.get(builder.swap.targetCardId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-seam bg-sleeve px-4 py-3 text-sm">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Cards</dt>
          <dd className={cn("font-bold tabular-nums", builder.size !== COMMANDER_DECK_SIZE && "text-cut")}>
            {builder.size} / {COMMANDER_DECK_SIZE}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Lands</dt>
          <dd className="font-bold tabular-nums">{stats.lands}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Average mana value</dt>
          <dd className="font-bold tabular-nums">{stats.averageManaValue.toFixed(MANA_VALUE_DECIMALS)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-bold tabular-nums">
            {formatUsd(stats.priceUsd)}
            {stats.priceAsOf && <span className="font-normal text-muted-foreground"> as of {formatAsOf(stats.priceAsOf)}</span>}
          </dd>
        </div>
      </dl>
      {showIssues && issues.length > 0 && (
        <details className="rounded-lg border border-cut/40 bg-cut/5 px-4 py-2 text-sm">
          <summary className="cursor-pointer font-bold text-cut">
            {issues.length} deck issue{issues.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}

      <div role="group" aria-label="Show" className="inline-flex w-fit rounded-lg bg-muted p-0.5 lg:hidden">
        {(["deck", "add"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
              tab === t ? "bg-sleeve text-foreground shadow-[0_1px_0_var(--seam)]" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "deck" ? "Deck" : "Add cards"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Deck list" className={cn("flex min-w-0 flex-col gap-6", tab === "add" && "hidden lg:flex")}>
          <section aria-labelledby="builder-commanders" className="flex flex-col gap-2">
            <h2 id="builder-commanders" className="font-heading text-xl leading-none font-semibold">
              Commander{builder.commanders.length > 1 ? "s" : ""}
            </h2>
            {builder.commanders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No commander yet. Search for a legendary creature and make it the commander.</p>
            ) : (
              <ul aria-label="Commanders" className={GRID}>
                {builder.commanders.map((card) => (
                  <DeckCard key={card.id} card={card} quantity={1} onRemove={() => builder.remove(card)} />
                ))}
              </ul>
            )}
          </section>
          {builder.groups.map((group) => (
            <section key={group.key} aria-label={groupHeading(group.label)} className="flex flex-col gap-2">
              <h2 className="font-heading text-xl leading-none font-semibold">
                {groupHeading(group.label)} <span className="font-sans text-sm font-normal text-muted-foreground tabular-nums">{group.count}</span>
              </h2>
              <ul aria-label={groupHeading(group.label)} className={GRID}>
                {group.entries.map(({ card, quantity }) => (
                  <DeckCard
                    key={card.id}
                    card={card}
                    quantity={quantity}
                    onRemove={() => builder.remove(card)}
                    onQuantity={isBasicLand(card) ? (n) => builder.setQuantity(card, n) : undefined}
                    onReplace={swapContext ? () => void builder.openSwap(card, swapContext) : undefined}
                  />
                ))}
              </ul>
            </section>
          ))}
        </section>
        <aside className={cn("lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto", tab === "deck" && "hidden lg:block")}>
          <CardSearchPanel builder={builder} colorIdentity={identity} />
        </aside>
      </div>

      <SwapSheet
        swap={builder.swap}
        target={swapTarget}
        commanderCount={builder.commanders.length}
        onClose={builder.closeSwap}
        onSwapIn={swapTarget ? (replacement) => builder.swapIn(swapTarget, replacement) : undefined}
      />
    </div>
  );
}
