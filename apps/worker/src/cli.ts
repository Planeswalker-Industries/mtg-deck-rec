import { aggregateCorpus } from './jobs/aggregate-corpus';
import { measureCorpusStability } from './jobs/corpus-stability';
import { profileTags } from './jobs/profile-tags';
import { evaluateEdhrecPrior } from './jobs/edhrec-prior-eval';
import { importDecks } from './jobs/import-decks';
import { serveWorker } from './jobs/serve';
import { syncCatalog } from './jobs/sync-catalog';
import { syncCombos } from './jobs/sync-combos';
import { syncEdhrec } from './jobs/sync-edhrec';
import { syncSearchIndex } from './jobs/sync-search-index';
import { syncPrintings } from './jobs/sync-printings';
import { syncTags } from './jobs/sync-tags';
import { downloadBulk, getBulkIndex, type BulkType } from './lib/bulk';

const USAGE = `Usage: yarn workspace @mtg/worker cli <command>

Commands:
  bulk:download [type...]   Download Scryfall bulk files to MTG_DATA_DIR/bulk (default: oracle_cards oracle_tags)
  profile:tags              Profile Oracle Tags against Oracle Cards (Phase 0 tag spike)
  sync:catalog [--force]    Oracle Cards → cards, name aliases, functional twins (skips if the file is unchanged)
  sync:printings [--force]  All Cards → printings, card stats (staple score), cheapest prices, flavor names (after sync:catalog)
  sync:tags [--force]       Oracle Tags → tags, hierarchy, card taggings (after sync:catalog)
  sync:combos [--force]     Commander Spellbook's combo export → combos, combo results (after sync:catalog; skips if the export is unchanged)
  sync:typesense [--rebuild]
                            Drain public.search_index_queue into the search index (--rebuild: build every
                            collection from scratch and move the aliases when it is done)
  aggregate:corpus [--force]
                            corpus.decks → commander and card play-rate stats (skips while corpus.decks is unchanged)
  sync:edhrec [--force] [--limit N]
                            EDHREC's commander pages (sitemap, then one page per 1.5 s) → external commander and card stats
                            (--limit: only the first N pages, for a local check; pair it with --force past the sanity gate)
  import:decks --file path  One-time move of a slim-deck JSONL file into corpus.decks (then aggregate:corpus)
  serve [--once]            The VPS worker: deck lookups, the daily crawl trigger, corpus rebuilds and EDHREC refreshes on
                            the app_config.worker schedule (--once: one pass)
  spike:corpus:stability [--repeats N]
                            How many decks a commander needs for stable card rankings (split-half resampling report)
  spike:edhrec:prior [--repeats N]
                            Holdout test: does EDHREC beat the colour baseline as the prior for commanders with few decks?`;

/** Reads `--name N` as a positive whole number, or undefined when the flag is absent. */
function numberFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`--${name} needs a positive whole number`);
  return value;
}

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
    case 'profile:tags':
      return profileTags();
    case 'sync:catalog':
      return syncCatalog({ force });
    case 'sync:printings':
      return syncPrintings({ force });
    case 'sync:tags':
      return syncTags({ force });
    case 'sync:combos':
      await syncCombos({ force });
      return;
    case 'sync:typesense':
      return syncSearchIndex({ rebuild: args.includes('--rebuild') });
    case 'aggregate:corpus':
      await aggregateCorpus({ force });
      return;
    case 'sync:edhrec':
      await syncEdhrec({ force, limit: numberFlag(args, 'limit') });
      return;
    case 'import:decks': {
      const file = args[args.indexOf('--file') + 1];
      if (!args.includes('--file') || !file) throw new Error('import:decks needs --file <path to a slim-deck JSONL file>');
      return importDecks({ file });
    }
    case 'serve':
      return serveWorker({ once: args.includes('--once') });
    case 'spike:corpus:stability':
      return measureCorpusStability({ repeats: numberFlag(args, 'repeats') });
    case 'spike:edhrec:prior':
      return evaluateEdhrecPrior({ repeats: numberFlag(args, 'repeats') });
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
