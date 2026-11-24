"use client";

import { useSyncExternalStore } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { HINT_TEXT } from "@/lib/constants";
import { setToursEnabled, subscribeTours, toursEnabled } from "@/lib/tour-store";

const HELP = "Shows each page's tour once on this device. Turn it off and on to see them all again.";

/** On before the browser has said otherwise: the default, and what the server renders. */
const serverEnabled = () => true;

/**
 * The account page's one switch for every tour on this device: on shows each tour once, off shows none, and turning it
 * back on shows them all again. The label opens what it does; only the switch flips it.
 */
export function TutorialsToggle() {
  const on = useSyncExternalStore(subscribeTours, toursEnabled, serverEnabled);
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Dialog>
        <DialogTrigger className={`min-h-11 cursor-pointer font-semibold ${HINT_TEXT}`}>
          Tutorials
          <span className="sr-only">: What this does</span>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tutorials</DialogTitle>
            <DialogDescription>{HELP}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Switch
        id="tutorials"
        aria-label="Tutorials"
        // The switch's own hit area, 44 px tall; the gap keeps it clear of the label's.
        className="after:-inset-y-3.5"
        checked={on}
        onCheckedChange={setToursEnabled}
      />
    </div>
  );
}
