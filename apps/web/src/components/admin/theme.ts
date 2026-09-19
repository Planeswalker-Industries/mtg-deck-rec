"use client";

import { alpha, createTheme, type Theme } from "@mui/material/styles";
import type { RaThemeOptions } from "react-admin";

/**
 * The site's design tokens, as a Material UI theme.
 *
 * React Admin brings Material UI, and the site is shadcn and Tailwind — but "table at night" is a set of colours,
 * two typefaces and one lighting rule, none of which belong to either framework. Restating them here is what makes
 * the admin area read as the same site rather than a bolted-on tool.
 *
 * The values below **mirror `:root` in `app/globals.css`. Change both together.** They are literals rather than
 * `var(--token)` because Material UI does colour maths on palette entries (`alpha`, hover and selected overlays),
 * and a CSS variable is opaque to it. The two font families *are* read as variables: next/font puts them on
 * `<html>`, nothing computes on them, and that keeps the fonts in one place.
 */
const TOKENS = {
  background: "#10131a", // the table, in shadow
  sleeve: "#1a1e28", // a card sleeve lying on the table
  seam: "#2a303d", // where two surfaces meet
  popover: "#1e232e",
  foreground: "#e9e5dd", // warm off-white: paper under a lamp, never pure white
  mutedForeground: "#98a0ae",
  muted: "#232936",
  secondary: "#272d39",
  input: "#39414f",
  primary: "#d8a441", // the lamp: the only thing that is lit
  primaryForeground: "#17130a",
  cut: "#e8687c",
  add: "#3cbd94",
  replace: "#9d8ef5",
  destructive: "#ef6172",
  gc: "#e0b354",
} as const;

export const ADMIN_TOKENS = TOKENS;

const FONT_BODY = "var(--font-body), ui-sans-serif, system-ui, sans-serif";
const FONT_HEADING = "var(--font-display), Georgia, serif";

/**
 * Light falls from the top: a warm edge where a surface catches it, shadow where it doesn't. The same recipe as the
 * `lit` utility in globals.css.
 */
const LIT = [
  `inset 0 1px 0 ${alpha(TOKENS.primary, 0.18)}`,
  "0 1px 2px rgb(0 0 0 / 0.5)",
  "0 8px 24px -12px rgb(0 0 0 / 0.7)",
].join(", ");

/**
 * Material's elevation scale is a stack of generic grey drop shadows. There is one light source here, so every level
 * above flat gets the same lit edge instead of a progressively larger blur.
 */
const SHADOWS = ["none", ...Array<string>(24).fill(LIT)] as unknown as Theme["shadows"];

/** The site's focus ring: 2px of the lamp, held off the element so it reads against a dark surface. */
const FOCUS_RING = {
  outline: `2px solid ${TOKENS.primary}`,
  outlineOffset: "2px",
};

/** Micro-interactions land in 150–300ms, and nothing moves at all when the visitor asked for less motion. */
const TRANSITION = "background-color 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out";

