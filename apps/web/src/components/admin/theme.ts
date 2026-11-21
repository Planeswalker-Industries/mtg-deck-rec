"use client";

import { createTheme, type Theme } from "@mui/material/styles";
import type { RaThemeOptions } from "react-admin";

/**
 * The site's paper theme, as a Material UI theme.
 *
 * React Admin brings Material UI, and the site is shadcn and Tailwind, but the site's look is a set of colours, a
 * typeface and a few surface rules that belong to neither framework. Restating them here is what makes the admin area
 * read as the same site rather than a bolted-on tool: the frame (title bar and menu) is a dark bar on the walnut, like
 * the site header, and the screen itself is one paper sheet beside it.
 *
 * Every style override reads the CSS tokens in `app/globals.css` directly (`CSS` below), so there is one place to
 * change a colour. The palette is the exception: Material UI does colour maths on palette entries (hover and selected
 * overlays, contrast text), and a CSS variable is opaque to it, so `PALETTE` **mirrors the matching `:root` values in
 * globals.css as hex. Change both together.**
 */
const PALETTE = {
  paper: "#f4e8d7", // --paper
  paperRaised: "#f9f3eb", // --paper-raised
  paperRecessed: "#e9d1af", // --paper-recessed
  ink: "#1b1918", // --ink
  inkSoft: "#524b47", // --ink-soft
  espresso: "#633636", // --espresso: the one interactive colour on paper
  cut: "#9b2c1f", // --cut
  add: "#2f6b3a", // --add
  replace: "#4a5643", // --replace
  warning: "#775422", // --brass-deep, the amber of warnings
} as const;

/** The tokens themselves, for everything Material UI only passes through to CSS. */
const CSS = {
  background: "var(--background)",
  foreground: "var(--foreground)",
  sleeve: "var(--sleeve)",
  popover: "var(--popover)",
  seam: "var(--seam)",
  input: "var(--input)",
  muted: "var(--muted)",
  mutedForeground: "var(--muted-foreground)",
  primary: "var(--primary)",
  primaryHover: "var(--primary-hover)",
  primaryForeground: "var(--primary-foreground)",
  espressoDeep: "var(--espresso-deep)",
  ring: "var(--ring)",
  cut: "var(--cut)",
  add: "var(--add)",
  replace: "var(--replace)",
  ink: "var(--ink)",
  lift: "var(--lift)",
  // The bar over the wood: the same fill, rule, ink and brass links as the site header and footer.
  barFill: "var(--wood-bar-fill)",
  barSolid: "var(--wood-bar)",
  barRule: "var(--wood-bar-rule)",
  barInk: "var(--wood-ink)",
  barLink: "var(--wood-link)",
  barHover: "var(--wood-recessed)",
  barHoverInk: "var(--wood-accent-ink)",
} as const;

/** A tint of a token, for hovers and pill fills: the same `color-mix` the site's own utilities compile to. */
export const tint = (token: string, percent: number) => `color-mix(in oklch, ${token} ${percent}%, transparent)`;

/** What the admin's own components read: CSS tokens only. */
export const ADMIN_TOKENS = CSS;

const FONT_BODY = "var(--font-body), ui-sans-serif, system-ui, sans-serif";
const FONT_HEADING = "var(--font-heading-face), Georgia, serif";

/** Hover on paper: a faint ink wash, the strength of Tailwind's `hover:bg-primary/10` on the rest of the site. */
const HOVER_TINT_PERCENT = 10;
/** A row under the pointer, fainter than a control's hover so a whole table row doesn't flash. */
const ROW_HOVER_TINT_PERCENT = 5;
/** The selected menu item's edge: the thick edge a selected toggle wears on the site, never a fill. */
const SELECTED_EDGE_PX = 3;

/** The pale highlight along a filled button's top edge, as in the `lit` utility in globals.css. */
const LIT_HIGHLIGHT_PERCENT = 28;
/** A text link's resting underline, half strength like TEXT_LINK's `decoration-primary/50`. */
const LINK_UNDERLINE_PERCENT = 50;

/** A filled button's worn edges, the same recipe as the `lit` utility in globals.css. No drop shadow. */
const LIT = `inset 0 1px 0 ${tint("var(--paper-raised)", LIT_HIGHLIGHT_PERCENT)}, inset 0 -2px 0 ${CSS.espressoDeep}`;

/** Below Tailwind's `sm` (640px), where every control gets a 44px touch target, as on the rest of the site. */
const PHONE = "@media (max-width: 639.98px)";
const TOUCH_TARGET_PX = 44;

/**
 * Resting surfaces cast no shadow on the site: only something held above the sheet does (a menu, a dialog). Every
 * level above flat is that one lift rather than Material's growing grey blur.
 */
