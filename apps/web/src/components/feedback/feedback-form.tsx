"use client";

import type { Route } from "next";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { MAX_FEEDBACK_CHARS } from "@mtg/core/schemas";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApis } from "@/lib/api/client";
import { TEXT_LINK } from "@/lib/constants";
import { isDeckPagePath } from "@/lib/feedback";

/** The form on /feedback. The page it was opened from goes with the message, and is where "Back" returns to. */
export function FeedbackForm({ fromPath }: { fromPath: string }) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const aboutDeck = isDeckPagePath(fromPath);

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p role="status" className="flex items-center gap-2 font-semibold">
          <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
          Sent. Thanks!
        </p>
        <Link href={fromPath as Route} className={`${TEXT_LINK} w-fit text-sm font-semibold`}>
          Back to the page
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await getApis().actions.submitFeedback({ message, pagePath: fromPath });
          if (result.ok) setSent(true);
          else setError(result.error.message);
        });
      }}
    >
      <Label htmlFor={id}>{aboutDeck ? "What's wrong with this deck?" : "What should we know?"}</Label>
      <Textarea
        id={id}
        name="message"
        required
        maxLength={MAX_FEEDBACK_CHARS}
        rows={6}
        value={message}
        onChange={(event) => {
          setMessage(event.target.value);
          setError(null);
        }}
        placeholder={aboutDeck ? "An abusive name, cards that shouldn't be there…" : "A bug, a bad suggestion, an idea…"}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-page`}
      />
      <p id={`${id}-page`} className="text-sm text-muted-foreground">
        Sent with the page: <span className="break-all">{fromPath}</span>
      </p>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="h-11 px-5" disabled={pending || message.trim().length === 0}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Link href={fromPath as Route} className={`${TEXT_LINK} text-sm font-semibold`}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
