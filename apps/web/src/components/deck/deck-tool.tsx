"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { GalleryHorizontalEnd, Library, List, TriangleAlert } from "lucide-react";
import type { CardId, CardSummary, DeckAnalysis, StatChoices } from "@mtg/core/contract";
import { COMMANDER_DECK_SIZE } from "@mtg/core/commander";
import { CURVE_LINE, statDeltas, toTallyCard, type JourneyPhase, type StatLine } from "@mtg/core/journey";
import { decklistFromFile } from "@mtg/core/parse";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FEATURED_DECKS } from "@/lib/featured-decks";
import { CommanderLookupBar, CommanderLookupSheet } from "./commander-lookup";
import { DeckBar } from "./deck-bar";
import { DeckCoverage } from "./deck-coverage";
import { readReviewView, writeReviewView, type ReviewView } from "@/lib/review-view";
import { PanelError } from "./panel-state";
import { ResolutionIssues } from "./resolution-issues";
import { ResumeDeckDialog } from "./resume-deck-dialog";
import { CollectionOfferDialog } from "./collection-offer-dialog";
import { FileDrop, IMPORT_TEXT_BOX, LoadedFile, lineCount } from "@/components/collection/file-drop";
import { OpenDeckBar } from "@/components/decks/open-deck-bar";
import { SaveDeckButton, suggestedDeckName } from "@/components/decks/save-deck-button";
import { ShuffleDeck } from "./shuffle-deck";
import { PageHero } from "@/components/ui/page-hero";
import { UpgradePathPicker, type UpgradePath } from "./upgrade-paths";
import { BuildView } from "./build/build-view";
import { useDeckBuild } from "./build/use-deck-build";
import { ToolDeckEditor, type EditorHandle } from "@/components/deckbuilder/tool-deck-editor";
import { DeckStatsFooter } from "./deck-stats/deck-stats-footer";
import { DeckStatsRail } from "./deck-stats/deck-stats-rail";
import type { StatAction } from "./deck-stats/deck-stats-panel";
import { useDeckStats } from "./deck-stats/use-deck-stats";
import { statChips } from "./deck-stats/stat-chips";
import { StatPreviewProvider, type StatPreview } from "./deck-stats/stat-preview";
import { AddPhase } from "./journey/add-phase";
import { CollectionFitOffer, CollectionNudge } from "./journey/collection-nudge";
import { CutPhase } from "./journey/cut-phase";
import { FixPhase } from "./journey/fix-phase";
import { JourneyStepper } from "./journey/journey-stepper";
import { ReplacePhase } from "./journey/replace-phase";
import { ReviewPhase } from "./journey/review-phase";
import { RoundBar, type CopyState, type RoundSave } from "./journey/round-bar";
import { useDeckJourney, type DeckJourney } from "./journey/use-deck-journey";
import { useFix } from "./journey/use-fix";
import { useCollectionSource } from "@/components/collection/use-collection-source";
import { useCommanderLookup } from "./use-commander-lookup";
import { useDeckGroups } from "./use-deck-groups";
import { useDeckTool } from "./use-deck-tool";
import { useDeckCoverage } from "./use-deck-coverage";
import { CommanderPicker } from "@/components/rater/commander-picker";
import { MAX_DECK_NAME_CHARS } from "@mtg/core/schemas";
import { BUILD_DECK_HREF, BUILD_DEFAULT_BRACKET, DECK_START_BUILD, DECK_START_PARAM, TEXT_LINK, TOGGLE_OFF, TOGGLE_ON } from "@/lib/constants";
import { collectionCounts } from "@/lib/deck-collection";
import { getApis } from "@/lib/api/client";
import { RESUME_PARAM, RESUME_SAVE, takePendingSave } from "@/lib/pending-save";
import { ErrorText } from "@/components/ui/error-text";

const PLACEHOLDER = `Commander
1 Liesa, Forgotten Archangel

Deck
1 Sol Ring
1 Arcane Signet
…`;

/** Basic lands' type lines start so ("Basic Land", "Basic Snow Land"): a fitted list keeps them, as every player owns them. */
const BASIC_TYPE_PREFIX = "Basic ";

/** Tall enough to show a commander, the deck heading and a few cards of the placeholder before it scrolls. */
const DECKLIST_ROWS = 9;

/** The journey's steps column, which Deck stats' "Fix" scrolls back to. */
const STEPS_ID = "deck-journey-steps";
/** The lines Fix names that Deck stats shows under Bracket. */
const BRACKET_LINE = "bracket";

/**
 * A segmented control: one of a few options, pressed state on the chosen one. Used for how each journey phase is
 * reviewed (swipe or list).
 */
function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-4 py-1 text-sm font-normal transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
            // The chosen option reads as pressed: a thick blue edge. The others are blue text: pressable.
            value === o.value ? TOGGLE_ON : TOGGLE_OFF,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Swipe or list as one icon on phones, beside the steps: it shows the view it switches to. Wider screens have the
 * labelled segmented control in the row above.
 */
function ViewToggle({ view, onChange }: { view: ReviewView; onChange: (view: ReviewView) => void }) {
  const toList = view === "swipe";
  const label = toList ? "Show as a list" : "Swipe one card at a time";
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => onChange(toList ? "list" : "swipe")}
      className="bg-muted sm:hidden"
    >
      {toList ? <List aria-hidden className="size-4" /> : <GalleryHorizontalEnd aria-hidden className="size-4" />}
    </Button>
  );
}

