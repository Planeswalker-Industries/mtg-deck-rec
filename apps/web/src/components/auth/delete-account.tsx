"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { deleteAccountAction } from "@/app/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DELETE_CONFIRMATION } from "@/lib/account";

/**
 * Account deletion, behind a typed confirmation: it can't be undone, so one click is never enough. Collapsed until
 * asked for, so the account page doesn't lead with it.
 */
export function DeleteAccount() {
  const router = useRouter();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = typed.trim().toLowerCase() === DELETE_CONFIRMATION;

  if (!open) {
    return (
      <div>
        <Button type="button" variant="ghost" className="h-10 px-4 text-destructive" onClick={() => setOpen(true)}>
          Delete account…
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby={`${inputId}-heading`} className="flex flex-col gap-3 rounded-lg border border-destructive/50 p-4">
      <h2 id={`${inputId}-heading`} className="font-heading text-xl font-bold">
        Delete your account
      </h2>
      <p className="text-sm">
        This removes your account, your saved decks (including public ones, whose links stop working) and your
        collection. It can&apos;t be undone.
      </p>
      <p className="text-sm text-muted-foreground">
        We keep your email address on file to prevent abuse, such as banned accounts signing up again. Votes you cast
        are kept with nothing linking them to you, and play-rate statistics never held your name. See the{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          privacy policy
        </Link>
        .
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!confirmed || pending) return;
          setPending(true);
          setError(null);
          const result = await deleteAccountAction({ confirmation: typed });
          if (!result.ok) {
            setPending(false);
            setError(result.error.message);
            return;
          }
          router.replace("/");
          router.refresh();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>
            Type <span className="font-bold">{DELETE_CONFIRMATION}</span> to confirm
          </Label>
          <Input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={pending}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="destructive" size="lg" disabled={!confirmed || pending}>
            {pending ? "Deleting…" : "Delete my account"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setTyped("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
