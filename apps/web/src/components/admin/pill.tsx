"use client";

import { Box, Stack } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { ADMIN_TOKENS } from "./theme";

/**
 * Status as pills, in the site's own shape: a rounded outline that is quiet until it has something to say.
 *
 * A pill is only drawn when its fact is true, and it says what it means in words — colour alone would not. Tones are
 * the site's three jobs plus the lamp: `cut` for trouble, `add` for healthy, `replace` for "changed, look closer",
 * `primary` for the one thing worth noticing.
 */
export type PillTone = "primary" | "cut" | "add" | "replace" | "muted";

const PILL_SHAPE = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  border: "1px solid",
  px: 1,
  py: 0.25,
  fontSize: "0.6875rem",
  fontWeight: 700,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
} as const;

/** How strongly a pill's border and fill show its tone, against the text in full colour. */
const BORDER_ALPHA = 0.45;
const FILL_ALPHA = 0.1;

const TONE_COLOR: Record<PillTone, string> = {
  primary: ADMIN_TOKENS.primary,
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
      sx={{ ...PILL_SHAPE, color, borderColor: alpha(color, BORDER_ALPHA), backgroundColor: alpha(color, FILL_ALPHA) }}
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
