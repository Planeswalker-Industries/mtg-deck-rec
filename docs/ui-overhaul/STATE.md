# UI overhaul state

Current UI overhaul status and next action. Tasks and gates: [`tasks/phase-a.md`](tasks/phase-a.md) … [`tasks/phase-f.md`](tasks/phase-f.md). Only the lead edits this file.

## Next action

1. **Phase B:** implement a UI-021 correction batch for the reproduced stale-sync replacement race and hidden account inventory during pending/failed sync; evidence/repro in `tasks/phase-b.md` (2026-10-10).
2. Coordinate browser sync with explicit imports across tabs; keep failures recoverable and summary/return inventory truthful. No schema/contract change without owner approval.
3. Make the retained account regression pass without weakening inventory assertions; add pending/failure coverage, verify returned deck quantities/reload and actual saved-deck originating links (UI-022).
4. UI-020 is done; UI-021 blocked; UI-022 review; UI-023/024 draft. Current `.next` is real-data. Recheck screenshots after corrections; no phase gate, account-deletion tests, hosted operations or commits.

## Status

| Task | Phase | Status | Depends on |
|---|---|---|---|
| UI-001 Save never changes the collection | A | done | — |
| UI-002 Swap says why it's empty | A | done | — |
| UI-003 Honest cut and swap reasons | A | done | — |
| ARCH-001 Whole-deck coverage | A | done | — |
| UI-010 Coverage function | A | done | ARCH-001 |
| UI-013 Coverage API | A | done | UI-010 |
| UI-011 Coverage in the deck tool | A | done | UI-010, UI-013 |
| UI-012 Mark a deck built | A | done | — |
| UI-020 Start a collection by hand | B | done | — |
| UI-021 Add to or replace | B | blocked | SQL passed; reproduced browser-sync race and hidden account inventory |
| UI-022 Return after import | B | review | after UI-021 (same file) |
| UI-023 Export instructions | B | draft | Q-05 |
| UI-024 Fix unmatched lines | B | draft | UI-021 |
| UI-030 Buy list in Add | C | ready | — |
| UI-031 Buy list in Swap | C | draft | UI-002, UI-030 |
| UI-032 Owned only by default | C | draft | UI-030, UI-031 |
| ARCH-002 Every unowned card handled | C | draft | — |
| UI-040 Pick an owned commander | D | ready | — |
| ARCH-003 Build screen and choices | D | draft | — |
| UI-041 – UI-045 | D | draft | ARCH-002, ARCH-003 |
| UI-050 Copy and download from Done | E | ready | — |
| UI-051 – UI-053 | E | draft | UI-010, ARCH-002 |
| UI-060 Collection in the nav | F | ready | — |
| UI-061 Honest homepage | F | ready | — |
| UI-062 Swipe button labels | F | ready | — |
| UI-063 Deck stats wording | F | ready | — |
| UI-064 Re-record How it works | F | draft | phases C–E |
| UI-090 Visibility transport failure rollback | F (follow-up) | draft | after A |

## Phases

| Phase | Status |
|---|---|
| A | gate passed 2026-10-10 (evidence: `tasks/phase-a.md`, "Gate evidence"); colour-icon overlap accepted |
| B | in progress — UI-020 done; visual/account verification 2026-10-10 found UI-021 sync blockers (2 account tests pass, 1 regression fails); no gate run |
| C | not started |
| D | not started |
| E | not started |
| F | not started |

## Notes

- Owner recalled the push (2026-10-10): deleted remote `feat/ui-overhaul-phase-a` (was `23d6826`) and verified it is absent. The entire agent pipeline is local-only: configurations, commands, prompts, orchestration scripts and workflow playbook are ignored and untracked, with local copies preserved. Shared rules, UI requirements and evidence remain tracked; phase checks now document direct commands. Owner subsequently requested committing and pushing this cleanup. Push is held pending explicit approval to clean the earlier branch history, which still contains the pipeline; do not repush it as-is. Remote branch deletion does not guarantee published objects are erased. Documentation/tracking checks passed; no runtime tests or PR.
- Phase A completion commit: `fix(ui-overhaul): complete Phase A inventory truth gate` (owner requested 2026-10-10). Phase B's SQL prerequisite was approved for implementation/local checks and commit (owner: "yes and commit", 2026-10-10). Owner subsequently requested the Phase B UI/test/evidence checkpoint commit (2026-10-10), retaining the known failing sync regression; unrelated agent-workflow tooling remains uncommitted. No phase B gate run yet.
- Owner clarification (2026-10-10): coverage text overlapping colour icons is acceptable because it is not the focus. That overlap is not a gate blocker or required fix. The separate error/Retry collision with the collection selector was corrected and verified in the third gate attempt.
- Contract v27 (UI-013) still needs approval from both frontend and backend before a release PR.
- Per-task history (files, checks, review notes) before the restructure: `git show 97c884a:docs/ui-overhaul/PROGRESS.md`.
