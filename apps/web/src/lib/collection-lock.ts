/**
 * Every write to a collection from this browser, in any tab, runs one at a time under this Web Lock: the background
 * move of a browser collection to the account, imports, clearing, and adding a deck's missing cards. Without it, a
 * move whose upload was snapshotted before a replacement committed in another tab could land afterwards and bring the
 * replaced cards back.
 */
const LOCK_NAME = "mtg-deck-rec:collection-write";

/**
 * Runs `write` once no other tab is writing to the collection. `onWait` is called when it has to queue, so the page can
 * say it is waiting. Browsers without Web Locks run it straight away.
 */
export async function withCollectionWrite<T>(write: () => Promise<T>, onWait?: () => void): Promise<T> {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return write();
  const first = await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) =>
    lock ? { ran: true as const, value: await write() } : { ran: false as const },
  );
  if (first.ran) return first.value;
  onWait?.();
  return navigator.locks.request(LOCK_NAME, write);
}
