import { aggregateCorpus } from './jobs/aggregate-corpus';
import { measureCorpusStability } from './jobs/corpus-stability';
import { profileTags } from './jobs/profile-tags';
import { crawlCommanders, isCrawlOrder, rankCommanders, verifyCommanders } from './jobs/spike-archidekt';
import { syncCatalog } from './jobs/sync-catalog';
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
  aggregate:corpus [--file path] [--force]
                            Deck corpus (JSONL of slim decks; default: the Archidekt spike) → commander and card play-rate stats
  spike:corpus:stability [--repeats N]
                            How many decks a commander needs for stable card rankings (split-half resampling report)
  spike:archidekt:rank      Rank our legal commanders by how often their 100-card Archidekt decks are updated (1 request each, resumable)
  spike:archidekt:verify [--top N]
                            Discount the top ranked commanders by how many of their listed decks they actually lead
  spike:archidekt:crawl [--commanders N] [--per-commander N] [--order views|updated]
                            Collect qualifying decks for the top ranked commanders at 1 request/second (resumable)`;

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
    case 'aggregate:corpus': {
      const fileIndex = args.indexOf('--file');
      return aggregateCorpus({ file: fileIndex === -1 ? undefined : args[fileIndex + 1], force });
    }
    case 'spike:corpus:stability':
      return measureCorpusStability({ repeats: numberFlag(args, 'repeats') });
    case 'spike:archidekt:rank':
      return rankCommanders();
    case 'spike:archidekt:verify':
      return verifyCommanders({ top: numberFlag(args, 'top') });
    case 'spike:archidekt:crawl': {
      const orderIndex = args.indexOf('--order');
      const order = orderIndex === -1 ? undefined : args[orderIndex + 1];
      if (order !== undefined && !isCrawlOrder(order)) throw new Error('--order must be views or updated');
      return crawlCommanders({
        commanders: numberFlag(args, 'commanders'),
        perCommander: numberFlag(args, 'per-commander'),
        order,
      });
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