const SHADOWS = ["none", ...Array<string>(24).fill(CSS.lift)] as unknown as Theme["shadows"];

/** The site's focus ring: 2px of the ring colour, held off the element. */
const FOCUS_RING = { outline: `2px solid ${CSS.ring}`, outlineOffset: "2px" };

/** Micro-interactions land in 150–300ms; globals.css stops them for visitors who asked for less motion. */
const TRANSITION = "background-color 160ms ease-out, border-color 160ms ease-out, color 160ms ease-out";

/** Raised paper for anything that opens over the sheet: menus, selects, dialogs, tooltips. */
const OVERLAY = { backgroundColor: CSS.popover, color: CSS.foreground, border: `1px solid ${CSS.seam}` };

export const adminTheme: RaThemeOptions = createTheme({
  palette: {
    mode: "light",
    background: { default: PALETTE.paper, paper: PALETTE.paperRaised },
    primary: { main: PALETTE.espresso, contrastText: PALETTE.paperRaised },
    // Slate is "replace" on the site: the only other colour the admin needs, apart from the status colours.
    secondary: { main: PALETTE.replace, contrastText: PALETTE.paperRaised },
    error: { main: PALETTE.cut },
    warning: { main: PALETTE.warning },
    success: { main: PALETTE.add },
    info: { main: PALETTE.replace },
    text: { primary: PALETTE.ink, secondary: PALETTE.inkSoft },
  },

  // --radius in globals.css is 0.5rem.
  shape: { borderRadius: 8 },
  shadows: SHADOWS,

  typography: {
    fontFamily: FONT_BODY,
    // The body face ships 400 and 700 only; asking for 500 or 600 gets a synthesised weight.
    fontWeightMedium: 700,
    fontWeightBold: 700,
    // The heading face for anything that titles a screen, like every heading on the public pages.
    h1: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.02em" },
    h2: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.02em" },
    h3: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.01em" },
    h4: { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.01em" },
    h5: { fontFamily: FONT_HEADING, fontWeight: 600 },
    h6: { fontFamily: FONT_HEADING, fontWeight: 600, fontSize: "1.125rem" },
    // 16px body, so nothing in the admin is smaller than the site's own reading size.
    body1: { fontSize: "1rem", lineHeight: 1.55 },
    body2: { fontSize: "0.875rem", lineHeight: 1.55 },
    button: { textTransform: "none", fontWeight: 700 },
  },

  components: {
    // Inside the sheet nothing is raised: no paper on paper. Panels are flat and take a seam rule instead of a box.
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none", backgroundColor: "transparent", color: "inherit" } } },
    MuiCard: { defaultProps: { elevation: 0 } },
    MuiPopover: { styleOverrides: { paper: OVERLAY } },
    MuiDialog: { styleOverrides: { paper: OVERLAY } },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: FONT_HEADING, fontWeight: 600 } } },
    MuiAutocomplete: { styleOverrides: { paper: OVERLAY } },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { ...OVERLAY, fontSize: "0.75rem", boxShadow: CSS.lift },
        arrow: { color: CSS.popover },
      },
    },

    // The title bar sits on the wood, like the site header: light ink, brass controls, a brass rule along its foot.
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "transparent" },
      styleOverrides: {
        root: {
          backgroundColor: "transparent",
          backgroundImage: CSS.barFill,
          borderBottom: `1px solid ${CSS.barRule}`,
          boxShadow: "none",
          color: CSS.barInk,
          "& .MuiIconButton-root": {
            color: CSS.barLink,
            "&:hover": { color: CSS.barHoverInk, backgroundColor: CSS.barHover },
            "&:focus-visible": { outline: `2px solid ${CSS.barLink}`, outlineOffset: "2px" },
          },
        },
      },
    },

    MuiToolbar: {
      styleOverrides: {
        root: { "& .RaAppBar-title": { fontFamily: FONT_HEADING, fontWeight: 600, letterSpacing: "-0.01em" } },
      },
    },

    // Espresso is what can be pressed: a contained button is the solid espresso fill, an outlined one an espresso
    // edge and text, a text button espresso text. Red only for destructive actions.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        // A callback rather than per-variant slots: Material UI 9 dropped `containedPrimary` and friends.
        root: ({ ownerState }) => ({
          borderRadius: 8,
          transition: TRANSITION,
          "&:focus-visible": FOCUS_RING,
          ...(ownerState.variant === "contained" &&
            ownerState.color !== "error" && {
              backgroundColor: CSS.primary,
              color: CSS.primaryForeground,
              boxShadow: LIT,
              "&:hover": { backgroundColor: CSS.primaryHover, boxShadow: LIT },
            }),
          ...(ownerState.variant === "outlined" &&
            ownerState.color !== "error" && {
              borderColor: CSS.primary,
              color: CSS.primary,
              "&:hover": { borderColor: CSS.primary, backgroundColor: tint(CSS.primary, HOVER_TINT_PERCENT) },
            }),
          ...(ownerState.variant === "text" &&
            ownerState.color !== "error" && {
              color: CSS.primary,
              "&:hover": { backgroundColor: tint(CSS.primary, HOVER_TINT_PERCENT) },
            }),
          ...(ownerState.color === "error" && {
            color: CSS.cut,
            borderColor: CSS.cut,
            "&:hover": { backgroundColor: tint(CSS.cut, HOVER_TINT_PERCENT) },
          }),
          [PHONE]: { minHeight: TOUCH_TARGET_PX },
        }),
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          color: CSS.primary,
          transition: TRANSITION,
          "&:hover": { backgroundColor: tint(CSS.primary, HOVER_TINT_PERCENT) },
          "&:focus-visible": FOCUS_RING,
          [PHONE]: { minWidth: TOUCH_TARGET_PX, minHeight: TOUCH_TARGET_PX },
        },
      },
    },

    // The site's text link (TEXT_LINK): espresso with a half-strength underline that fills in on hover.
    MuiLink: {
      styleOverrides: {
        root: {
          color: CSS.primary,
          textDecorationColor: tint(CSS.primary, LINK_UNDERLINE_PERCENT),
          textUnderlineOffset: "0.2em",
          "&:hover": { textDecorationColor: CSS.primary },
          "&:focus-visible": FOCUS_RING,
        },
      },
    },

    // Data tables: the seam between rows, a quiet header, and tabular figures so number columns don't jitter.
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${CSS.seam}`, fontSize: "0.875rem", color: CSS.foreground },
        head: {
          backgroundColor: "transparent",
          color: CSS.mutedForeground,
          fontWeight: 700,
          whiteSpace: "nowrap",
        },
        sizeSmall: { padding: "10px 16px" },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: { transition: TRANSITION, "&:last-of-type td": { borderBottom: "none" } },
        hover: { "&:hover": { backgroundColor: tint(CSS.ink, ROW_HOVER_TINT_PERCENT) } },
      },
    },

    MuiTableSortLabel: {
      styleOverrides: {
        root: {
          color: CSS.primary,
          "&:hover": { color: CSS.primaryHover },
          // The sorted column keeps the espresso and shows its arrow.
          "&.Mui-active": { color: CSS.primary, "& .MuiTableSortLabel-icon": { color: CSS.primary } },
          [PHONE]: { minHeight: TOUCH_TARGET_PX, minWidth: TOUCH_TARGET_PX },
        },
      },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: CSS.sleeve,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: CSS.input },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: CSS.foreground },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: CSS.primary, borderWidth: 2 },
        },
        // 48px tall: past the 44px minimum target, and enough room that the notched label is not sitting on the text.
        input: { minHeight: "1.5rem", paddingTop: 14, paddingBottom: 14 },
      },
    },

    MuiFilledInput: {
      styleOverrides: {
        root: {
          backgroundColor: CSS.sleeve,
          "&:hover": { backgroundColor: CSS.sleeve },
          "&.Mui-focused": { backgroundColor: CSS.sleeve },
          "&::before": { borderBottomColor: CSS.input },
          "&::after": { borderBottomColor: CSS.primary },
        },
      },
    },

    MuiFormHelperText: { styleOverrides: { root: { color: CSS.mutedForeground, fontSize: "0.75rem" } } },
    MuiInputLabel: { styleOverrides: { root: { color: CSS.mutedForeground, "&.Mui-focused": { color: CSS.primary } } } },

    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          "&.Mui-checked": { color: CSS.primary },
          "&.Mui-checked + .MuiSwitch-track": { backgroundColor: CSS.primary, opacity: 0.45 },
          "&:focus-visible": FOCUS_RING,
        },
        track: { backgroundColor: CSS.input, opacity: 1 },
      },
    },

    MuiCheckbox: { styleOverrides: { root: { color: CSS.primary, "&.Mui-checked": { color: CSS.primary } } } },

    // Page numbers can be pressed, so they are espresso; the current page wears the thick edge, never a fill.
    MuiPaginationItem: {
      styleOverrides: {
        root: {
          color: CSS.primary,
          "&:hover": { backgroundColor: tint(CSS.primary, HOVER_TINT_PERCENT) },
          "&.Mui-selected, &.Mui-selected:hover": {
            backgroundColor: "transparent",
            boxShadow: `inset 0 0 0 ${SELECTED_EDGE_PX}px ${CSS.primary}`,
          },
          "&.Mui-focusVisible": FOCUS_RING,
          [PHONE]: { minWidth: TOUCH_TARGET_PX, minHeight: TOUCH_TARGET_PX },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 700, borderRadius: 999 },
        outlined: { borderColor: CSS.seam },
      },
    },

    // --- React Admin's own components -------------------------------------------------------------------------

    // The menu is the bar continued down the left edge, with a brass rule where it meets the sheet. On a phone it
    // opens as a drawer over the page, on the bar's solid colour so nothing shows through it.
    RaSidebar: {
      styleOverrides: {
        // On the drawer's paper, not its root: on a phone the root is the full-screen modal behind the drawer.
        root: {
          "& .RaSidebar-fixed": { backgroundColor: "transparent" },
          "& .MuiDrawer-paper": {
            backgroundColor: "transparent",
            backgroundImage: CSS.barFill,
            border: "none",
            borderRight: `1px solid ${CSS.barRule}`,
          },
          "& .MuiDrawer-paper.MuiPaper-elevation16": { backgroundColor: CSS.barSolid },
        },
      },
    },

    // Every item is brass at rest, because it can be pressed (brass is the bar's interactive colour, as espresso is
    // the paper's). The screen you are on keeps that look and gains a thick brass edge, never a fill.
    RaMenuItemLink: {
      styleOverrides: {
        root: {
          color: CSS.barLink,
          borderRadius: 8,
          margin: "2px 8px",
          paddingLeft: 12,
          borderLeft: `${SELECTED_EDGE_PX}px solid transparent`,
          transition: TRANSITION,
          "& .RaMenuItemLink-icon": { color: "inherit", minWidth: 32 },
          "&:hover": { color: CSS.barHoverInk, backgroundColor: CSS.barHover },
          "&:focus-visible": { outline: `2px solid ${CSS.barLink}`, outlineOffset: "2px" },
          "&.RaMenuItemLink-active": { color: CSS.barLink, fontWeight: 700, borderLeftColor: CSS.barLink },
          [PHONE]: { minHeight: TOUCH_TARGET_PX },
        },
      },
    },

    // The list sits flat on the sheet under a seam rule; the table scrolls inside it, so a narrow screen can still
    // reach the far columns.
    //
    // The `min-width: 0` matters as much as the overflow does. Every one of these is a flex item, and a flex item
    // defaults to `min-width: auto`: it refuses to shrink below its content, so the table pushed the whole page wider
    // than the phone instead of scrolling. The site clips horizontal overflow on <html> and <body>, so those columns
    // ended up somewhere no scroll could reach.
    RaList: {
      styleOverrides: {
        root: {
          minWidth: 0,
          "& .RaList-main": { minWidth: 0 },
          "& .RaList-content": { borderTop: `1px solid ${CSS.seam}`, borderRadius: 0, overflowX: "auto" },
        },
      },
    },
    RaDatagrid: {
      styleOverrides: {
        root: {
          "& .RaDatagrid-headerCell": { backgroundColor: "transparent" },
          "& .RaDatagrid-rowCell": { color: CSS.foreground },
          "& .RaDatagrid-clickableRow": { cursor: "pointer" },
        },
      },
    },
    RaShow: { styleOverrides: { root: { "& .RaShow-card": { borderTop: `1px solid ${CSS.seam}`, borderRadius: 0 } } } },
    RaEdit: { styleOverrides: { root: { "& .RaEdit-card": { borderTop: `1px solid ${CSS.seam}`, borderRadius: 0 } } } },
    RaSimpleFormIterator: { styleOverrides: { root: { "& .RaSimpleFormIterator-line": { borderColor: CSS.seam } } } },
    RaToolbar: { styleOverrides: { root: { backgroundColor: "transparent", borderTop: `1px solid ${CSS.seam}` } } },
    // On a phone react-admin gives the list's filter and action bars a raised background: they stay on the sheet. The
    // override sits in the same media query, because a plain declaration loses to react-admin's phone rule.
    RaListToolbar: { styleOverrides: { root: { [PHONE]: { backgroundColor: "transparent" } } } },
    RaTopToolbar: { styleOverrides: { root: { [PHONE]: { backgroundColor: "transparent" } } } },
    RaLabeled: { styleOverrides: { root: { "& .RaLabeled-label": { color: CSS.mutedForeground } } } },

    // react-admin's empty state, so "nothing here" reads as an answer rather than a blank panel.
    RaEmpty: { styleOverrides: { root: { color: CSS.mutedForeground, "& .RaEmpty-message": { color: CSS.mutedForeground } } } },
  },
});