/**
 * The Deck stats footer's height below lg (its bar, --deck-stats-dock-height in globals.css, plus the safe area), which
 * the swipe cards and the sticky Next bars sit above (T045), and none from lg, where the readout is a rail. A class
 * rather than an inline style, so the lg value can override it.
 */
const DECK_STATS_DOCK =
  "[--deck-stats-dock:calc(var(--deck-stats-dock-height)_+_env(safe-area-inset-bottom))] lg:[--deck-stats-dock:0px]";
/** From lg the round and the Deck stats rail sit side by side. */
const WITH_STATS_RAIL = "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6";

/**
 * "upgrade" walks the deck through the journey; "edit" is the deckbuilder, which only saving opens (Save deck, Save for
 * Later). No control switches between them: cancelling the save goes back to Upgrade.
 */
type ToolMode = "upgrade" | "edit";

/** The steps with a swipe view and a list view: Fix deals one pair at a time, and Finish is a summary. */
const hasViews = (phase: JourneyPhase) => phase !== "fix" && phase !== "review";

/** A deck's commanders as one comparable value, to tell whether the deck lookup offer needs checking again. */
const commandersOf = (analysis: DeckAnalysis) => analysis.deck.commanders.join(",");

/**
 * Next keeps this page alive while the player is elsewhere (Activity), so a link to the commander picker would land
 * back on the deck they were working on. A fresh link to it (a push, not Back) starts a new tool at the picker instead.
 * The deck they left stays in this browser's storage for the decklist box, and a saved one stays in their account.
 */
export function DeckTool() {
  const { bfcacheId } = useRouter();
  const buildStart = useSearchParams().get(DECK_START_PARAM) === DECK_START_BUILD;
  const [session, setSession] = useState(bfcacheId);
  const [seenNavigation, setSeenNavigation] = useState(bfcacheId);
  if (seenNavigation !== bfcacheId) {
    setSeenNavigation(bfcacheId);
    if (buildStart) setSession(bfcacheId);
  }
  return <DeckToolSession key={session} />;
}

