"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Switch } from "@/components/ui/switch";
import { HINT_TEXT } from "@/lib/constants";

/** What a toggle's save reports: nothing when it worked, else the message to show. */
type SaveResult = string | null;

/**
 * A small labelled switch for a saved deck's page ("Public", "Built") or for the collection ("Public"). The label is
 * dotted-underlined and opens what the switch means; only the switch itself flips it, so a tap meant for the
 * explanation never changes who can see something. The switch moves at once and goes back if saving fails.
 */
export function DeckToggle({
  id,
  label,
  checked,
  onSave,
  helpLabel,
  helpTitle,
  help,
}: {
  id: string;
  label: string;
  checked: boolean;
  onSave: (next: boolean) => Promise<SaveResult>;
  /** Read out after the label on the explanation's trigger ("Public: Who can see this deck"). */
  helpLabel: string;
  helpTitle: (on: boolean) => string;
  help: ReactNode;
}) {
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end">
      <div className="flex min-h-11 items-center gap-3">
        <Dialog>
          <DialogTrigger className={`min-h-11 cursor-pointer text-sm font-semibold ${HINT_TEXT}`}>
            {label}
            <span className="sr-only">: {helpLabel}</span>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{helpTitle(on)}</DialogTitle>
              <DialogDescription>{help}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
        <Switch
          id={id}
          aria-label={label}
          // The switch's own hit area, now that its label opens the explanation instead: 44 px tall, and the gap keeps it
          // clear of the label's.
          className="after:-inset-y-3.5"
          checked={on}
          disabled={pending}
          onCheckedChange={(next) => {
            const previous = on;
            setOn(next);
            setError(null);
            startTransition(async () => {
              const message = await onSave(next).catch(() => "Couldn't save that. Check your connection and try again.");
              if (message !== null) {
                setOn(previous);
                setError(message);
              }
            });
          }}
        />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
