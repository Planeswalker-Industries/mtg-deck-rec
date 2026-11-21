"use client";

import { createContext, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, Copy, RotateCcw, Save, Undo2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TEXT_LINK } from "@/lib/constants";
import { ErrorText } from "@/components/ui/error-text";

/** A copy saved from the round, or the attempt to save one. */
export type CopyState = { status: "idle" } | { status: "saving" } | { status: "saved"; name: string; href: Route } | { status: "error"; message: string };

/** What Save does here: write back to the open saved deck (with a copy as the other choice), or save a new deck. */
export type RoundSave =
  | { kind: "open"; deckName: string; onSaveChanges: () => void; onSaveCopy: () => void; copy: CopyState }
  | { kind: "new"; onSave: () => void };

/**
 * Where a step puts its status (`StepStatus`): the space beside the round's buttons, so the count sits on the same
 * row as Undo, Start over and Save rather than on a line of its own. Null until the round bar has mounted.
 */
export const StepStatusSlot = createContext<HTMLElement | null>(null);

/** Whether a key press is the player typing somewhere, where shortcuts must not fire. */
const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/**
 * The round's controls, on every step: Undo (the last choice, on whichever step it was made; also Z or Ctrl+Z), Start
 * over (after a confirm, so it is never hit by mistake for Undo; Undo brings the choices back) and Save, as icons. The
 * first row of the step's sheet, with the step's status in `slotRef` beside them, so a player who wants out or wants
 * to keep what they have never has to hunt for it.
 */
export function RoundBar({
  canUndo,
  onUndo,
  onStartOver,
  save,
  busy,
  showSave = true,
  slotRef,
}: {
  canUndo: boolean;
  onUndo: () => void;
  onStartOver: () => void;
  save: RoundSave;
  /** A save or re-analyze is under way: Save waits for it. */
  busy: boolean;
  /** False on Finish, which has its own Save buttons. */
  showSave?: boolean;
  /** Receives the element beside the buttons that the step's `StepStatus` renders into. */
  slotRef?: (el: HTMLElement | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.shiftKey || isTyping(e.target) || e.key.toLowerCase() !== "z") return;
      if (!canUndo) return;
      e.preventDefault();
      onUndo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUndo, onUndo]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-h-11 items-center gap-3">
        <div role="toolbar" aria-label="This round" className="flex shrink-0 items-center gap-1">
          <Button type="button" size="icon-lg" variant="ghost" onClick={onUndo} disabled={!canUndo} aria-label="Undo" aria-keyshortcuts="Z" title="Undo the last choice (Z)">
            <Undo2 aria-hidden />
          </Button>
          <Button type="button" size="icon-lg" variant="ghost" onClick={() => setConfirming(true)} aria-label="Start over" title="Start over">
            <RotateCcw aria-hidden />
          </Button>
          {!showSave ? null : save.kind === "new" ? (
            <Button type="button" size="icon-lg" variant="ghost" onClick={save.onSave} disabled={busy} aria-label="Save" title="Save">
              <Save aria-hidden />
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="gap-0.5 px-2"
                  disabled={busy || save.copy.status === "saving"}
                  aria-label={save.copy.status === "saving" ? "Saving" : "Save"}
                  title="Save"
                >
                  <Save aria-hidden />
                  <ChevronDown aria-hidden className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-56">
                <DropdownMenuItem className="flex-col items-start gap-0 text-primary focus:text-primary" onSelect={save.onSaveChanges}>
                  <span className="flex items-center gap-2 font-semibold">
                    <Save aria-hidden className="text-primary" />
                    Save changes
                  </span>
                  <span className="pl-6 text-xs text-muted-foreground">Writes this round into {save.deckName}</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="flex-col items-start gap-0 text-primary focus:text-primary" onSelect={save.onSaveCopy}>
                  <span className="flex items-center gap-2 font-semibold">
                    <Copy aria-hidden className="text-primary" />
                    Save as copy
                  </span>
                  <span className="pl-6 text-xs text-muted-foreground">A new deck; {save.deckName} stays as it is</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <div ref={slotRef} className="flex min-w-0 flex-1 items-center gap-3" />
      </div>
      {save.kind === "open" && save.copy.status === "saved" && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved as {save.copy.name}.{" "}
          <Link href={save.copy.href} className={cn(TEXT_LINK, "font-semibold")}>
            Open the copy
          </Link>
        </p>
      )}
      {save.kind === "open" && save.copy.status === "error" && <ErrorText>Couldn&apos;t save a copy: {save.copy.message}</ErrorText>}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start this round over?</DialogTitle>
            <DialogDescription>
              Every card added, cut and swapped this round goes back to how the deck started. Undo brings them back.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep going
              </Button>
            </DialogClose>
            <Button
              type="button"
              onClick={() => {
                setConfirming(false);
                onStartOver();
              }}
            >
              Start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
