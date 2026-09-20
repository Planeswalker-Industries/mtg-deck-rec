import type { InputSchema } from "@mtg/core/schemas";
import { z } from "zod";
import { ADMIN_PER_PAGE_MAX, ADMIN_USER_SORTS, MAX_ADMIN_NOTE_CHARS, MAX_DISPLAY_NAME_CHARS } from "./types";

/**
 * Validation for the admin API's inputs. Kept out of `@mtg/core/contract/schemas.ts` on purpose: that file is the
 * frozen frontend/backend contract, and the admin area is neither.
 */

const MAX_SEARCH_CHARS = 200;

const uuid = z.uuid({ error: "That isn't a user id." });

export interface ListAdminUsersInput {
  userId?: string;
  search?: string;
  adminsOnly: boolean;
  sort: (typeof ADMIN_USER_SORTS)[number];
  ascending: boolean;
  offset: number;
  limit: number;
}

export const listAdminUsersInputSchema: InputSchema<ListAdminUsersInput> = z.object({
  userId: uuid.optional(),
  search: z.string().max(MAX_SEARCH_CHARS, "That search is too long.").optional(),
  adminsOnly: z.boolean().default(false),
  sort: z.enum(ADMIN_USER_SORTS).default("created_at"),
  ascending: z.boolean().default(false),
  offset: z.int().min(0).max(100_000).default(0),
  limit: z.int().min(1).max(ADMIN_PER_PAGE_MAX).default(25),
});

export interface UpdateAdminUserInput {
  displayName?: string | null;
  isAdmin?: boolean;
  adminNote?: string | null;
  banned?: boolean;
}

/**
 * Every field is optional and applied only when present, so the UI can send one toggle without restating the rest
 * and two admins editing different fields cannot undo each other.
 */
export const updateAdminUserInputSchema: InputSchema<UpdateAdminUserInput> = z
  .object({
    displayName: z.string().max(MAX_DISPLAY_NAME_CHARS, `A display name is at most ${MAX_DISPLAY_NAME_CHARS} characters.`).nullable().optional(),
    isAdmin: z.boolean().optional(),
    adminNote: z.string().max(MAX_ADMIN_NOTE_CHARS, `A note is at most ${MAX_ADMIN_NOTE_CHARS} characters.`).nullable().optional(),
    banned: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { error: "Nothing to change." });
