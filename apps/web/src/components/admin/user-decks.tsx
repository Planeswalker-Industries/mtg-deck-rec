"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDataProvider, useRecordContext } from "react-admin";
import { ChevronDown, ExternalLink, Layers } from "lucide-react";
import { cn } from "cn";
import { MAX_ADMIN_USER_DECKS, type AdminUser, type AdminUserDeck } from "@/lib/admin/types";
import { ErrorText } from "@/components/ui/error-text";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminDataProvider } from "./data-provider";
import { Pill, Pills } from "./pill";

/** Placeholder rows while the list loads: enough to read as a list, not so many that a short one jumps. */
const LOADING_ROWS = 3;
/** Placeholder lines while a deck's cards load. */
const LOADING_CARD_LINES = 6;

/**
 * Each read writes an audit row, so a look is fetched once and kept: no refetch when the window regains focus or the
 * tab is opened again in the same visit. Reloading the page is a new look, and a new row.
 */
export const ONE_LOOK = { staleTime: Infinity, refetchOnWindowFocus: false, retry: false } as const;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

/**
 * The account's saved decks, public and private, on the user page's Decks tab.
 *
 * React Admin mounts a tab's content only while the tab is shown, so this asks the server only once the tab opens:
 * an admin who looks at the account fields alone leaves no deck audit row behind.
 */
export function UserDecks() {
  const record = useRecordContext<AdminUser>();
  const dataProvider = useDataProvider<AdminDataProvider>();
  const userId = record?.id;
  const decks = useQuery({
    queryKey: ["admin", "user-decks", userId],
    queryFn: () => dataProvider.getUserDecks(String(userId)),
    enabled: userId !== undefined,
    ...ONE_LOOK,
  });

  if (decks.isError) return <ErrorText className="py-2">{decks.error.message}</ErrorText>;
  if (!decks.data) {
    return (
      <div className="flex flex-col gap-3 py-2" role="status" aria-label="Loading the decks">
        {Array.from({ length: LOADING_ROWS }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }
  if (decks.data.length === 0) {
    return (
      <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Layers aria-hidden className="size-4" />
        No saved decks.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col">
      <p className="text-xs text-muted-foreground">
        {decks.data.length === MAX_ADMIN_USER_DECKS
          ? `The newest ${MAX_ADMIN_USER_DECKS} decks.`
          : `${decks.data.length} ${decks.data.length === 1 ? "deck" : "decks"}, newest first.`}
      </p>
      <ul className="flex flex-col divide-y divide-seam">
        {decks.data.map((deck) => (
          <DeckRow key={deck.id} deck={deck} />
        ))}
      </ul>
    </div>
  );
}

function DeckRow({ deck }: { deck: AdminUserDeck }) {
  const [open, setOpen] = useState(false);
  const commanders = deck.commanderNames.length > 0 ? deck.commanderNames.join(" and ") : "No commander";

  return (
    <li className="min-w-0">
      <div className="flex items-start gap-2 py-3">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-expanded={open}
          aria-label={open ? `Hide the cards in ${deck.name}` : `Show the cards in ${deck.name}`}
          className="flex min-h-11 min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-primary transition-transform", open && "rotate-180")} />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="truncate text-sm font-semibold">{deck.name}</span>
            <span className="truncate text-xs text-muted-foreground">{commanders}</span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Pills emptyLabel="">
                {[
                  deck.isPublic ? (
                    <Pill key="visibility" tone="ink">
                      Public
                    </Pill>
                  ) : (
                    <Pill key="visibility" tone="muted">
                      Private
                    </Pill>
                  ),
                  deck.isBuilt && (
                    <Pill key="built" tone="ink">
                      Built
                    </Pill>
                  ),
                ]}
              </Pills>
              <span className="font-mono">{deck.cardCount} cards</span>
              <span>updated {shortDate(deck.updatedAt)}</span>
            </span>
          </span>
        </button>
        {deck.path && (
          <a
            href={deck.path}
            target="_blank"
            rel="noopener"
            aria-label={`Open ${deck.name}'s page in a new tab`}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ExternalLink aria-hidden className="size-4" />
          </a>
        )}
      </div>
      {open && <DeckCards deckId={deck.id} />}
    </li>
  );
}

/** Mounted on the first open only, so a deck nobody expands writes no audit row. */
function DeckCards({ deckId }: { deckId: string }) {
  const dataProvider = useDataProvider<AdminDataProvider>();
  const cards = useQuery({
    queryKey: ["admin", "deck-cards", deckId],
    queryFn: () => dataProvider.getDeckCards(deckId),
    ...ONE_LOOK,
  });

  return (
    <div className="border-t border-seam py-3 pl-7">
      {cards.isError && <ErrorText className="text-xs">{cards.error.message}</ErrorText>}
      {cards.isPending && (
        <div className="flex flex-col gap-1.5" role="status" aria-label="Loading the cards">
          {Array.from({ length: LOADING_CARD_LINES }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      )}
      {cards.data?.length === 0 && <p className="text-xs text-muted-foreground">No cards.</p>}
      {cards.data && cards.data.length > 0 && (
        <ul className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {cards.data.map((card) => (
            <li key={`${card.section}-${card.cardId}`} className="flex min-w-0 items-baseline gap-2 py-0.5">
              <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">{card.quantity}</span>
              <span className="min-w-0 truncate">{card.name}</span>
              {card.section === "commander" && <span className="shrink-0 text-muted-foreground">Commander</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
