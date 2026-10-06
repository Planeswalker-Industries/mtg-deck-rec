import { connect } from '../lib/db';
import { precomputeBaseline, precomputeCommanders } from './precompute-commanders';
import { precomputeScores, scoreSettingsChanged } from './precompute-scores';
import { precomputeSubstitutes } from './precompute-substitutes';
import { precomputeCombos, precomputeRoles } from './precompute-tables';

/** The precompute worker's parts (T055), in the order a run takes them. */
export const PRECOMPUTE_PARTS = ['commanders', 'baseline', 'scores', 'substitutes', 'roles', 'combos'] as const;
export type PrecomputePart = (typeof PRECOMPUTE_PARTS)[number];

/** What runs when no part is named: everything that skips itself while its inputs haven't moved. */
const SELF_SKIPPING: readonly PrecomputePart[] = ['commanders', 'scores', 'substitutes', 'roles', 'combos'];

/**
 * `cli precompute`. Without `--part`, the parts that skip themselves when their inputs haven't moved: the commanders
 * queued as dirty, scores if app_config.corpus changed, substitutes that are due, roles and combo pieces if their
 * inputs moved. `full` adds the nightly baseline and rebuilds every score, substitute list, role and combo piece.
 */
export async function precompute({
  parts,
  full = false,
  force = false,
}: { parts?: PrecomputePart[]; full?: boolean; force?: boolean } = {}): Promise<void> {
  const sql = connect();
  const wanted = parts ?? (full ? [...PRECOMPUTE_PARTS] : [...SELF_SKIPPING]);
  try {
    for (const part of PRECOMPUTE_PARTS) {
      if (!wanted.includes(part)) continue;
      switch (part) {
        case 'commanders':
          // A pass takes a bounded number of commanders; by hand, empty the queue.
          while ((await precomputeCommanders(sql)).commanders > 0);
          break;
        case 'baseline':
          // The baseline ends with every score, so a separate scores part would only repeat it.
          if ((await precomputeBaseline(sql, { force })) === 'failed_sanity') return;
          break;
        case 'scores':
          if (wanted.includes('baseline')) break;
          if (parts?.includes('scores') || full || (await scoreSettingsChanged(sql))) await precomputeScores({ sql, force });
          break;
        case 'substitutes':
          await precomputeSubstitutes(sql, { full, force });
          break;
        case 'roles':
          await precomputeRoles(sql, { force: force || full });
          break;
        case 'combos':
          await precomputeCombos(sql, { force: force || full });
          break;
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
