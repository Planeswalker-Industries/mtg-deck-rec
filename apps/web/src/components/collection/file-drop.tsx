"use client";

import { useId, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";

/** What the four collection apps export. Anything else is almost certainly a mistake worth naming. */
const ACCEPT = ".csv,.txt,text/csv,text/plain";

/** Generous for a collection — a 50,000-row CSV is about 8 MB — and small enough to refuse a video by accident. */
const MAX_BYTES = 32 * 1024 * 1024;

/**
 * The paste box on the deck and collection forms. It grows with its text up to about a phone screen's third and then
 * scrolls inside, so a long paste never pushes the button that submits it off the page.
 */
export const IMPORT_TEXT_BOX = "max-h-72 overflow-y-auto bg-sleeve text-base sm:text-sm";

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

/**
 * Takes a collection or deck export as a file, by drop or by picker.
 *
 * Pasting a 50,000-row CSV is not something anyone will do, so a file is the real path for a real collection. The
 * file is read in the browser, which is why the error for an unreadable one has to be specific rather than
 * "something went wrong" — nothing has left the machine yet to blame. Where the contents go next is the caller's
 * business, and its `note` has to say so.
 */
export function FileDrop({
  onFile,
  note,
  disabled = false,
}: {
  /** Called with the file's text and its name, once it has been read. */
  onFile: (text: string, fileName: string) => void;
  /** The line under the control. Say where the file goes: a collection is matched here, a decklist is sent to be read. */
  note: string;
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function take(file: File | undefined) {
    if (!file || disabled) return;
    setProblem(null);
    if (file.size > MAX_BYTES) {
      setProblem(`${file.name} is ${mb(file.size)}. Files up to ${mb(MAX_BYTES)} can be imported.`);
      return;
    }
    try {
      const text = await file.text();
      if (text.trim() === "") {
        setProblem(`${file.name} is empty.`);
        return;
      }
      onFile(text, file.name);
    } catch {
      setProblem(`Couldn't read ${file.name}. If it's open in another program, close it and try again.`);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
        className={cn(
          "rounded-xl border border-dashed p-6 text-center transition-colors",
          over ? "border-primary bg-primary/5" : "border-seam",
          disabled && "opacity-60",
        )}
      >
        <Upload aria-hidden className="mx-auto size-5 text-muted-foreground" />
        <p className="mt-2 text-sm">
          {/* The label is the control: a bare button would need its own click handler to reach the hidden input. */}
          <label
            htmlFor={inputId}
            className={cn(
              "font-bold text-primary underline-offset-4 hover:underline",
              disabled ? "cursor-default" : "cursor-pointer",
            )}
          >
            Choose a file
          </label>{" "}
          <span className="text-muted-foreground">or drag one here</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT}
          disabled={disabled}
          className="sr-only"
          onChange={(e) => {
            void take(e.target.files?.[0]);
            // Let the same file be chosen again after a failed import.
            e.target.value = "";
          }}
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Counts a file's lines for the chip, ignoring blank ones, so "300 lines" means 300 entries to the player. */
export function lineCount(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

/**
 * Stands in for the drop zone and the text box once a file has been read. A 300-row export shown in full pushes the
 * button that imports it thousands of pixels down; a file isn't something anyone reads line by line before using, so
 * the name and a count are enough, with the text a tap away for anyone who wants to check it.
 */
export function LoadedFile({
  name,
  lines,
  textShown,
  onToggleText,
  onRemove,
  disabled = false,
}: {
  name: string;
  lines: number;
  textShown: boolean;
  onToggleText: () => void;
  onRemove: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-seam bg-sleeve py-2 pr-2 pl-4">
      <FileText aria-hidden className="size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{name}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {lines.toLocaleString()} line{lines === 1 ? "" : "s"}
        </p>
      </div>
      <Button type="button" size="sm" variant="ghost" aria-expanded={textShown} onClick={onToggleText}>
        {textShown ? "Hide text" : "Show text"}
      </Button>
      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${name}`} disabled={disabled} onClick={onRemove}>
        <X aria-hidden />
      </Button>
    </div>
  );
}
