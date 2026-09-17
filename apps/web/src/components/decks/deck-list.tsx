"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Copy, Pencil, Trash2 } from "lucide-react";
import type { DeckId, SavedDeckSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { ColorIdentity } from "@/components/deck/color-identity";
import { Input } from "@/components/ui/input";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";

/** Below this many decks a filter box is clutter; the cap is 100, so it earns its place well before then. */
const FILTER_FROM = 8;

export function DeckList({ decks }: { decks: SavedDeckSummary[] }) {
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DeckId | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return decks;
    return decks.filter((d) => d.name.toLowerCase().includes(needle));
  }, [decks, filter]);

  /** Each action revalidates /decks on the server, so the list re-renders with fresh data. */
  function run(work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) setError(result.error.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {decks.length >= FILTER_FROM && (
        <Input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name"
          aria-label="Filter decks by name"
          className="h-10 max-w-xs bg-sleeve"
        />
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-muted-foreground">No deck matches “{filter.trim()}”.</p>
      ) : (
        <ul className={cn("flex flex-col gap-px overflow-hidden rounded-xl bg-seam", pending && "opacity-60")}>
          {shown.map((deck) => (
            <li key={deck.id} className="bg-sleeve p-3 sm:p-4">
              {renaming === deck.id ? (
                <RenameRow
                  deck={deck}
                  onCancel={() => setRenaming(null)}
                  onSubmit={(name) => {
                    setRenaming(null);
                    run(() => getApis().actions.renameDeck({ deckId: deck.id, name }));
                  }}
                />
              ) : (
                <div className="flex items-center gap-3">
                  <DeckArt deck={deck} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={deckHref(deck)}
                      className="block truncate font-heading text-lg leading-tight font-semibold hover:text-primary"
                    >
                      {deck.name}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className="truncate">{commanderLabel(deck)}</span>
                      <ColorIdentity identity={identityOf(deck)} />
                      <span className="tabular-nums">{deck.cardCount} cards</span>
                      {!deck.isPublic && <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Private</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/deck?deck=${deck.code}` as Route}
                      aria-label={`Open ${deck.name} in the deck tool`}
                      className="rounded-md px-2 py-1.5 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      Open
                    </Link>
                    <RowButton label={`Rename ${deck.name}`} onClick={() => setRenaming(deck.id)}>
                      <Pencil aria-hidden className="size-4" />
                    </RowButton>
                    <RowButton
                      label={`Duplicate ${deck.name}`}
                      onClick={() => run(() => getApis().actions.duplicateDeck({ deckId: deck.id }))}
                    >
                      <Copy aria-hidden className="size-4" />
                    </RowButton>
                    <RowButton
                      label={`Delete ${deck.name}`}
                      destructive
                      onClick={() => {
                        // Deleting is not undoable and the deck may already be shared, so confirm first.
                        if (!window.confirm(`Delete “${deck.name}”? This can't be undone.`)) return;
                        run(() => getApis().actions.deleteDeck({ deckId: deck.id }));
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </RowButton>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RowButton({
  label,
  onClick,
  destructive = false,
  children,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        destructive ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RenameRow({
  deck,
  onSubmit,
  onCancel,
}: {
  deck: SavedDeckSummary;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(deck.name);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (trimmed && trimmed !== deck.name) onSubmit(trimmed);
        else onCancel();
      }}
    >
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        aria-label={`New name for ${deck.name}`}
        maxLength={80}
        className="h-10 bg-background"
      />
      <button type="submit" className="h-10 shrink-0 rounded-md bg-primary px-3 text-sm font-bold text-primary-foreground">
        Save
      </button>
      <button type="button" onClick={onCancel} className="h-10 shrink-0 rounded-md px-3 text-sm font-bold text-muted-foreground hover:text-foreground">
        Cancel
      </button>
    </form>
  );
}

function DeckArt({ deck }: { deck: SavedDeckSummary }) {
  const art = deck.commanderKey.commanders[0]?.images?.front.artCrop;
  if (!art) return <span aria-hidden className="size-12 shrink-0 rounded-md bg-seam sm:h-12 sm:w-16" />;
  return (
    <Image
      src={art}
      alt=""
      width={96}
      height={70}
      unoptimized
      className="h-12 w-12 shrink-0 rounded-md object-cover ring-1 ring-seam sm:w-16"
    />
  );
}

function commanderLabel(deck: SavedDeckSummary): string {
  const names = deck.commanderKey.commanders.map(displayName);
  return names.length === 0 ? "No commander" : names.join(" and ");
}

/** The commander segment is decoration; the code is what resolves the deck. */
function deckHref(deck: SavedDeckSummary): Route {
  const commander = deck.commanderKey.commanders[0]?.slug ?? "deck";
  return `/decks/${commander}/${deck.code}` as Route;
}

const WUBRG = "WUBRG";

function identityOf(deck: SavedDeckSummary): string {
  const colors = new Set(deck.commanderKey.commanders.flatMap((c) => [...c.colorIdentity]));
  return [...WUBRG].filter((c) => colors.has(c)).join("");
}
