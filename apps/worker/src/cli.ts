import { aggregateCorpus } from './jobs/aggregate-corpus';
import { collate, COLLATE_SOURCES, type CollateSource } from './jobs/collate';
import { evalHoldout } from './jobs/eval-holdout';
import { precompute, PRECOMPUTE_PARTS, type PrecomputePart } from './jobs/precompute';
import { serve } from './jobs/serve';
import { syncCatalog } from './jobs/sync-catalog';
import { syncEdhrec } from './jobs/sync-edhrec';
import { syncSearchIndex } from './jobs/sync-search-index';
import { syncSpellbook } from './jobs/sync-spellbook';
import { syncPrintings } from './jobs/sync-printings';
import { syncTags } from './jobs/sync-tags';
import { downloadBulk, getBulkIndex, type BulkType } from './lib/bulk';

const USAGE = `Usage: yarn workspace @mtg/worker cli <command>

Commands:
  bulk:download [type...]   Download Scryfall bulk files to MTG_DATA_DIR/bulk (default: oracle_cards oracle_tags)
  sync:catalog [--force]    Oracle Cards → cards, name aliases, functional twins (skips if the file is unchanged)
  sync:printings [--force]  All Cards → printings, card stats (staple score), cheapest prices, flavor names (after sync:catalog)
  sync:tags [--force]       Oracle Tags → tags, hierarchy, card taggings (after sync:catalog)
  sync:spellbook [--force]  Commander Spellbook's combo export → spellbook.combos, spellbook.features, as published (skips if the export is unchanged)
  sync:edhrec [--limit N]   EDHREC's commander pages → edhrec.commanders, edhrec.commander_cards, as published (about 3.5 h;
                            --limit fetches only the first N pages, recorded as a trial run the collator ignores)
  collate [--force] [--only source,...]
                            Raw sources → corpus: decks (archidekt, moxfield, user), edhrec, spellbook; only what changed
                            (--force: every source, and the removal gate lets a big drop through)
  sync:typesense [--rebuild]
                            Drain public.search_index_queue into the search index (--rebuild: build every
                            collection from scratch and move the aliases when it is done)
  aggregate:corpus [--force]
                            The full rebuild: the collated corpus.decks → commander and card play-rate stats, then every
                            score (refuses an empty corpus; the worker's precompute passes keep the same tables current)
  precompute [--part name,...] [--full] [--force]
                            The serving tables the recommendations read (T055): commanders (stats and scores of
                            commanders whose decks changed), baseline (the nightly baseline, then every score),
                            scores, substitutes, roles, combos. Default: every part, each only if its inputs moved
                            (--full: rebuild every substitute list and score; --force: past the sanity gates)
  eval:holdout [--candidate file.json] [--time-split [--snapshot-month YYYY-MM]]
                            The offline evaluation (T058): grades adds, cuts and collection mode on held-out decks;
                            with a candidate ({"scoring": ..., "corpus": ...} over today's settings), runs both and
                            applies the gate; --time-split holds out the decks newer than the EDHREC snapshot
                            (for anything EDHREC touches; --snapshot-month pins that month, since every EDHREC
                            fetch moves it). Exits 1 when the gate fails. Report in MTG_DATA_DIR/reports; reads only
  serve [--once]            The VPS worker: deck lookups, then the daily crawl, collation, stats rebuilds and EDHREC
                            fetches as app_config.worker schedules them (--once: one pass, no EDHREC fetch)`;

/** The value after a flag, as in `--limit 30`. */
const flagValue = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const force = args.includes('--force');

  switch (command) {
    case 'bulk:download': {
      const types = (args.length > 0 ? args : ['oracle_cards', 'oracle_tags']) as BulkType[];
      const index = await getBulkIndex();
      for (const type of types) {
        const entry = index.find((e) => e.type === type);
        if (!entry) throw new Error(`Unknown bulk type "${type}". Available: ${index.map((e) => e.type).join(', ')}`);
        await downloadBulk(entry);
      }
      return;
    }
    case 'sync:catalog':
      return syncCatalog({ force });
    case 'sync:printings':
      return syncPrintings({ force });
    case 'sync:tags':
      return syncTags({ force });
    case 'sync:spellbook':
      await syncSpellbook({ force });
      return;
    case 'sync:edhrec': {
      const limitArg = flagValue(args, '--limit');
      const limit = limitArg === undefined ? undefined : Number(limitArg);
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error('--limit needs a whole number of pages');
      await syncEdhrec(limit === undefined ? {} : { limit });
      return;
    }
    case 'collate': {
      const only = flagValue(args, '--only')?.split(',');
      const unknown = only?.filter((s) => !(COLLATE_SOURCES as readonly string[]).includes(s)) ?? [];
      if (unknown.length > 0) throw new Error(`Unknown source ${unknown.join(', ')}. Sources: ${COLLATE_SOURCES.join(', ')}`);
      await collate({ force, ...(only ? { only: only as CollateSource[] } : {}) });
      return;
    }
    case 'precompute': {
      const parts = flagValue(args, '--part')?.split(',');
      const unknown = parts?.filter((p) => !(PRECOMPUTE_PARTS as readonly string[]).includes(p)) ?? [];
      if (unknown.length > 0) throw new Error(`Unknown part ${unknown.join(', ')}. Parts: ${PRECOMPUTE_PARTS.join(', ')}`);
      await precompute({ full: args.includes('--full'), force, ...(parts ? { parts: parts as PrecomputePart[] } : {}) });
      return;
    }
    case 'eval:holdout': {
      const candidatePath = flagValue(args, '--candidate');
      const snapshotMonth = flagValue(args, '--snapshot-month');
      await evalHoldout({
        ...(candidatePath ? { candidatePath } : {}),
        ...(snapshotMonth ? { snapshotMonth } : {}),
        timeSplit: args.includes('--time-split'),
      });
      return;
    }
    case 'serve':
      await serve({ once: args.includes('--once') });
      return;
    case 'sync:typesense':
      return syncSearchIndex({ rebuild: args.includes('--rebuild') });
    case 'aggregate:corpus': {
      await aggregateCorpus({ force });
      return;
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