function DeckToolSession() {
  // ?deck=<code> opens one of the signed-in player's saved decks instead of the deck from their last visit.
  // ?commander=<slug> opens a featured deck from the landing page carousel.
  // ?start=build builds a deck for a commander picked by name (from the collection when there is one).
  const searchParams = useSearchParams();
  const openCode = searchParams.get("deck");
  const commanderSlug = searchParams.get("commander");
  const buildStart = searchParams.get(DECK_START_PARAM) === DECK_START_BUILD;
  // ?resume=save finishes a save a signed-out player started, now that they have signed in.
  const resumeSave = searchParams.get(RESUME_PARAM) === RESUME_SAVE;
  const { source, refresh: refreshCollection, refreshing: collectionRefreshing } = useCollectionSource();
  const collectionLoaded = source.kind !== "loading";
  /**
   * The journey as of the latest render. The tool is created first (the journey is built on its analysis) but tells
   * the journey when settings change, so it reaches it through this.
   */
  const journeyRef = useRef<DeckJourney | null>(null);
  const tool = useDeckTool(source, {
    onContextChange: (ctx) => journeyRef.current?.reload(ctx) ?? Promise.resolve(),
  });
  const lookup = useCommanderLookup(tool.refreshRecommendations);
  const collectionDeckCode = tool.openDeck?.code ?? openCode;
  const collectionReturnPath = collectionDeckCode ? `/deck?deck=${encodeURIComponent(collectionDeckCode)}` : "/deck";
  const collectionImportHref = `/collection/import?next=${encodeURIComponent(collectionReturnPath)}` as Route;
  /** The build start's own import link returns to the commander picker. */
  const buildImportHref = `/collection/import?next=${encodeURIComponent(BUILD_DECK_HREF)}` as Route;
  const deckBuild = useDeckBuild(tool.ownedOnly);
  /** With a collection, the build start lists owned commanders unless the player asks for any. */
  const [pickFrom, setPickFrom] = useState<"owned" | "any">("owned");
  /** The paste screen's choice while there is no collection; with one, the collection setting is the choice. */
  const [pathWithoutCollection, setPathWithoutCollection] = useState<UpgradePath>("online");
  const upgradePath: UpgradePath =
    tool.collectionMode === null ? pathWithoutCollection : tool.collectionMode === "off" ? "online" : "owned";
  /** "Best cards online" sets the collection aside; "Cards I own" applies it, as owned only coming from aside. */
  function choosePath(path: UpgradePath) {
    if (tool.collectionMode === null) return setPathWithoutCollection(path);
    if (path === "online") tool.changeCollectionMode("off");
    else if (tool.collectionMode === "off") tool.changeCollectionMode("only");
  }
  /** A copy of the round's result saved as a new deck, from an open saved deck's Save menu; a new deck starts without one. */
  const [copy, setCopy] = useState<CopyState>({ status: "idle" });
  const [copyRound, setCopyRound] = useState(tool.round);
  if (copyRound !== tool.round) {
    setCopyRound(tool.round);
    setCopy({ status: "idle" });
  }
  /** The commanders the deck lookup offer was last checked for; a deckbuilder edit that changes them checks again. */
  const lookupCheckedFor = useRef<string | null>(null);
  const deckGroups = useDeckGroups(tool.lines);
  const [editing, setEditing] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [view, setView] = useState<ReviewView>(readReviewView);
  const [mode, setMode] = useState<ToolMode>("upgrade");
  const router = useRouter();
  /**
   * The inline deckbuilder's waiting edit, while it is on screen: flushed so Save and the decklist box see the deck as
   * edited, and discarded when the deck is about to be replaced, so an edit to the old deck cannot land on the new one.
   */
  const editorHandle = useRef<EditorHandle | null>(null);
  /** Review's Save on a deck that isn't saved yet opens the name form in the header. */
  const [saveAsked, setSaveAsked] = useState(false);
  const [committing, setCommitting] = useState(false);
  /** The last file read into the decklist box, and whether its text is on show (see `LoadedFile`). */
  const [deckFile, setDeckFile] = useState<{ name: string; text: string } | null>(null);
  const [fileTextShown, setFileTextShown] = useState(false);
  const restoreStarted = useRef(false);
  /** The commander picker opened the tool, so the remembered deck wasn't put back in the box. */
  const restoreSkipped = useRef(false);
  const resumeStarted = useRef(false);
  /** Until the resumed save settles; shown only once the visitor is known to be signed in. */
  const [resuming, setResuming] = useState(resumeSave);
  /**
   * The deck from the last visit goes back in the box on arrival, and the player is asked whether to carry on with it.
   * Once they answer or wave the question away it stays answered, and the box keeps whatever they chose.
   */
  const [resumeAnswered, setResumeAnswered] = useState(false);
  const signedIn = source.kind === "account" || (source.kind !== "loading" && source.signedIn);
  /**
   * The import offer below comes back on every visit while the player has no collection: the suggestions lean on it.
   * Answering or waving it away settles it for this visit only. Next keeps a page's state while it is hidden behind
   * another route, so leaving the page (to the import, say) asks again on the way back.
   */
  const [collectionOfferAnswered, setCollectionOfferAnswered] = useState(false);
  useLayoutEffect(() => () => setCollectionOfferAnswered(false), []);
  const { analysis, context } = tool;
  const journey = useDeckJourney({
    analysis,
    round: tool.round,
    context,
    lines: tool.lines,
    cut: tool.cut,
    resume: tool.resumed,
    choices: tool.statChoices,
  });
  const coverageEnabled = mode === "upgrade" && !tool.stale;
  const coverage = useDeckCoverage(journey.deck, source, tool.openDeck?.deckId, coverageEnabled && !collectionRefreshing);
  const hasWorkingDeck = journey.deck !== null;
  useEffect(() => {
    if (!coverageEnabled || !hasWorkingDeck) return;
    const onFocus = () => { void refreshCollection(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [coverageEnabled, hasWorkingDeck, refreshCollection]);
  useEffect(() => {
    journeyRef.current = journey;
  });

  // ── Deck stats (T045) ──────────────────────────────────────────────────────────────────────────────────────────
  const deckStats = useDeckStats({
    analysis,
    entries: journey.after,
    bracket: context?.bracket ?? null,
    overBracketAdds: journey.overBracketAdds,
    // The round's starting deck, so a deck lookup finishing mid-round (a new analysis of the same deck) keeps the ticks.
    start: journey.before,
    choices: tool.statChoices,
  });
  // ── Fix (T087) ─────────────────────────────────────────────────────────────────────────────────────────────────
  const fix = useFix({
    journey,
    analysis,
    context,
    report: deckStats,
    choices: tool.statChoices,
    overBracketAdds: journey.overBracketAdds,
  });
  const toSteps = () => document.getElementById(STEPS_ID)?.scrollIntoView({ block: "start", behavior: "smooth" });
  /**
   * What a line that is off offers: "Fix", which opens Fix at that line. Offered once the deck may go on to Fix (Cut
   * keeps it shut while the deck is over 100).
   */
  const canFix = journey.state !== null && journey.stepper.canOpen("fix");
  const fixAction = (line: string): StatAction | null =>
    canFix
      ? {
          label: "Fix",
          onSelect: () => {
            fix.openAt(line);
            toSteps();
          },
        }
      : null;
  const statAction = (stat: StatLine): StatAction | null => (stat.state === "off" ? fixAction(stat.key) : null);
  const curveAction = deckStats?.curve.state === "off" ? fixAction(CURVE_LINE) : null;
  const bracketAction = deckStats && !deckStats.bracket.ok ? fixAction(BRACKET_LINE) : null;
  const comboCount = journey.add.combos.length;
  /** "Find combos" under Bracket: Add's Combos part, in a round that runs Add, when the last Add list had any. */
  const combosAction: StatAction | null =
    comboCount > 0 && journey.stepper.canOpen("add")
      ? {
          label: `Find combos (${comboCount})`,
          onSelect: () => {
            journey.add.openCombos();
            toSteps();
          },
        }
      : null;
  /** The card on screen in a swipe view, which Deck stats previews answering. */
  const [statPreview, setStatPreview] = useState<StatPreview | null>(null);
  const tallyOf = (card: CardSummary | null) => (card && analysis ? toTallyCard(card, card.roles ?? analysis.cardRoles[card.id] ?? []) : null);
  const previewDeltas =
    deckStats && statPreview
      ? statDeltas(deckStats.stats, tallyOf(statPreview.add), tallyOf(statPreview.remove), deckStats.mana.deck)
      : null;
  /** The score with the card on screen answered: the deck graded again with it in and out, for the footer. */
  const previewScore = useMemo(
    () => (statPreview ? fix.scoreWith([{ in: statPreview.add, out: statPreview.remove }]) : null),
    // scoreWith is rebuilt every render; it reads the deck's tally, the bracket and the choices, which are what move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [statPreview, journey.tally, context?.bracket, tool.statChoices, journey.overBracketAdds],
  );
  /** The Deck stats lines a card in and a card out would move: the chips shown by the card on screen. */
  const chipsFor = (add: CardSummary | null, remove: CardSummary | null) => (deckStats ? statChips(deckStats, tallyOf(add), tallyOf(remove)) : []);
  const statsPanel = deckStats
    ? {
        report: deckStats,
        cards: journey.cards,
        actionFor: statAction,
        curveAction,
        bracketAction,
        combosAction,
        preview: previewDeltas && previewDeltas.size > 0 ? previewDeltas : null,
      }
    : null;

  /** Offers a deck lookup when the deck's commander has no play data, remembering which commanders it checked. */
  function checkLookup(checked: DeckAnalysis | null) {
    lookupCheckedFor.current = checked ? commandersOf(checked) : null;
    void lookup.check(checked);
  }

  /*
   * Open where the player left off: a featured deck when the link named one and a saved deck when the link named one,
   * both analyzed; otherwise the deck from their last visit goes back in the decklist box, unanalyzed, for them to
   * run or clear. The two link paths analyze, so they wait for the saved collection first, so owned-only suggestions
   * apply from the first load; the remembered deck only fills the box, so it restores at once rather than risking the
   * player's own paste or "Use sample deck" click, made while the collection is still loading, being overwritten.
   */
  useEffect(() => {
    if (restoreStarted.current) return;

    // ?commander=<slug> loads a featured deck from the landing page carousel; an unknown slug falls through to the
    // remembered deck, same as no slug at all.
    const featured = commanderSlug !== null ? FEATURED_DECKS.find((d) => d.slug === commanderSlug) : undefined;
    const hasLink = openCode !== null || featured !== undefined;

    if (!hasLink) {
      restoreStarted.current = true;
      // The commander picker starts a new deck: the remembered one stays in storage for the decklist box, unoffered here.
      if (buildStart) restoreSkipped.current = true;
      else tool.restoreLastDeck();
      return;
    }

    if (!collectionLoaded) return;
    restoreStarted.current = true;

    if (featured) {
      void tool.submit({ text: featured.decklist, bracketOverride: null, importedFrom: null }).then((outcome) => {
        if (outcome.parsed) {
          setEditing(false);
          checkLookup(outcome.analysis);
        }
      });
      return;
    }
    // hasLink is true and featured is undefined here, so openCode must be set; the check just gives TS proof of it.
    if (openCode === null) return;

    void tool.openSavedDeck(openCode).then((r) => {
      if (!r.ok) {
        setOpenError(r.error.message);
        // Fall back to the remembered deck, in the box, rather than an empty one: the link failing shouldn't cost them their work.
        tool.restoreLastDeck();
        return;
      }
      if (!r.data.parsed) return;
      setEditing(false);
      checkLookup(r.data.analysis);
    });
    // checkLookup is rebuilt with every render, like tool and lookup; restoreStarted is what keeps this to one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, lookup, collectionLoaded, openCode, commanderSlug, buildStart]);
  // Leaving the picker for the decklist box without building anything offers the remembered deck there after all.
  useEffect(() => {
    if (buildStart || !restoreSkipped.current) return;
    restoreSkipped.current = false;
    if (!analysis && deckBuild.state.status === "idle") tool.restoreLastDeck();
    // Runs when the picker is left; analysis, deckBuild and tool are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildStart]);
  /*
   * Back from signing in to save: the deck they asked to save was kept in this browser, so it is saved to the account
   * now and opened in its editor. Their collection needs nothing here: a browser collection moves to the account on
   * its own at sign-in. Waits until the collection source knows they are signed in; a player who came back signed out
   * keeps the stash for their next try.
   */
  useEffect(() => {
    if (!resumeSave || resumeStarted.current || source.kind === "loading") return;
    if (source.kind !== "account" && !source.signedIn) return;
    resumeStarted.current = true;
    const pending = takePendingSave();
    void (
      pending
        ? getApis().actions.saveDeck({
            name: pending.name,
            deck: pending.deck,
            isPublic: true,
            ...(pending.bracket === null ? {} : { bracket: pending.bracket }),
            ...(pending.original ? { original: pending.original } : {}),
            ...(pending.statChoices ? { statChoices: pending.statChoices } : {}),
          })
        : Promise.resolve(null)
    ).then((r) => {
      setResuming(false);
      if (!r) return;
      if (r.ok) router.replace(`/decks/deck/${r.data.code}/edit` as Route);
      else setOpenError(`Couldn't save your deck: ${r.error.message}`);
    });
  }, [resumeSave, source, router]);

  const showInput = editing || !analysis;
  // Building from nothing asks for a commander in place of the decklist box, until there is a deck to build on.
  const showPicker = buildStart && !analysis;
  // On the opening screens a player with no collection is offered an import first; the resume question waits for the
  // collection to load and the offer to be answered, so the two never stack and the offer never pops up mid-analysis.
  const offersCollection = source.kind === "none" && !collectionRefreshing && !collectionOfferAnswered && (showPicker || showInput);
  const asksResume =
    tool.restoredDeck !== null && tool.showsRestoredDeck && !resumeAnswered && !analysis && !collectionRefreshing && !offersCollection;
  // The chip stands for the file only while the box still holds what the file put there: an edit, the sample deck or
  // Clear all make it a plain decklist again.
  const fileInBox = deckFile !== null && deckFile.text === tool.text ? deckFile : null;
  const textHidden = fileInBox !== null && !fileTextShown;

  /** A saved deck's deckbuilder has its own address; the commander segment is decoration, the code finds the deck. */
  const editorUrl = (code: string) => `/decks/${analysis?.commanderKey.commanders[0]?.slug ?? "deck"}/${code}/edit` as Route;

  /**
   * Back to Upgrade when the player cancels saving: the deckbuilder's waiting edit goes in first, with the cuts Upgrade
   * opens on; without one, the cuts the deckbuilder's edits left waiting are loaded.
   */
  function backToUpgrade() {
    const handle = editorHandle.current;
    if (handle?.hasPending()) void handle.flush({ recs: true });
    else tool.ensureCuts();
    setMode("upgrade");
  }

  /**
   * The deck bar's pencil: the decklist box opens at the top of the page, so the page goes there with it. A deckbuilder
   * edit still waiting goes into the box first, so it can't land on top of what the player types there.
   */
  async function editDecklist() {
    await editorHandle.current?.flush();
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function changeView(next: ReviewView) {
    setView(next);
    writeReviewView(next);
  }

  /**
   * Analyzes the decklist box. A deckbuilder edit still waiting belongs to the deck being replaced, so it is dropped. A
   * decklist that couldn't be read keeps the box open with the error, rather than folding it away over the last deck's
   * suggestions.
   */
  async function analyze() {
    editorHandle.current?.discard();
    const outcome = await tool.submit();
    if (!outcome.parsed) return;
    setEditing(false);
    setMode("upgrade");
    checkLookup(outcome.analysis);
  }

  /** Empties the tool: the decklist box, the deck and everything built on it. */
  function clearAll() {
    editorHandle.current?.discard();
    tool.clearDeck();
    lookup.reset();
    lookupCheckedFor.current = null;
    setEditing(true);
  }

  /**
   * Takes a built deck into the tool: Upgrade goes through it card by card, the Deckbuilder edits it. It is a new deck,
   * so an open account deck is let go first rather than overwritten. The answers the build page took for the lines the
   * collection couldn't fill (ignore, or allow buying) go with it.
   */
  async function openBuilt(text: string, next: ToolMode, statChoices: StatChoices): Promise<boolean> {
    if (deckBuild.state.status !== "ready") return false;
    editorHandle.current?.discard();
    if (tool.openDeck) tool.closeSavedDeck();
    const bracket = deckBuild.state.request.bracket;
    const outcome = await tool.submit({ text, bracketOverride: bracket, importedFrom: null, statChoices }, { recs: next === "upgrade" });
    if (!outcome.parsed) return false;
    deckBuild.reset();
    // Off the picker's address: a refresh now offers this deck back, instead of the commander picker.
    if (buildStart) router.replace("/deck" as Route, { scroll: false });
    setEditing(false);
    setMode(next);
    checkLookup(outcome.analysis);
    return true;
  }

  /** Save for Later: the built deck in the Deckbuilder with the name form open, as Upgrade's Save does. */
  async function saveBuilt(text: string, statChoices: StatChoices) {
    if (await openBuilt(text, "edit", statChoices)) setSaveAsked(true);
  }

  /**
   * Fits a list to the collection: the list fixes the commander and the bracket, its owned cards (and its
   * basic lands, assumed owned) are kept, and the build fills the rest from the collection. `text` is a list other
   * than the box's (Done's result); the box's list is read first either way, for its cards.
   */
  async function fitToCollection(text?: string) {
    const outcome = await tool.submit(text === undefined ? undefined : { text, bracketOverride: tool.bracketOverride, importedFrom: null }, { recs: false });
    if (!outcome.parsed || !outcome.analysis || !outcome.lines) return;
    const commanders = outcome.analysis.commanderKey.commanders;
    if (commanders.length === 0) return;
    const owned = await collectionCounts(source);
    const cards = new Map<CardId, CardSummary>();
    for (const { resolution } of outcome.lines) if (resolution.status === "resolved") cards.set(resolution.card.id, resolution.card);
    const entries = outcome.analysis.deck.cards.filter((c) => c.section === "main");
    const kept = entries.flatMap((entry) => {
      const basic = cards.get(entry.cardId)?.typeLine.startsWith(BASIC_TYPE_PREFIX) ?? false;
      const quantity = basic ? entry.quantity : Math.min(entry.quantity, owned.get(entry.cardId) ?? 0);
      return quantity > 0 ? [{ ...entry, quantity }] : [];
    });
    setEditing(false);
    void deckBuild.build({ commanders, bracket: tool.bracketOverride ?? outcome.analysis.estimatedBracket, kept, list: { entries, cards } });
  }

  /**
   * Ends a journey round. Save and Re-analyze put the result in the decklist and analyze it, which starts a new round
   * at Add. Save then opens the editor: an open account deck has just been written back by the analysis, and a deck
   * that isn't saved yet gets the name form.
   */
  async function commitJourney(kind: "save" | "reanalyze") {
    const text = journey.resultText();
    if (text === null) return;
    setCommitting(true);
    const outcome = await tool.commitText(text);
    setCommitting(false);
    if (!outcome.parsed) return;
    if (kind === "save") {
      // An open deck was just written back by the analysis; once that lands, its editor has the result.
      if (tool.openDeck) {
        await tool.whenSaved();
        router.push(editorUrl(tool.openDeck.code));
        return;
      }
      setMode("edit");
      setSaveAsked(true);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /**
   * Save as copy: the round's result as a new deck, leaving the open one as it is. The round goes on; the copy is a
   * link away. Saving never touches the collection.
   */
  async function saveCopy() {
    const deck = journey.deck;
    const open = tool.openDeck;
    if (!deck || !open || !analysis) return;
    setCopy({ status: "saving" });
    const name = `${open.name} (copy)`.slice(0, MAX_DECK_NAME_CHARS);
    const result = await getApis().actions.saveDeck({
      name,
      deck,
      isPublic: true,
      ...(tool.bracketOverride === null ? {} : { bracket: tool.bracketOverride }),
      original: analysis.deck,
      statChoices: tool.statChoices,
    });
    setCopy(result.ok ? { status: "saved", name, href: editorUrl(result.data.code) } : { status: "error", message: result.error.message });
  }
  const roundSave: RoundSave = tool.openDeck
    ? {
        kind: "open",
        deckName: tool.openDeck.name,
        onSaveChanges: () => void commitJourney("save"),
        onSaveCopy: () => void saveCopy(),
        copy,
      }
    : { kind: "new", onSave: () => void commitJourney("save") };

  return (
    <div className="flex flex-col gap-5">
      {/* The open deck stays named while its decklist is being edited: it is still the deck being worked on. */}
      {tool.openDeck && (
        <OpenDeckBar deck={tool.openDeck} onClose={tool.closeSavedDeck} />
      )}
      {deckBuild.state.status !== "idle" ? (
        <BuildView
          state={deckBuild.state}
          collectionImportHref={buildImportHref}
          onBracket={(bracket) => {
            if (deckBuild.state.status !== "idle") void deckBuild.build({ ...deckBuild.state.request, bracket });
          }}
          onChoice={deckBuild.choose}
          onUpgrade={async (text, statChoices) => {
            deckBuild.accept();
            await openBuilt(text, "upgrade", statChoices);
          }}
          onSave={async (text, statChoices) => {
            deckBuild.accept();
            await saveBuilt(text, statChoices);
          }}
          onPickAnother={() => {
            // Back from a fitted list goes to the list; back from a build goes to the commander picker.
            if (deckBuild.state.status !== "idle" && deckBuild.state.request.list) setEditing(true);
            deckBuild.reset();
          }}
        />
      ) : showPicker ? (
        <PageHero
          id="deck-build-heading"
          heading="Choose commander"
          aside="We'll deal you a deck."
          intro={
            <>
              {source.kind === "none" && (
                <p className="text-sm text-muted-foreground">
                  <Link href={buildImportHref} className={cn(TEXT_LINK, "font-semibold")}>
                    Import your collection
                  </Link>{" "}
                  to pick from commanders you own and build from your cards.
                </p>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {tool.ownedOnly && (
              <Segmented
                label="Which commanders to list"
                options={[
                  { value: "owned", label: "From my collection" },
                  { value: "any", label: "Any commander" },
                ]}
                value={pickFrom}
                onChange={setPickFrom}
              />
            )}
            {/* The collection offer takes focus while it is up; off again, the cursor goes back into the box. */}
            <CommanderPicker
              autoFocus={!offersCollection}
              ownedOnly={pickFrom === "owned" ? (tool.ownedOnly ?? undefined) : undefined}
              onPick={(card) => void deckBuild.build({ commanders: [card], bracket: BUILD_DEFAULT_BRACKET })}
            />
          </div>
        </PageHero>
      ) : showInput ? (
        <PageHero
          id="deck-input-heading"
          heading="Upgrade a deck"
          aside="From the best cards online, or with cards you already own."
          intro={
            <>
              {/* Phones go straight to the choice and the box: the heading says enough there. */}
              <p className="max-sm:hidden">
                Paste a Commander decklist or a link to a public Archidekt deck. We&apos;ll go through it a card at a
                time: what to cut, what to add, and replacements that do the same job.
              </p>
              {tool.showsRestoredDeck && (
                <p className="text-sm text-muted-foreground">
                  Your last decklist is back in the box. Analyze it to pick up where you left off, or clear it to start a
                  new one.
                </p>
              )}
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <UpgradePathPicker value={upgradePath} onChange={choosePath} hasCollection={tool.collectionMode !== null} />
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (upgradePath === "owned" && tool.collectionMode === null) return;
                void analyze();
              }}
            >
              <Label htmlFor={textHidden ? undefined : "decklist"} className="font-semibold">
                Decklist
              </Label>
              {!textHidden && (
                <Textarea
                  id="decklist"
                  rows={DECKLIST_ROWS}
                  value={tool.text}
                  onChange={(e) => tool.setText(e.target.value)}
                  placeholder={PLACEHOLDER}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  // Phones get a shorter box, so the choice, the box and Analyze share one screen.
                  className={cn(IMPORT_TEXT_BOX, "bg-background/60 max-sm:min-h-0 max-sm:h-36")}
                />
              )}
              {fileInBox ? (
                <LoadedFile
                  name={fileInBox.name}
                  lines={lineCount(fileInBox.text)}
                  textShown={fileTextShown}
                  onToggleText={() => setFileTextShown((shown) => !shown)}
                  onRemove={() => {
                    tool.setText("");
                    setDeckFile(null);
                  }}
                  disabled={tool.parse.status === "loading"}
                />
              ) : (
                // A CSV deck export collapses to quantity and name: a deck is oracle-level, so the printing is noise.
                <FileDrop
                  note=".csv or .txt from ManaBox, Moxfield, Archidekt or TCGplayer."
                  disabled={tool.parse.status === "loading"}
                  onFile={(contents, name) => {
                    const text = decklistFromFile(contents);
                    tool.setText(text);
                    setDeckFile({ name, text });
                    setFileTextShown(false);
                  }}
                />
              )}
              {upgradePath === "owned" && tool.collectionMode === null && (
                <p className="text-sm text-muted-foreground">
                  Your list waits here while you upload your collection, then we upgrade it with cards you own.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {upgradePath === "owned" && tool.collectionMode === null ? (
                  <Link href={collectionImportHref} className={buttonVariants({ size: "lg", className: "lit gap-2" })}>
                    <Library aria-hidden className="size-4" />
                    Upload your collection
                  </Link>
                ) : (
                  <Button
                    type="submit"
                    size="lg"
                    className="lit"
                    disabled={!tool.text.trim() || tool.parse.status === "loading"}
                  >
                    {/* The chosen tile says which path; the action is the same name either way. */}
                    {tool.parse.status === "loading" ? "Reading decklist…" : "Analyze deck"}
                  </Button>
                )}
                {upgradePath === "owned" && tool.ownedOnly && (
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    disabled={!tool.text.trim() || tool.parse.status === "loading"}
                    onClick={() => void fitToCollection()}
                  >
                    Fit it to my collection
                  </Button>
                )}
                <Button type="button" size="lg" variant="outline" onClick={tool.loadSample}>
                  Use sample deck
                </Button>
                {tool.text && (
                  <Button type="button" size="lg" variant="ghost" onClick={clearAll}>
                    Clear
                  </Button>
                )}
                {analysis && (
                  <Button type="button" size="lg" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>
            {!analysis && tool.parse.status === "loading" && <ShuffleDeck label="Reading your decklist" />}
          </div>
        </PageHero>
      ) : null}
      {resuming && signedIn && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving your deck to your new account…
        </p>
      )}
      {openError && (
        <ErrorText>
          {openError}
        </ErrorText>
      )}

      {tool.importedFrom && tool.parse.status === "ready" && (
        <p className="text-sm text-muted-foreground">
          Imported from{" "}
          <a href={tool.importedFrom.url} target="_blank" rel="noreferrer" className={TEXT_LINK}>
            Archidekt
          </a>
          . Edit the decklist to change it here.
        </p>
      )}
      {tool.parse.status === "error" && <PanelError message={tool.parse.message} />}
      <ResolutionIssues
        unresolved={tool.unresolvedLines}
        issues={analysis?.issues ?? []}
        issuesInDeckBar={Boolean(analysis && context)}
      />

      {analysis && context && deckBuild.state.status === "idle" && (
        <section aria-label="Recommendations" className="flex flex-col gap-2">
          <DeckBar
            collectionImportHref={collectionImportHref}
            analysis={analysis}
            context={context}
            deckName={tool.openDeck?.name ?? tool.deckName ?? suggestedDeckName(analysis)}
            onRename={tool.renameDeck}
            coverage={coverageEnabled && journey.deck && (source.kind === "browser" || source.kind === "account")
              ? collectionRefreshing
                ? <span role="status" className="whitespace-nowrap">Checking collection…</span>
                : coverage ? <DeckCoverage status={coverage} retry={() => void refreshCollection()} /> : undefined
              : undefined}
            onBracketChange={tool.changeBracket}
            collectionMode={tool.collectionMode}
            onCollectionModeChange={tool.changeCollectionMode}
            onEditDecklist={showInput ? undefined : () => void editDecklist()}
            // Saving is asked for, never automatic: a new deck is public. Upgrade's Save deck (and a build's Save for
            // Later) brings the player here, in the Deckbuilder with the name form open; Cancel goes back to Upgrade. An
            // open deck already writes back on its own (and edits in its own editor).
            saveSlot={
              mode === "edit" && !tool.openDeck ? (
                <SaveDeckButton
                  key={saveAsked ? "asked" : "idle"}
                  analysis={analysis}
                  bracket={tool.bracketOverride}
                  onSaved={(deck) => {
                    setSaveAsked(false);
                    tool.trackSavedDeck(deck);
                    // Saving opens the deck in its deckbuilder, at the address it keeps from now on.
                    router.push(editorUrl(deck.code));
                  }}
                  defaultOpen={saveAsked}
                  original={tool.original}
                  beforeSave={async () => (editorHandle.current ? editorHandle.current.flush() : null)}
                  collection={source}
                  defaultName={tool.deckName}
                  statChoices={tool.statChoices}
                  onCancel={() => {
                    setSaveAsked(false);
                    backToUpgrade();
                  }}
                />
              ) : undefined
            }
          />
          <CommanderLookupBar lookup={lookup} />
          {/* Phones get the same choice as one icon beside the steps (`ViewToggle`), to save this row's height. */}
          {mode === "upgrade" && journey.state && hasViews(journey.state.phase) && (
            <div className="max-sm:hidden">
              <Segmented
                label="How to review cards"
                options={[
                  { value: "swipe", label: "Swipe" },
                  { value: "list", label: "List" },
                ]}
                value={view}
                onChange={changeView}
              />
            </div>
          )}
          {mode === "upgrade" ? (
            journey.state && (
              <StatPreviewProvider onChange={setStatPreview} chipsFor={chipsFor}>
              <div className={cn(statsPanel && [DECK_STATS_DOCK, WITH_STATS_RAIL])}>
                {/* scroll-mt clears the sticky deck bar when "Pick cuts" brings the steps back into view. */}
                <div id={STEPS_ID} className="flex min-w-0 scroll-mt-24 flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <JourneyStepper phases={journey.phases} phase={journey.state.phase} canOpen={journey.stepper.canOpen} onSelect={journey.stepper.select} />
                    </div>
                    {hasViews(journey.state.phase) && <ViewToggle view={view} onChange={changeView} />}
                  </div>
                  <RoundBar canUndo={journey.canUndo} onUndo={journey.undo} onStartOver={journey.restart} save={roundSave} busy={committing || tool.stale} showSave={journey.state.phase !== "review"} />
                  {journey.state.phase === "cut" && (
                    <CutPhase
                      journey={journey}
                      cutState={tool.cut}
                      view={view}
                      deckGroups={deckGroups}
                      trim={deckStats && analysis ? { stats: deckStats.stats, cardRoles: analysis.cardRoles } : undefined}
                      onShowList={() => changeView("list")}
                    />
                  )}
                  {journey.state.phase === "add" && (
                    <AddPhase
                      journey={journey}
                      view={view}
                      roles={deckStats?.stats.filter((stat) => stat.group === "roles") ?? []}
                      onShowUnowned={() => tool.changeCollectionMode("first")}
                      uploadHref={
                        (signedIn
                          ? `${collectionImportHref}&ifEmpty=1`
                          : `/sign-in?next=${encodeURIComponent(`${collectionImportHref}&ifEmpty=1`)}`) as Route
                      }
                    />
                  )}
                  {journey.state.phase === "fix" && <FixPhase journey={journey} fix={fix} hasCollection={journey.add.hasCollection} />}
                  {journey.state.phase === "replace" && <ReplacePhase journey={journey} view={view} commanderKeyId={analysis.commanderKey.id} />}
                  {/* Players who came with only a list are offered their collection at every step (Done has its own). */}
                  {source.kind === "none" && journey.state.phase !== "review" && (
                    <CollectionNudge href={collectionImportHref} step={journey.state.phase} />
                  )}
                  {journey.state.phase === "review" && (
                    <ReviewPhase
                      journey={journey}
                      report={deckStats}
                      busy={committing}
                      stale={tool.stale}
                      save={roundSave}
                      onReanalyze={() => void commitJourney("reanalyze")}
                      fix={fix}
                      choices={tool.statChoices}
                      onChoice={tool.setStatChoice}
                      collectionOnly={journey.add.collectionOnly}
                    >
                      {source.kind === "none" ? (
                        <CollectionNudge href={collectionImportHref} step="review" />
                      ) : tool.ownedOnly ? (
                        <CollectionFitOffer
                          disabled={committing || tool.stale}
                          onFit={() => {
                            const text = journey.resultText();
                            if (text !== null) void fitToCollection(text);
                          }}
                        />
                      ) : null}
                    </ReviewPhase>
                  )}
                </div>
                {statsPanel && (
                  <>
                    <DeckStatsRail className="hidden lg:flex" {...statsPanel} />
                    <DeckStatsFooter className="lg:hidden" dock="lg" previewScore={previewScore} {...statsPanel} />
                  </>
                )}
              </div>
              </StatPreviewProvider>
            )
          ) : (
            // Remounted when the player pastes a new decklist, so the builder starts from it rather than its old state.
            <ToolDeckEditor
              key={tool.originText ?? "deck"}
              tool={tool}
              handleRef={editorHandle}
              collection={{
                mode: tool.collectionMode,
                onChange: tool.changeCollectionMode,
                // Owned only limits the search as well as the replacements; the ownership is what the tool already sends.
                ownedOnly: tool.collectionMode === "only" ? (context.ownership ?? undefined) : undefined,
              }}
              onCommitted={(committed) => {
                // A new commander from the deckbuilder gets the same deck lookup offer as a pasted one.
                if (committed && commandersOf(committed) !== lookupCheckedFor.current) checkLookup(committed);
              }}
            />
          )}
        </section>
      )}

      <CommanderLookupSheet lookup={lookup} />
      <Dialog open={journey.stepper.leaving !== null} onOpenChange={(open) => !open && journey.stepper.cancelLeave()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert aria-hidden className="size-5 text-warning" />
              Deck Under 100
            </DialogTitle>
            <DialogDescription>
              The deck is at {COMMANDER_DECK_SIZE - journey.openSlots} of {COMMANDER_DECK_SIZE}. Continue anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep adding
              </Button>
            </DialogClose>
            <Button type="button" onClick={journey.stepper.confirmLeave}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {tool.restoredDeck && asksResume && (
        <ResumeDeckDialog
          name={tool.restoredDeck.deckName ?? tool.restoredDeck.commanderName ?? null}
          onYes={() => {
            setResumeAnswered(true);
            void analyze();
          }}
          onNo={() => {
            setResumeAnswered(true);
            clearAll();
          }}
          onDismiss={() => setResumeAnswered(true)}
        />
      )}
      {offersCollection && (
        <CollectionOfferDialog
          importHref={(showPicker ? buildImportHref : collectionImportHref) as Route}
          onDismiss={() => setCollectionOfferAnswered(true)}
        />
      )}
    </div>
  );
}
