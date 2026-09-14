"use client";

import { useEffect, useState } from "react";
import { loadCollection, type StoredCollection } from "@/lib/collection-store";

export type StoredCollectionState = { status: "loading" } | { status: "ready"; collection: StoredCollection | null };

/** The collection saved in this browser, loaded once on mount. `replace` updates it after an import or clear. */
export function useStoredCollection() {
  const [state, setState] = useState<StoredCollectionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadCollection().then((collection) => {
      if (active) setState({ status: "ready", collection });
    });
    return () => {
      active = false;
    };
  }, []);

  return { state, replace: (collection: StoredCollection | null) => setState({ status: "ready", collection }) };
}
