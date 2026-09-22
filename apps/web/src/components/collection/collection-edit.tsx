"use client";

import { useRef, useState } from "react";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";
import type { CollectionEditor } from "./use-collection-editor";
import type { CollectionViewItem } from "./use-collection-view";

/** Typing waits this long before searching, so a word is one request rather than one per letter. */
const SEARCH_DEBOUNCE_MS = 250;
/** A name search needs this many letters. */
const MIN_NAME_CHARS = 2;
/** Results shown for a name. */
const RESULT_LIMIT = 12;

const STEP_BUTTON =
  "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

/** Copies of a card, with − and + either side and a way to take the card out entirely. */
function CopyStepper({ card, quantity, editor }: { card: CardSummary; quantity: number; editor: CollectionEditor }) {
  const name = displayName(card);
  return (
    <div className="flex items-center gap-0.5">
      <button type="button" aria-label={`One fewer ${name}`} className={STEP_BUTTON} onClick={() => editor.setQuantity(card, quantity - 1)}>
        <Minus aria-hidden className="size-4" />
      </button>
      <span className="min-w-7 text-center text-sm font-bold tabular-nums" aria-label={`${quantity} copies of ${name}`}>
        {quantity}
      </span>
      <button type="button" aria-label={`One more ${name}`} className={STEP_BUTTON} onClick={() => editor.setQuantity(card, quantity + 1)}>
        <Plus aria-hidden className="size-4" />
      </button>
      <button type="button" aria-label={`Remove ${name}`} className={`${STEP_BUTTON} hover:text-cut`} onClick={() => editor.setQuantity(card, 0)}>
        <Trash2 aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** The collection's cards while editing: each with its copies and the controls to change them. */
export function EditableCards({ label, items, editor }: { label: string; items: CollectionViewItem[]; editor: CollectionEditor }) {
  return (
    <ul aria-label={label} className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
      {items.map((item) => (
        <li key={item.card.id} className="flex min-w-0 flex-col gap-1">
          <ZoomableCard card={item.card}>
            <CardImage card={item.card} variant="small" alt="" sizes="(min-width: 1024px) 160px, 30vw" />
          </ZoomableCard>
          <span className="line-clamp-2 text-[0.8125rem] leading-tight font-bold">{displayName(item.card)}</span>
          <CopyStepper card={item.card} quantity={item.quantity} editor={editor} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Adds cards by name, in any colour. A card already in the collection shows its copies with the same controls, so
 * searching is also a quick way to change a count.
 */
export function AddToCollection({ editor }: { editor: CollectionEditor }) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<CardSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef(0);

  function change(value: string) {
    setText(value);
    if (timer.current) clearTimeout(timer.current);
    const name = value.trim();
    if (name.length < MIN_NAME_CHARS) {
      request.current++;
      setResults(null);
      setMessage(null);
      return;
    }
    timer.current = setTimeout(async () => {
      const id = ++request.current;
      const r = await getApis().catalog.searchCards({ q: name, limit: RESULT_LIMIT });
      if (id !== request.current) return;
      if (r.ok) {
        setResults(r.data);
        setMessage(r.data.length === 0 ? "No card by that name." : null);
      } else {
        setResults(null);
        setMessage(r.error.message);
      }
    }, SEARCH_DEBOUNCE_MS);
  }

  return (
    <section aria-label="Add to your collection" className="flex flex-col gap-3 rounded-lg border border-seam bg-sleeve p-4">
      <h2 className="font-heading text-xl leading-none font-semibold">Add cards</h2>
      <div className="relative max-w-md">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Card to add"
          placeholder="Card name"
          value={text}
          onChange={(e) => change(e.target.value)}
          className="bg-background pl-9 text-base sm:text-sm"
        />
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      {results && results.length > 0 && (
        <ul aria-label="Cards to add" className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 lg:grid-cols-6">
          {results.map((card) => {
            const owned = editor.quantityOf(card);
            return (
              <li key={card.id} className="flex min-w-0 flex-col gap-1">
                <ZoomableCard card={card}>
                  <CardImage card={card} variant="small" alt="" sizes="(min-width: 1024px) 160px, 30vw" />
                </ZoomableCard>
                <span className="line-clamp-2 text-[0.8125rem] leading-tight font-bold">{displayName(card)}</span>
                {owned === 0 ? (
                  <Button type="button" size="sm" className="h-8" aria-label={`Add ${card.name}`} onClick={() => editor.add(card)}>
                    <Plus aria-hidden className="size-4" /> Add
                  </Button>
                ) : (
                  <CopyStepper card={card} quantity={owned} editor={editor} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
