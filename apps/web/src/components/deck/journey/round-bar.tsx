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

/** What became of "Save as copy": the copy's name and a link to it, or why it failed. Nothing while idle or saving. */
export function CopySaveStatus({ save }: { save: RoundSave }) {
  if (save.kind !== "open") return null;
  const { copy } = save;
  if (copy.status === "saved")
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Saved as {copy.name}.{" "}
        <Link href={copy.href} className={cn(TEXT_LINK, "font-semibold")}>
          Open the copy
        </Link>
      </p>
    );
  return copy.status === "error" ? <ErrorText>Couldn&apos;t save a copy: {copy.message}</ErrorText> : null;
}

/**
 * A round control: its icon over its name, so the name shows without a hover or a tap that would also act (T102). One
 * touch target tall, the same row height as the icons alone had on a phone, so the swipe card doesn't move.
 */
const LABELLED_ICON = "h-11 min-w-11 flex-col gap-0.5 px-2 text-xs leading-none";

/** Whether a key press is the player typing somewhere, where shortcuts must not fire. */
const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/** What the round's controls need: Undo, Start over and Save. */
interface RoundControlsProps {
  canUndo: boolean;
  onUndo: () => void;
  onStartOver: () => void;
  save: RoundSave;
  /** A save is under way: Save waits for it. */
  busy: boolean;
  /** Receives the element between Start over and Save that the step's `StepStatus` renders into. */
  slotRef?: (el: HTMLElement | null) => void;
  className?: string;
}

/**
 * The round's controls as labelled icons: Undo (the last choice, on whichever step it was made; also Z or Ctrl+Z), Start
 * over (after a confirm, so it is never hit by mistake for Undo; Undo brings the choices back), and Save at the right
 * (owner, 2026-11-23), with the step's status between them when `slotRef` is given. Finish puts them in its top
 * sheet's top right.
 */
export function RoundControls({ canUndo, onUndo, onStartOver, save, busy, slotRef, className }: RoundControlsProps) {
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
    <>
        <div role="group" aria-label="This round" className={cn("flex min-h-11 items-center gap-1", className)}>
          <Button type="button" variant="ghost" className={LABELLED_ICON} onClick={onUndo} disabled={!canUndo} aria-keyshortcuts="Z" title="Undo the last choice (Z)">
            <Undo2 aria-hidden />
            Undo
          </Button>
          <Button type="button" variant="ghost" className={LABELLED_ICON} onClick={() => setConfirming(true)}>
            <RotateCcw aria-hidden />
            Start over
          </Button>
          {slotRef && <div ref={slotRef} className="mx-2 flex min-w-0 flex-1 items-center gap-3" />}
          {save.kind === "new" ? (
            <Button type="button" variant="ghost" className={LABELLED_ICON} onClick={save.onSave} disabled={busy}>
              <Save aria-hidden />
              Save
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  className={LABELLED_ICON}
                  disabled={busy || save.copy.status === "saving"}
                  aria-label={save.copy.status === "saving" ? "Saving" : "Save"}
                >
                  <Save aria-hidden />
                  <span className="flex items-center gap-0.5">
                    Save
                    <ChevronDown aria-hidden className="size-3" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
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
    </>
  );
}

/**
 * The round's controls as the first row of every step's sheet but Finish's (which carries them in its top sheet), with
 * the step's status in `slotRef` between them, so a player who wants out or wants to keep what they have never has to
 * hunt for it.
 */
export function RoundBar(props: RoundControlsProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <RoundControls {...props} />
      <CopySaveStatus save={props.save} />
    </div>
  );
}
