import type { CardSummary } from './cards';
import type { IsoDateTime } from './ids';

/**
 * Commander deck lookups: when a commander has too few decks in our data, a visitor can ask us to collect some. Lookups
 * run one at a time in a shared queue, and two visitors asking for the same commander share one.
 */
export type CommanderRequestStatus =
  | 'queued'
  | 'checking'
  | 'collecting'
  | 'aggregating'
  | 'done'
  | 'not_enough_decks'
  | 'failed';

export interface CommanderRequest {
  /** bigint as string */
  id: string;
  commander: CardSummary;
  status: CommanderRequestStatus;
  /** 100-card decks the source lists for the commander; 1000 means 1,000 or more. Null until checked. */
  decksListed: number | null;
  decksCollected: number;
  decksTarget: number;
  /** Lookups ahead of this one, including the one running; 0 once this one runs. */
  queuePosition: number;
  /** Estimated seconds until this lookup is done; null once it has finished. */
  etaSeconds: number | null;
  /** True for a visitor who didn't start the lookup: someone else asked for the same commander first. */
  joined: boolean;
  /** False when the deck collector isn't running, so a queued lookup won't move yet. */
  collectorOnline: boolean;
  error: string | null;
  updatedAt: IsoDateTime;
}

/** What we know about deck data for a commander before asking the visitor to wait for a lookup. */
export interface CommanderCoverage {
  /** The active lookup for the commander, or a recent one whose result still stands; null when there's none. */
  request: CommanderRequest | null;
  /** Seconds a new lookup would take, including the queue ahead of it. */
  estimatedSeconds: number;
  collectorOnline: boolean;
}
