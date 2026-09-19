"use client";

import { useId, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "cn";

/** What the four collection apps export. Anything else is almost certainly a mistake worth naming. */
const ACCEPT = ".csv,.txt,text/csv,text/plain";

/** Generous for a collection — a 50,000-row CSV is about 8 MB — and small enough to refuse a video by accident. */
const MAX_BYTES = 32 * 1024 * 1024;

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
