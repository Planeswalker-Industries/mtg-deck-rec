"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import type { CollectionSharing } from "@mtg/core/contract";
import { DeckToggle } from "@/components/decks/deck-toggle";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { getApis } from "@/lib/api/client";
import { TEXT_LINK } from "@/lib/constants";

/** How long "Copied" stays on the button before it reads "Copy link" again. */
const COPIED_NOTICE_MS = 2000;

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy link",
  copied: "Copied",
  failed: "Copy failed",
};

const shareUrl = (code: string) => `${window.location.origin}/collection/${code}`;

/**
 * The owner's "Public" switch for their collection, the same one a saved deck has, and the link to copy while it is
 * on. A collection kept in this browser has no copy on the server to share, so signed out it only says to sign in.
 */
export function CollectionSharingControl({ where }: { where: "browser" | "account" }) {
  if (where === "browser") {
    return (
      <Link href="/sign-in?next=/collection" className={`self-end text-sm ${TEXT_LINK}`}>
        Sign in to share
      </Link>
    );
  }
  return <AccountSharing />;
}

function AccountSharing() {
  const [sharing, setSharing] = useState<CollectionSharing | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    let active = true;
    void getApis()
      .actions.getMyCollectionSharing()
      .then((result) => {
        if (!active) return;
        if (result.ok) setSharing(result.data);
        else setError(result.error.message);
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(() => setCopy("idle"), COPIED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  async function copyLink() {
    if (!sharing) return;
    try {
      await navigator.clipboard.writeText(shareUrl(sharing.code));
      setCopy("copied");
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied permission).
      setCopy("failed");
    }
  }

  // The toggle keeps its own state from its first render, so it waits for the saved one.
  if (!loaded) return null;
  if (error) return <ErrorText>{error}</ErrorText>;

  return (
    <div className="flex flex-wrap items-start justify-end gap-x-4">
      {sharing?.shared && (
        <div className="flex min-h-11 items-center">
          <Button type="button" variant="outline" size="sm" onClick={copyLink}>
            <Link2 aria-hidden />
            {COPY_LABEL[copy]}
          </Button>
          <span role="status" aria-live="polite" className="sr-only">
            {copy === "copied" ? "Link copied to the clipboard" : copy === "failed" ? "Couldn't copy the link" : ""}
          </span>
        </div>
      )}
      <DeckToggle
        id="collection-public"
        label="Public"
        checked={sharing?.shared === true}
        onSave={async (next) => {
          const result = await getApis().actions.setCollectionSharing({ shared: next });
          if (!result.ok) return result.error.message;
          setSharing(result.data);
          return null;
        }}
        helpLabel="Who can see this collection"
        helpTitle={(on) => (on ? "Anyone with the link can see this collection" : "Only you can see this collection")}
        help={
          <>
            Public gives your collection a link you can send to friends. They see your cards and how many copies you have,
            but can&rsquo;t change anything. Turn it off and the link stops working; turn it back on and the same link
            works again.
          </>
        }
      />
    </div>
  );
}
