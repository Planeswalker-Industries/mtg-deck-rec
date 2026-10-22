"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Link2 } from "lucide-react";
import type { CollectionSharing } from "@mtg/core/contract";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { Switch } from "@/components/ui/switch";
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
 * The owner's switch for a link to their collection, and the link to copy while it is on. A collection kept in this
 * browser has no copy on the server to share, so signed out it only says to sign in.
 */
export function CollectionSharingControl({ where }: { where: "browser" | "account" }) {
  if (where === "browser") {
    return (
      <Link href="/sign-in?next=/collection" className={`text-sm ${TEXT_LINK}`}>
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
  const [pending, startTransition] = useTransition();
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

  const on = sharing?.shared === true;

  function toggle(next: boolean) {
    const previous = sharing;
    setSharing({ code: previous?.code ?? "", shared: next });
    setError(null);
    startTransition(async () => {
      const result = await getApis()
        .actions.setCollectionSharing({ shared: next })
        .catch(() => null);
      if (result?.ok) setSharing(result.data);
      else {
        setSharing(previous);
        setError(result ? result.error.message : "Couldn't change sharing. Check your connection and try again.");
      }
    });
  }

  async function copyLink() {
    if (!sharing?.code) return;
    try {
      await navigator.clipboard.writeText(shareUrl(sharing.code));
      setCopy("copied");
    } catch {
      // Clipboard access can be refused (an insecure origin, a denied permission).
      setCopy("failed");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="collection-share" className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          Share link
          <Switch id="collection-share" checked={on} disabled={!loaded || pending} onCheckedChange={toggle} />
        </label>
        {on && sharing?.code && (
          <Button type="button" variant="outline" size="sm" onClick={copyLink} disabled={pending}>
            <Link2 aria-hidden />
            {COPY_LABEL[copy]}
          </Button>
        )}
        <span role="status" aria-live="polite" className="sr-only">
          {copy === "copied" ? "Link copied to the clipboard" : copy === "failed" ? "Couldn't copy the link" : ""}
        </span>
      </div>
      {on && <p className="text-sm text-muted-foreground">Anyone with the link can see your collection.</p>}
      {error && <ErrorText>{error}</ErrorText>}
    </div>
  );
}