export const adminTheme: RaThemeOptions = createTheme({
  palette: {
    mode: "dark",
    background: { default: TOKENS.background, paper: TOKENS.sleeve },
    primary: { main: TOKENS.primary, contrastText: TOKENS.primaryForeground },
    // Violet is "replace" on the site. It is the only other accent the admin needs, and it stays off the mana wheel.
    secondary: { main: TOKENS.replace, contrastText: TOKENS.primaryForeground },
    error: { main: TOKENS.destructive },
    warning: { main: TOKENS.gc },
    success: { main: TOKENS.add },
    info: { main: TOKENS.replace },
    divider: TOKENS.seam,
    text: {
      primary: TOKENS.foreground,
      secondary: TOKENS.mutedForeground,
      disabled: alpha(TOKENS.foreground, 0.38),
    },
    action: {
      hover: alpha(TOKENS.foreground, 0.06),
      selected: alpha(TOKENS.primary, 0.12),
      focus: alpha(TOKENS.primary, 0.16),
      disabled: alpha(TOKENS.foreground, 0.38),
      disabledBackground: alpha(TOKENS.foreground, 0.1),
    },
  },

  // --radius in globals.css is 0.375rem.
  shape: { borderRadius: 6 },
  shadows: SHADOWS,

  typography: {
    fontFamily: FONT_BODY,
    // Atkinson Hyperlegible Next ships 400 and 700 only; asking for 500 or 600 gets a synthesised weight.
    fontWeightMedium: 700,
    fontWeightBold: 700,
    // Fraunces for anything that titles a screen, like every heading on the public pages.
    h1: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.02em" },
    h2: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.02em" },
    h3: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.01em" },
    h4: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.01em" },
    h5: { fontFamily: FONT_HEADING, fontWeight: 600 },
    h6: { fontFamily: FONT_HEADING, fontWeight: 600, fontSize: "1.125rem" },
    // 16px body, so nothing in the admin is smaller than the site's own reading size.
    body1: { fontSize: "1rem", lineHeight: 1.55 },
    body2: { fontSize: "0.9375rem", lineHeight: 1.55 },
    button: { textTransform: "none", fontWeight: 700 },
  },

  components: {
    // Material's dark mode paints a lightening gradient over every raised surface. The site has one light source and
    // no decorative gradients, so surfaces are a flat sleeve colour with a seam around them.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none", backgroundColor: TOKENS.sleeve },
        outlined: { borderColor: TOKENS.seam },
      },
    },

    MuiAppBar: {
      defaultProps: { elevation: 0, color: "transparent" },
      styleOverrides: {
        root: {
          backgroundColor: TOKENS.sleeve,
          backgroundImage: "none",
          borderBottom: `1px solid ${TOKENS.seam}`,
          boxShadow: "none",
          color: TOKENS.foreground,
        },
      },
    },

    MuiToolbar: {
      styleOverrides: {
        root: { "& .RaAppBar-title": { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.01em" } },
      },
    },

    // Gold is the lamp: it marks the one action that matters, so only a contained button is allowed to wear it.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        // A callback rather than per-variant slots: Material UI 9 dropped `containedPrimary` and friends, and this
        // reads the variant and colour straight off the component.
        root: ({ ownerState }) => ({
          borderRadius: 6,
          transition: TRANSITION,
          "&:focus-visible": FOCUS_RING,
          // Gold is the lamp: only the one action that matters on a screen wears it.
          ...(ownerState.variant === "contained" &&
            ownerState.color === "primary" && {
              backgroundColor: TOKENS.primary,
              color: TOKENS.primaryForeground,
              "&:hover": { backgroundColor: alpha(TOKENS.primary, 0.85) },
            }),
          ...(ownerState.variant === "outlined" && {
            borderColor: TOKENS.seam,
            color: TOKENS.foreground,
            "&:hover": { borderColor: TOKENS.input, backgroundColor: TOKENS.secondary },
          }),
          // Everything else is quiet until you reach for it, like the site's nav links.
          ...(ownerState.variant === "text" &&
            ownerState.color !== "error" && {
              color: TOKENS.mutedForeground,
              "&:hover": { color: TOKENS.foreground, backgroundColor: TOKENS.secondary },
            }),
          ...(ownerState.color === "error" && {
            color: TOKENS.destructive,
            "&:hover": { color: TOKENS.destructive, backgroundColor: alpha(TOKENS.destructive, 0.12) },
          }),
        }),
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          color: TOKENS.mutedForeground,
          transition: TRANSITION,
          "&:hover": { color: TOKENS.foreground, backgroundColor: TOKENS.secondary },
          "&:focus-visible": FOCUS_RING,
        },
      },
    },

    MuiLink: {
      styleOverrides: {
        root: {
          color: TOKENS.foreground,
          textDecorationColor: alpha(TOKENS.foreground, 0.35),
          textUnderlineOffset: "0.2em",
          "&:hover": { textDecorationColor: TOKENS.primary },
          "&:focus-visible": FOCUS_RING,
        },
      },
    },

    // Data tables: the seam between rows, a quiet header, and tabular figures so number columns don't jitter.
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${TOKENS.seam}`, fontSize: "0.9375rem" },
        head: {
          backgroundColor: TOKENS.background,
          color: TOKENS.mutedForeground,
          fontWeight: 700,
          whiteSpace: "nowrap",
        },
        sizeSmall: { padding: "10px 16px" },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: { transition: TRANSITION, "&:last-of-type td": { borderBottom: "none" } },
        hover: { "&:hover": { backgroundColor: TOKENS.secondary } },
      },
    },

    MuiTableSortLabel: {
      styleOverrides: {
        root: {
          color: TOKENS.mutedForeground,
          "&:hover": { color: TOKENS.foreground },
          // The sorted column is the one thing lit in the header row.
          "&.Mui-active": { color: TOKENS.primary, "& .MuiTableSortLabel-icon": { color: TOKENS.primary } },
        },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: TOKENS.muted,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.input },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.mutedForeground },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: TOKENS.primary, borderWidth: 2 },
        },
        // 48px tall: past the 44px minimum target, and enough room that the notched label is not sitting on the text.
        input: { minHeight: "1.5rem", paddingTop: 14, paddingBottom: 14 },
      },
    },

    MuiFormHelperText: { styleOverrides: { root: { color: TOKENS.mutedForeground, fontSize: "0.8125rem" } } },
    MuiInputLabel: { styleOverrides: { root: { "&.Mui-focused": { color: TOKENS.primary } } } },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          "&.Mui-checked": { color: TOKENS.primary },
          "&.Mui-checked + .MuiSwitch-track": { backgroundColor: TOKENS.primary, opacity: 0.45 },
          "&:focus-visible": FOCUS_RING,
        },
        track: { backgroundColor: TOKENS.input, opacity: 1 },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, borderRadius: 999 },
        outlined: { borderColor: TOKENS.seam },
      },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: TOKENS.popover,
          border: `1px solid ${TOKENS.seam}`,
          color: TOKENS.foreground,
          fontSize: "0.8125rem",
          boxShadow: LIT,
        },
        arrow: { color: TOKENS.popover },
      },
    },

    MuiMenu: { styleOverrides: { paper: { backgroundColor: TOKENS.popover, border: `1px solid ${TOKENS.seam}` } } },
    MuiDialog: { styleOverrides: { paper: { backgroundColor: TOKENS.popover, border: `1px solid ${TOKENS.seam}` } } },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: FONT_HEADING, fontWeight: 600 } } },

    // --- React Admin's own components -------------------------------------------------------------------------

    // The sidebar is a surface in shadow, not a raised panel: it sits at the table colour with a seam down its edge.
    RaSidebar: {
      styleOverrides: {
        root: {
          backgroundColor: TOKENS.background,
          borderRight: `1px solid ${TOKENS.seam}`,
          "& .RaSidebar-fixed": { backgroundColor: TOKENS.background },
        },
      },
    },

    // Nav is quiet until you reach for it, and the page you are on is the one lit thing — the same rule as the
    // site header. No pill, no filled background: a gold rule down the left edge and gold text.
    RaMenuItemLink: {
      styleOverrides: {
        root: {
          color: TOKENS.mutedForeground,
          borderRadius: 6,
          margin: "2px 8px",
          paddingLeft: 12,
          borderLeft: "2px solid transparent",
          transition: TRANSITION,
          "& .RaMenuItemLink-icon": { color: "inherit", minWidth: 32 },
          "&:hover": { color: TOKENS.foreground, backgroundColor: TOKENS.secondary },
          "&:focus-visible": FOCUS_RING,
          "&.RaMenuItemLink-active": {
            color: TOKENS.primary,
            fontWeight: 700,
            borderLeftColor: TOKENS.primary,
            backgroundColor: alpha(TOKENS.primary, 0.08),
          },
        },
      },
    },

    // The list, the record and the form are all one sleeve with the light on its top edge.
    // The card holds the light; the table scrolls inside it, so a narrow screen can still reach the far columns.
    //
    // The `min-width: 0` matters as much as the overflow does. Every one of these is a flex item, and a flex item
    // defaults to `min-width: auto` — it refuses to shrink below its content, so the table pushed the whole page
    // wider than the phone instead of scrolling. The site clips horizontal overflow on <html> and <body>, so those
    // columns ended up somewhere no scroll could reach.
    RaList: {
      styleOverrides: {
        root: {
          minWidth: 0,
          "& .RaList-main": { minWidth: 0 },
          "& .RaList-content": {
            border: `1px solid ${TOKENS.seam}`,
            borderRadius: 8,
            boxShadow: LIT,
            overflowX: "auto",
          },
        },
      },
    },
    RaDatagrid: {
      styleOverrides: {
        root: {
          "& .RaDatagrid-headerCell": { backgroundColor: TOKENS.background },
          "& .RaDatagrid-rowCell": { color: TOKENS.foreground },
          "& .RaDatagrid-clickableRow": { cursor: "pointer" },
        },
      },
    },
    RaShow: { styleOverrides: { root: { "& .RaShow-card": { border: `1px solid ${TOKENS.seam}`, boxShadow: LIT } } } },
    RaEdit: { styleOverrides: { root: { "& .RaEdit-card": { border: `1px solid ${TOKENS.seam}`, boxShadow: LIT } } } },
    RaSimpleFormIterator: { styleOverrides: { root: { "& .RaSimpleFormIterator-line": { borderColor: TOKENS.seam } } } },
    RaToolbar: { styleOverrides: { root: { backgroundColor: TOKENS.muted, borderTop: `1px solid ${TOKENS.seam}` } } },
    RaLabeled: { styleOverrides: { root: { "& .RaLabeled-label": { color: TOKENS.mutedForeground } } } },

    // react-admin's empty state, so "nothing here" reads as an answer rather than a blank panel.
    RaEmpty: { styleOverrides: { root: { color: TOKENS.mutedForeground, "& .RaEmpty-message": { color: TOKENS.mutedForeground } } } },
  },
});
