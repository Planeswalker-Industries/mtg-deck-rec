import { profileTags } from './jobs/profile-tags';
import { syncCatalog } from './jobs/sync-catalog';
import { syncTags } from './jobs/sync-tags';
import { downloadBulk, getBulkIndex, type BulkType } from './lib/bulk';

const USAGE = `Usage: yarn workspace @mtg/worker cli <command>

Commands:
  bulk:download [type...]   Download Scryfall bulk files to MTG_DATA_DIR/bulk (default: oracle_cards oracle_tags)
  profile:tags              Profile Oracle Tags against Oracle Cards (Phase 0 tag spike)
  sync:catalog [--force]    Oracle Cards → cards and card_names (skips if Scryfall's file hasn't changed)
  sync:tags [--force]       Oracle Tags → tags, hierarchy, card taggings (run sync:catalog first)`;

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
    case 'sync:tags':
      return syncTags({ force });
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
