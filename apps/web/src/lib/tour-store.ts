import { TOURS_ENABLED_KEY, TOURS_SEEN_KEY } from "./constants";
import type { TourId } from "./tours";

/**
 * The tours' state in this browser: whether they show, and which ones are done. Every read and write is guarded; when
 * storage is blocked (private browsing, blocked site data) the state lives in memory for this page load, so a tour
 * still shows at most once and the Tutorials switch still works.
 */

/** Set once a write failed: from then on the in-memory copy is the truth for this page load. */
let memoryEnabled: boolean | undefined;
let memorySeen: TourId[] | undefined;

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Hears changes to the enabled flag, from this tab or another (`useSyncExternalStore`). */
export function subscribeTours(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === TOURS_ENABLED_KEY || e.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Whether tours show; on until the player turns them off. */
export function toursEnabled(): boolean {
  if (memoryEnabled !== undefined) return memoryEnabled;
  try {
    return localStorage.getItem(TOURS_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Turns tours on or off. On also empties the seen list, so every tour shows again. */
export function setToursEnabled(on: boolean): void {
  if (on) writeSeen([]);
  try {
    localStorage.setItem(TOURS_ENABLED_KEY, on ? "1" : "0");
    if (memoryEnabled !== undefined) memoryEnabled = on;
  } catch {
    memoryEnabled = on;
  }
  changed();
}

function readSeen(): TourId[] {
  if (memorySeen !== undefined) return memorySeen;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TOURS_SEEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is TourId => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(seen: TourId[]): void {
  try {
    localStorage.setItem(TOURS_SEEN_KEY, JSON.stringify(seen));
    if (memorySeen !== undefined) memorySeen = seen;
  } catch {
    memorySeen = seen;
  }
}

export function tourSeen(id: TourId): boolean {
  return readSeen().includes(id);
}

/** Whether a tour is still to come: tours are on and this one wasn't seen. */
export function tourPending(id: TourId): boolean {
  return toursEnabled() && !tourSeen(id);
}

export function markTourSeen(id: TourId): void {
  const seen = readSeen();
  if (!seen.includes(id)) writeSeen([...seen, id]);
}
