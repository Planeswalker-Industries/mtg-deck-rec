"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { ActionsApi, ApiError, Result } from "@mtg/core/contract";
import {
  deckVisibilityInputSchema,
  deleteDeckInputSchema,
  duplicateDeckInputSchema,
  openSavedDeckInputSchema,
  parseInput,
  renameDeckInputSchema,
  saveDeckInputSchema,
} from "@mtg/core/schemas";
import { createAuthClient, getCurrentUser } from "@/lib/server/auth";
import { checkRateLimit } from "@/lib/server/rate-limit";
import {
  DeckRefused,
  deleteDeck,
  duplicateDeck,
  openSavedDeck,
  renameDeck,
  saveDeck,
  setDeckVisibility,
  type DeckRefusal,
} from "@/lib/server/saved-decks";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

const refusals: Record<DeckRefusal, Result<never>> = {
  NOT_SIGNED_IN: failure("UNAUTHENTICATED", "Sign in to save decks to your account."),
  DECK_NOT_FOUND: failure("NOT_FOUND", "That deck no longer exists."),
  DECK_NAME_REQUIRED: failure("VALIDATION", "Give the deck a name."),
  DECK_TOO_LARGE: failure("PAYLOAD_TOO_LARGE", "That deck has more cards than we can save."),
  TOO_MANY_DECKS: failure("VALIDATION", "You've reached the limit on saved decks. Delete one to make room."),
};

function failed(err: unknown, message: string): Result<never> {
  if (err instanceof DeckRefused) return refusals[err.reason];
  console.error(err);
  return failure("UPSTREAM_UNAVAILABLE", message);
}

/** Deck writes share one bucket, so renaming in a loop costs the same budget as saving. */
async function limited(): Promise<Result<never> | null> {
  const error = await checkRateLimit(createPublicClient(), "deck_write", visitorKey(await headers()));
  return error ? { ok: false, error } : null;
}

/** The list is a Server Component read, so every write has to invalidate it. */
function refreshList(): void {
  revalidatePath("/decks");
}

export async function saveDeckAction(
  input: Parameters<ActionsApi["saveDeck"]>[0],
): ReturnType<ActionsApi["saveDeck"]> {
  const parsed = parseInput(saveDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    const saved = await saveDeck(await createAuthClient(), parsed.data);
    refreshList();
    return { ok: true, data: saved };
  } catch (err) {
    return failed(err, "Couldn't save that deck. Try again in a moment.");
  }
}

/**
 * Reopens one of the caller's decks in the tool. A read, but a Server Action rather than a page read: the tool is a
 * client component that decides what to open after it mounts, and /deck stays a static shell.
 */
export async function openSavedDeckAction(
  input: Parameters<ActionsApi["openSavedDeck"]>[0],
): ReturnType<ActionsApi["openSavedDeck"]> {
  const parsed = parseInput(openSavedDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    const user = await getCurrentUser();
    if (!user) return refusals.NOT_SIGNED_IN;
    return { ok: true, data: await openSavedDeck(await createAuthClient(), parsed.data.code, user.id) };
  } catch (err) {
    return failed(err, "Couldn't open that deck. Try again in a moment.");
  }
}

export async function renameDeckAction(
  input: Parameters<ActionsApi["renameDeck"]>[0],
): ReturnType<ActionsApi["renameDeck"]> {
  const parsed = parseInput(renameDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    await renameDeck(await createAuthClient(), parsed.data.deckId, parsed.data.name);
    refreshList();
    return { ok: true, data: null };
  } catch (err) {
    return failed(err, "Couldn't rename that deck. Try again in a moment.");
  }
}

export async function duplicateDeckAction(
  input: Parameters<ActionsApi["duplicateDeck"]>[0],
): ReturnType<ActionsApi["duplicateDeck"]> {
  const parsed = parseInput(duplicateDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    const deckId = await duplicateDeck(await createAuthClient(), parsed.data.deckId, parsed.data.name);
    refreshList();
    return { ok: true, data: { deckId } };
  } catch (err) {
    return failed(err, "Couldn't copy that deck. Try again in a moment.");
  }
}

export async function setDeckVisibilityAction(
  input: Parameters<ActionsApi["setDeckVisibility"]>[0],
): ReturnType<ActionsApi["setDeckVisibility"]> {
  const parsed = parseInput(deckVisibilityInputSchema, input);
  if (!parsed.ok) return parsed;
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    await setDeckVisibility(await createAuthClient(), parsed.data.deckId, parsed.data.isPublic);
    refreshList();
    return { ok: true, data: null };
  } catch (err) {
    return failed(err, "Couldn't change who can see that deck. Try again in a moment.");
  }
}

export async function deleteDeckAction(
  input: Parameters<ActionsApi["deleteDeck"]>[0],
): ReturnType<ActionsApi["deleteDeck"]> {
  const parsed = parseInput(deleteDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  const blocked = await limited();
  if (blocked) return blocked;
  try {
    await deleteDeck(await createAuthClient(), parsed.data.deckId);
    refreshList();
    return { ok: true, data: null };
  } catch (err) {
    return failed(err, "Couldn't delete that deck. Try again in a moment.");
  }
}
