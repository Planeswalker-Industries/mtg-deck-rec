"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { GalleryHorizontalEnd, List } from "lucide-react";
import type { CardSummary, DeckAnalysis } from "@mtg/core/contract";
import { decklistFor, type StatLine } from "@mtg/core/journey";
import { decklistFromFile } from "@mtg/core/parse";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FEATURED_DECKS } from "@/lib/featured-decks";
import { CommanderLookupBar, CommanderLookupSheet } from "./commander-lookup";
import { DeckBar } from "./deck-bar";
import { readReviewView, writeReviewView, type ReviewView } from "@/lib/review-view";
import { PanelError } from "./panel-state";
import { ResolutionIssues } from "./resolution-issues";
import { ResumeDeckDialog } from "./resume-deck-dialog";
import { FileDrop, IMPORT_TEXT_BOX, LoadedFile, lineCount } from "@/components/collection/file-drop";
import { OpenDeckBar } from "@/components/decks/open-deck-bar";
import { SaveDeckButton, suggestedDeckName } from "@/components/decks/save-deck-button";
import { ShuffleDeck } from "./shuffle-deck";
import { ToolDeckEditor, type EditorHandle } from "@/components/deckbuilder/tool-deck-editor";
import { DeckStatsFooter } from "./deck-stats/deck-stats-footer";
import { DeckStatsRail } from "./deck-stats/deck-stats-rail";
import type { StatAction } from "./deck-stats/deck-stats-panel";
import { useDeckStats } from "./deck-stats/use-deck-stats";
import { AddPhase, type AddFilter } from "./journey/add-phase";
import { BracketCheckPanel } from "./journey/bracket-check-panel";
import { CutPhase } from "./journey/cut-phase";
import { JourneyStepper } from "./journey/journey-stepper";
import { ReplacePhase } from "./journey/replace-phase";
import { ReviewPhase } from "./journey/review-phase";
import { useDeckJourney, type DeckJourney } from "./journey/use-deck-journey";
import { useCollectionSource } from "@/components/collection/use-collection-source";
import { useCommanderLookup } from "./use-commander-lookup";
import { useDeckGroups } from "./use-deck-groups";
import { useDeckTool } from "./use-deck-tool";
import { CommanderPicker } from "@/components/rater/commander-picker";
import { DECK_START_BUILD, DECK_START_PARAM, TEXT_LINK } from "@/lib/constants";
import { getApis } from "@/lib/api/client";
import { RESUME_PARAM, RESUME_SAVE, takePendingSave } from "@/lib/pending-save";

const PLACEHOLDER = `Commander
1 Liesa, Forgotten Archangel

Deck
1 Sol Ring
1 Arcane Signet
…`;

/**
 * A segmented control: one of a few options, pressed state on the chosen one. Used for the tool's mode (upgrade or
 * edit) and for how each journey phase is reviewed (swipe or list).
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
            // The chosen option reads as pressed: the primary fill with dark text, like the main action.
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary",
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
      className="bg-muted text-muted-foreground hover:text-primary focus-visible:text-primary sm:hidden"
    >
      {toList ? <List aria-hidden className="size-4" /> : <GalleryHorizontalEnd aria-hidden className="size-4" />}
    </Button>
  );
}

/**
 * The Deck stats footer's height on phones, which the swipe cards size around (T045), and none from lg, where the
 * readout is a rail. A class rather than an inline style, so the lg value can override it.
 */
const DECK_STATS_DOCK = "[--deck-stats-dock:calc(3.5rem_+_env(safe-area-inset-bottom))] lg:[--deck-stats-dock:0px]";

/** "upgrade" walks the deck through the journey; "edit" is the deckbuilder. */
type ToolMode = "upgrade" | "edit";

/** A deck's commanders as one comparable value, to tell whether the deck lookup offer needs checking again. */
const commandersOf = (analysis: DeckAnalysis) => analysis.deck.commanders.join(",");

