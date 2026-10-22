"use client";

import { useState, useTransition, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ErrorText } from "@/components/ui/error-text";
import { Switch } from "@/components/ui/switch";
import { PHONE_HIT_AREA } from "@/lib/constants";

/** What a toggle's save reports: nothing when it worked, else the message to show. */
type SaveResult = string | null;

/**
 * A small labelled switch for a saved deck's page ("Public", "Built") or for the collection ("Public"), with what it
 * means behind its (?). The switch moves at once and goes back if saving fails.
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
  /** The (?) button's accessible name. */
  helpLabel: string;
  helpTitle: (on: boolean) => string;
  help: ReactNode;
}) {
  const [on, setOn] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          {label}
          <Switch
            id={id}
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
        </label>
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className={PHONE_HIT_AREA} aria-label={helpLabel}>
              <CircleHelp aria-hidden />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{helpTitle(on)}</DialogTitle>
              <DialogDescription>{help}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
