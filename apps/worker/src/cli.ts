import { aggregateCorpus } from './jobs/aggregate-corpus';
import { syncCatalog } from './jobs/sync-catalog';
import { syncSearchIndex } from './jobs/sync-search-index';
import { syncPrintings } from './jobs/sync-printings';
import { syncTags } from './jobs/sync-tags';
import { downloadBulk, getBulkIndex, type BulkType } from './lib/bulk';

const USAGE = `Usage: yarn workspace @mtg/worker cli <command>

Commands:
  bulk:download [type...]   Download Scryfall bulk files to MTG_DATA_DIR/bulk (default: oracle_cards oracle_tags)
  sync:catalog [--force]    Oracle Cards → cards, name aliases, functional twins (skips if the file is unchanged)
  sync:printings [--force]  All Cards → printings, card stats (staple score), cheapest prices, flavor names (after sync:catalog)
  sync:tags [--force]       Oracle Tags → tags, hierarchy, card taggings (after sync:catalog)
  sync:typesense [--rebuild]
                            Drain public.search_index_queue into the search index (--rebuild: build every
                            collection from scratch and move the aliases when it is done)
  aggregate:corpus [--force]
                            The collated corpus.decks → commander and card play-rate stats (refuses an empty corpus)`;

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