export function DeckTool() {
  // ?deck=<code> opens one of the signed-in player's saved decks instead of the deck from their last visit.
  // ?commander=<slug> opens a featured deck from the landing page carousel.
  // ?start=build starts a deck from a commander picked by name, in the Deckbuilder.
  const searchParams = useSearchParams();
  const openCode = searchParams.get("deck");
  const commanderSlug = searchParams.get("commander");
  const buildStart = searchParams.get(DECK_START_PARAM) === DECK_START_BUILD;
  // ?resume=save finishes a save a signed-out player started, now that they have signed in.
  const resumeSave = searchParams.get(RESUME_PARAM) === RESUME_SAVE;
  const { source } = useCollectionSource();
  const collectionLoaded = source.kind !== "loading";
  /**
   * The journey as of the latest render. The tool is created first (the journey is built on its analysis) but tells
   * the journey when settings change, so it reaches it through this.
   */
  const journeyRef = useRef<DeckJourney | null>(null);
  const tool = useDeckTool(source, {
    onContextChange: (ctx, change) => journeyRef.current?.reload(ctx, change) ?? Promise.resolve(),
  });
  const lookup = useCommanderLookup(tool.refreshRecommendations);
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
  const resumeStarted = useRef(false);
  /** Until the resumed save settles; shown only once the visitor is known to be signed in. */
  const [resuming, setResuming] = useState(resumeSave);
  /**
   * The deck from the last visit goes back in the box on arrival, and the player is asked whether to carry on with it.
   * Once they answer or wave the question away it stays answered, and the box keeps whatever they chose.
   */
  const [resumeAnswered, setResumeAnswered] = useState(false);
  const signedIn = source.kind === "account" || (source.kind !== "loading" && source.signedIn);
  const { analysis, context } = tool;
  const journey = useDeckJourney({ analysis, round: tool.round, context, lines: tool.lines, cut: tool.cut });
  useEffect(() => {
    journeyRef.current = journey;
  });

  // ── Deck stats (T045) ──────────────────────────────────────────────────────────────────────────────────────────
  /** What a "Find …" action narrowed Add to. It lasts while Add is on screen: leaving the step, or a new round, clears it. */
  const [addFilter, setAddFilter] = useState<AddFilter | null>(null);
  if (addFilter !== null && journey.state?.phase !== "add") setAddFilter(null);
  const deckStats = useDeckStats({
    analysis,
    entries: journey.after,
    bracket: context?.bracket ?? null,
    overBracketIds: journey.overBracketIds,
  });
  const openStep =
    (phase: "cut" | "add", filter: AddFilter | null = null): StatAction["onSelect"] =>
    () => {
      setAddFilter(filter);
      journey.stepper.select(phase);
    };
  /** What an off stat offers: Cut when it's over its target, Add (narrowed to it) when it's short and slots are open. */
  const statAction = (stat: StatLine): StatAction | null => {
    if (stat.ok || !journey.state) return null;
    if (stat.value > Math.round(stat.target)) {
      return journey.stepper.canOpen("cut") ? { label: "Pick cuts", onSelect: openStep("cut") } : null;
    }
    if (journey.openSlots === 0 || !journey.stepper.canOpen("add")) return null;
    if (stat.group === "roles") {
      return {
        label: `Find ${stat.label.toLowerCase()}`,
        onSelect: openStep("add", { kind: "role", roleId: stat.key, label: stat.label }),
      };
    }
    if (stat.key === "lands") return { label: "Find lands", onSelect: openStep("add", { kind: "lands" }) };
    return null;
  };
  const bracketAction: StatAction | null = journey.stepper.canOpen("cut") ? { label: "Pick cuts", onSelect: openStep("cut") } : null;
  const statsPanel = deckStats ? { report: deckStats, cards: journey.cards, actionFor: statAction, bracketAction } : null;

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
      tool.restoreLastDeck();
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
  }, [tool, lookup, collectionLoaded, openCode, commanderSlug]);
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
  // The chip stands for the file only while the box still holds what the file put there: an edit, the sample deck or
  // Clear all make it a plain decklist again.
  const fileInBox = deckFile !== null && deckFile.text === tool.text ? deckFile : null;
  const textHidden = fileInBox !== null && !fileTextShown;

  /** A saved deck's deckbuilder has its own address; the commander segment is decoration, the code finds the deck. */
  const editorUrl = (code: string) => `/decks/${analysis?.commanderKey.commanders[0]?.slug ?? "deck"}/${code}/edit` as Route;

  /**
   * Edit deck: a saved deck opens in its own editor once its last change has been written; an unsaved one edits here.
   * Back to Upgrade: the deckbuilder's waiting edit goes in first, with the cuts Upgrade opens on; without one, the cuts
   * the deckbuilder's edits left waiting are loaded.
   */
  async function changeMode(next: ToolMode) {
    const open = tool.openDeck;
    if (next === "edit" && open) {
      await tool.whenSaved();
      router.push(editorUrl(open.code));
      return;
    }
    if (next === "upgrade" && mode === "edit") {
      const handle = editorHandle.current;
      if (handle?.hasPending()) void handle.flush({ recs: true });
      else tool.ensureCuts();
    }
    setMode(next);
  }
  const cardCount = analysis
    ? analysis.deck.commanders.length +
      analysis.deck.cards.filter((c) => c.section === "main").reduce((n, c) => n + c.quantity, 0)
    : 0;

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
   * Starts a deck from one commander and opens it in the Deckbuilder. It is a new deck, so an open account deck is let
   * go first rather than overwritten, and the cuts wait for Upgrade: a one-card deck has nothing to cut.
   */
  async function buildFrom(commander: CardSummary) {
    editorHandle.current?.discard();
    if (tool.openDeck) tool.closeSavedDeck();
    const text = decklistFor({ commanders: [commander.id], cards: [] }, () => commander.name);
    const outcome = await tool.submit({ text, bracketOverride: null, importedFrom: null }, { recs: false });
    if (!outcome.parsed) return;
    setEditing(false);
    setMode("edit");
    checkLookup(outcome.analysis);
  }

  /**
   * Ends a journey round from Review. Save and Re-analyze put the result in the decklist and analyze it; Start over goes
   * back to the deck the player brought. A new analysis starts a new round at Cut. Save then opens the editor: an open
   * account deck has just been written back by the analysis, and a deck that isn't saved yet gets the name form.
   */
  async function commitJourney(kind: "save" | "reanalyze" | "startOver") {
    const text = kind === "startOver" ? null : journey.resultText();
    if (kind !== "startOver" && text === null) return;
    setCommitting(true);
    const outcome = text === null ? await tool.startOver() : await tool.commitText(text);
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

  return (
    <div className="flex flex-col gap-5">
      {/* The open deck stays named while its decklist is being edited: it is still the deck being worked on. */}
      {tool.openDeck && (
        <OpenDeckBar deck={tool.openDeck} onClose={tool.closeSavedDeck} />
      )}
      {showPicker ? (
        <section aria-labelledby="deck-build-heading" className="flex flex-col gap-4">
          <div>
            <h1 id="deck-build-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight">
              Build a deck
            </h1>
            <p className="mt-2 max-w-prose text-muted-foreground">
              Pick your commander, then add cards in the deckbuilder. Have a list already?{" "}
              <Link href="/deck" className={cn(TEXT_LINK, "font-semibold")}>
                Paste a decklist
              </Link>
              .
            </p>
          </div>
          {tool.parse.status === "loading" ? (
            <ShuffleDeck label="Setting up your deck" />
          ) : (
            <div className="max-w-xl">
              <CommanderPicker autoFocus onPick={(card) => void buildFrom(card)} />
            </div>
          )}
        </section>
      ) : showInput ? (
        <section aria-labelledby="deck-input-heading" className="flex flex-col gap-4">
          <div>
            <h1 id="deck-input-heading" className="font-heading text-2xl leading-none font-semibold tracking-tight">
              Upgrade a deck
            </h1>
            <p className="mt-2 max-w-prose text-muted-foreground">
              Paste your Commander decklist, or a link to a public Archidekt deck, to see cards to cut, cards to add, and
              replacements that do the same job.
            </p>
            {tool.showsRestoredDeck && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Your last decklist is back in the box. Analyze it to pick up where you left off, or clear it to start a new
                one.
              </p>
            )}
            {/* Two ways in: a deck first, or a collection first so suggestions can lean on cards already owned. */}
            {source.kind === "none" && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Building from cards you own?{" "}
                <Link href="/collection/import" className={cn(TEXT_LINK, "font-semibold")}>
                  Import your collection first
                </Link>
                , and suggestions will put your cards ahead of the rest.
              </p>
            )}
            {(source.kind === "browser" || source.kind === "account") && (
              <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                Your collection is loaded: suggestions put cards you own first. Change that under My collection once the deck
                is analyzed.
              </p>
            )}
          </div>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void analyze();
            }}
          >
            <Label htmlFor="decklist" className="sr-only">
              Decklist
            </Label>
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
                note=".csv or .txt from ManaBox, Moxfield, Archidekt or TCGplayer. A CSV is reduced to quantities and card names."
                disabled={tool.parse.status === "loading"}
                onFile={(contents, name) => {
                  const text = decklistFromFile(contents);
                  tool.setText(text);
                  setDeckFile({ name, text });
                  setFileTextShown(false);
                }}
              />
            )}
            {!textHidden && (
              <Textarea
                id="decklist"
                rows={8}
                value={tool.text}
                onChange={(e) => tool.setText(e.target.value)}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={IMPORT_TEXT_BOX}
              />
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="lg" disabled={!tool.text.trim() || tool.parse.status === "loading"}>
                {tool.parse.status === "loading" ? "Reading decklist…" : "Analyze deck"}
              </Button>
              <Button type="button" size="lg" variant="outline" onClick={tool.loadSample}>
                Use sample deck
              </Button>
              {tool.text && (
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={clearAll}
                >
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
        </section>
      ) : null}
      {resuming && signedIn && (
        <p role="status" className="text-sm text-muted-foreground">
          Saving your deck to your new account…
        </p>
      )}
      {openError && (
        <p role="alert" className="text-sm text-destructive">
          {openError}
        </p>
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

      {analysis && context && (
        <section aria-label="Recommendations" className="flex flex-col gap-2">
          <DeckBar
            analysis={analysis}
            context={context}
            deckName={tool.openDeck?.name ?? tool.deckName ?? suggestedDeckName(analysis)}
            onRename={tool.renameDeck}
            cardCount={cardCount}
            onBracketChange={tool.changeBracket}
            collectionMode={tool.collectionMode}
            onCollectionModeChange={tool.changeCollectionMode}
            onEditDecklist={showInput ? undefined : () => void editDecklist()}
            // Saving is asked for, never automatic: a new deck is public. The Deckbuilder saves from the bar; Upgrade
            // saves from its Review step, which brings the player here with the name form open. An open deck already
            // writes back on its own (and edits in its own editor).
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
                />
              ) : undefined
            }
          />
          <CommanderLookupBar lookup={lookup} />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <Segmented
              label="What to do with the deck"
              options={[
                { value: "upgrade", label: "Upgrade" },
                { value: "edit", label: "Deckbuilder" },
              ]}
              value={mode}
              onChange={(next) => void changeMode(next)}
            />
            {/* Phones get the same choice as one icon beside the steps (`ViewToggle`), to save this row's height. */}
            {mode === "upgrade" && journey.state?.phase !== "review" && (
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
          </div>
          {mode === "upgrade" ? (
            journey.state && (
              <div
                className={cn(
                  DECK_STATS_DOCK,
                  "max-lg:pb-[var(--deck-stats-dock)] lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-6",
                )}
              >
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <JourneyStepper phase={journey.state.phase} canOpen={journey.stepper.canOpen} onSelect={journey.stepper.select} />
                    </div>
                    {journey.state.phase !== "review" && <ViewToggle view={view} onChange={changeView} />}
                  </div>
                  {journey.state.phase === "cut" &&
                    (journey.bracketCheck ? (
                      // A bracket change part way through made cards must-cuts: the step's Next becomes a choice.
                      <BracketCheckPanel
                        check={journey.bracketCheck}
                        onCutAndContinue={journey.cutAndContinue}
                        onRevert={() => {
                          const previous = journey.revertCheck();
                          if (previous !== undefined) tool.restoreBracket(previous);
                        }}
                      />
                    ) : (
                      <CutPhase journey={journey} cutState={tool.cut} view={view} deckGroups={deckGroups} />
                    ))}
                  {journey.state.phase === "add" && (
                    <AddPhase journey={journey} view={view} filter={addFilter} onClearFilter={() => setAddFilter(null)} />
                  )}
                  {journey.state.phase === "replace" && (
                    <ReplacePhase journey={journey} view={view} commanderKeyId={analysis.commanderKey.id} />
                  )}
                  {journey.state.phase === "review" && (
                    <ReviewPhase
                      journey={journey}
                      busy={committing}
                      stale={tool.stale}
                      onSave={() => void commitJourney("save")}
                      onReanalyze={() => void commitJourney("reanalyze")}
                      onStartOver={() => void commitJourney("startOver")}
                    />
                  )}
                </div>
                {statsPanel && (
                  <>
                    <DeckStatsRail className="hidden lg:flex" {...statsPanel} />
                    <DeckStatsFooter className="lg:hidden" {...statsPanel} />
                  </>
                )}
              </div>
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
      {tool.restoredDeck && tool.showsRestoredDeck && !resumeAnswered && !analysis && (
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
    </div>
  );
}
