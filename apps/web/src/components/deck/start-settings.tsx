"use client";

import { useId, useState, type ReactNode, type Ref } from "react";
import Link from "next/link";
import type { Route } from "next";
import type { Bracket, DeckBudget } from "@mtg/core/contract";
import { deckBudgetSchema } from "@mtg/core/schemas";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HINT_TEXT, TEXT_LINK } from "@/lib/constants";
import { BRACKETS, bracketLabel } from "@/lib/labels";

/** The most a budget field takes: "$100,000.00" plus a stray space. */
const MAX_BUDGET_INPUT_CHARS = 12;

/** A budget field as typed: blank is no limit. */
type Field = "cardCapUsd" | "spendUsd";

const FIELDS: readonly { key: Field; label: string; help: string }[] = [
  {
    key: "cardCapUsd",
    label: "Max per card",
    help: "No card you don't own comes in above this. Cards you own and basic lands always can.",
  },
  {
    key: "spendUsd",
    label: "Max to spend",
    help: "The cards you don't own that come in add up to no more than this. Cards you own cost nothing.",
  },
];

/** The typed text as a dollar amount: blank is none, anything else not a number is NaN (the schema refuses it). */
const amountOf = (text: string): number | undefined => (text.trim() === "" ? undefined : Number(text.trim().replace(/^\$/, "")));

/** The text a budget field starts with. */
const textOf = (usd: number | undefined) => (usd === undefined ? "" : String(usd));

/** A budget as one comparable value. */
const keyOf = (budget: DeckBudget | undefined) => `${budget?.cardCapUsd ?? ""}|${budget?.spendUsd ?? ""}`;

/** A label that opens what its control means: white with a blue dotted underline, tapped or clicked (`HINT_TEXT`). */
function HintLabel({ label, title, children, htmlFor }: { label: string; title: string; children: ReactNode; htmlFor?: string }) {
  return (
    <Dialog>
      <DialogTrigger className={cn("w-fit min-h-11 cursor-pointer text-sm font-semibold", HINT_TEXT)} aria-describedby={htmlFor}>
        {label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{children}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The two budget fields (T091), on the start form and in the Deck stats sheet: Max per card and Max to spend, in
 * dollars. A field left blank is no limit; a typed one that isn't a dollar amount says so and keeps the last good
 * budget. A $0 spend without a collection says what that leaves, with the import.
 */
export function BudgetFields({
  budget,
  onBudget,
  importHref,
}: {
  budget: DeckBudget | undefined;
  onBudget: (budget: DeckBudget | undefined) => void;
  /** The collection import, offered beside a $0 spend; null when the player has a collection. */
  importHref: Route | null;
}) {
  const id = useId();
  const [text, setText] = useState<Record<Field, string>>({ cardCapUsd: textOf(budget?.cardCapUsd), spendUsd: textOf(budget?.spendUsd) });
  const [error, setError] = useState<string | null>(null);
  // A budget set from elsewhere (a remembered or reopened deck, the other copy of these fields) shows here too; the
  // player's own typing is the budget already, so it isn't rewritten ("5." stays "5.").
  const [shown, setShown] = useState(keyOf(budget));
  if (keyOf(budget) !== shown) {
    setShown(keyOf(budget));
    setText({ cardCapUsd: textOf(budget?.cardCapUsd), spendUsd: textOf(budget?.spendUsd) });
    setError(null);
  }

  function change(field: Field, value: string) {
    const next = { ...text, [field]: value };
    setText(next);
    const typed: Record<string, number> = {};
    for (const { key } of FIELDS) {
      const amount = amountOf(next[key]);
      if (amount !== undefined) typed[key] = amount;
    }
    const parsed = deckBudgetSchema.safeParse(typed);
    if (!parsed.success) {
      // A typed amount that isn't a number reads as the field's own message ("Enter a price per card.").
      setError(parsed.error.issues[0]?.message ?? "Enter an amount in dollars.");
      return;
    }
    setError(null);
    setShown(keyOf(parsed.data));
    onBudget(parsed.data);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        {FIELDS.map(({ key, label, help }) => (
          <div key={key} className="flex flex-col">
            <HintLabel label={label} title={label} htmlFor={`${id}-${key}`}>
              {help} Leave it blank for no limit.
            </HintLabel>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-muted-foreground">
                $
              </span>
              <Input
                id={`${id}-${key}`}
                aria-label={label}
                inputMode="decimal"
                autoComplete="off"
                placeholder="No limit"
                value={text[key]}
                aria-invalid={error !== null && amountOf(text[key]) !== undefined}
                onChange={(e) => change(key, e.target.value)}
                maxLength={MAX_BUDGET_INPUT_CHARS}
                className="pl-6 font-mono"
              />
            </div>
          </div>
        ))}
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {budget?.spendUsd === 0 && importHref && (
        <p className="text-sm text-muted-foreground">
          With $0 we can only use cards you own.{" "}
          <Link href={importHref} className={cn(TEXT_LINK, "font-semibold")}>
            Import collection
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * The start form's settings (T091), on the paste screen and Choose commander: the Bracket to aim for (3 until the player
 * picks another) and an optional budget, always shown.
 */
export function StartSettings({
  bracket,
  onBracket,
  budget,
  onBudget,
  importHref,
  bracketRef,
}: {
  bracket: Bracket;
  onBracket: (bracket: Bracket) => void;
  budget: DeckBudget | undefined;
  onBudget: (budget: DeckBudget | undefined) => void;
  /** The collection import, offered beside a $0 spend; null when the player has a collection. */
  importHref: Route | null;
  /** The Bracket select, for the above-bracket warning's Cancel to bring the player back to it. */
  bracketRef?: Ref<HTMLButtonElement>;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <HintLabel label="Bracket" title="Bracket" htmlFor={`${id}-bracket`}>
          How strong the deck should play. Suggestions keep to it, and a deck above it is brought down to it. 3 (Upgraded) suits most
          tables.
        </HintLabel>
        <Select value={String(bracket)} onValueChange={(value) => onBracket(Number(value) as Bracket)}>
          <SelectTrigger ref={bracketRef} id={`${id}-bracket`} aria-label="Bracket" className="h-11 min-w-44 bg-sleeve">
            <SelectValue>{bracketLabel[bracket]}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            {BRACKETS.map((b) => (
              <SelectItem key={b} value={String(b)}>
                {bracketLabel[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div role="group" aria-labelledby={`${id}-budget`} className="flex flex-col gap-1">
        <h3 id={`${id}-budget`} className="text-sm font-semibold">
          Budget
        </h3>
        <BudgetFields budget={budget} onBudget={onBudget} importHref={importHref} />
      </div>
    </div>
  );
}
