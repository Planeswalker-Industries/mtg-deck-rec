"use client";

import { Box, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { ADMIN_TOKENS, tint } from "./theme";

/**
 * Status as pills, in the site's own shape: a rounded outline that is quiet until it has something to say.
 *
 * A pill is only drawn when its fact is true, and it says what it means in words — colour alone would not. Tones are
 * the site's three jobs plus ink: `cut` for trouble, `add` for healthy, `replace` for "changed, look closer", `ink` for
 * the one thing worth noticing. Never espresso: on paper that colour means "you can press this".
 */
export type PillTone = "ink" | "cut" | "add" | "replace" | "muted";

const PILL_SHAPE = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  border: "1px solid",
  px: 1,
  py: 0.25,
  fontSize: "0.75rem",
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
} as const;

/** How strongly a pill's border and fill show its tone (percent), against the text in full colour. */
const BORDER_TINT_PERCENT = 45;
const FILL_TINT_PERCENT = 10;

const TONE_COLOR: Record<PillTone, string> = {
  ink: ADMIN_TOKENS.foreground,
  cut: ADMIN_TOKENS.cut,
  add: ADMIN_TOKENS.add,
  replace: ADMIN_TOKENS.replace,
  muted: ADMIN_TOKENS.mutedForeground,
};

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  const color = TONE_COLOR[tone];
  return (
    <Box
      component="span"
      sx={{ ...PILL_SHAPE, color, borderColor: tint(color, BORDER_TINT_PERCENT), backgroundColor: tint(color, FILL_TINT_PERCENT) }}
    >
      {children}
    </Box>
  );
}

/** A row of pills, or a quiet dash when there are none: fifty rows of empty cells read as missing data. */
export function Pills({ children, emptyLabel }: { children: ReactNode[]; emptyLabel: string }) {
  const shown = children.filter(Boolean);
  if (shown.length === 0) {
    return (
      <Box component="span" sx={{ color: ADMIN_TOKENS.mutedForeground }} aria-label={emptyLabel}>
        —
      </Box>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} component="span">
      {shown}
    </Stack>
  );
}
