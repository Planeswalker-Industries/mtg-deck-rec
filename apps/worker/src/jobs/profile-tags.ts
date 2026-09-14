import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { latestBulkFile, type BulkType } from '../lib/bulk';
import { REPORTS_DIR } from '../lib/config';
import { readJsonl, type JsonlStats } from '../lib/jsonl';

/**
 * Phase 0 tag spike, no database: profiles the Oracle Tags file against Oracle Cards to check the
 * assumptions the recommendation engine depends on (weights, hierarchy shape, direct-only taggings, coverage).
 */

interface RawTagging {
  oracle_id?: string;
  weight?: unknown;
  [key: string]: unknown;
}

interface RawTag {
  id: string;
  type?: string;
  slug?: string;
  label?: string;
  name?: string;
  parent_ids?: string[];
  child_ids?: string[];
  taggings?: RawTagging[];
  [key: string]: unknown;
}

interface RawCard {
  oracle_id?: string;
  name: string;
  type_line?: string;
  released_at?: string;
  legalities?: Record<string, string>;
  card_faces?: { oracle_id?: string; type_line?: string }[];
}

interface SlimTag {
  id: string;
  label: string;
  parents: string[];
  children: string[];
  direct: number;
}

const RECENT_DAYS = 180;

const bump = (m: Map<string, number>, key: string, by = 1) => m.set(key, (m.get(key) ?? 0) + by);
const top = (m: Map<string, number>, n: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
const pct = (part: number, whole: number) => (whole === 0 ? 'n/a' : `${((part / whole) * 100).toFixed(1)}%`);
const quantile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] ?? NaN;

async function requireBulk(type: BulkType): Promise<string> {
  const file = await latestBulkFile(type);
  if (!file) throw new Error(`No ${type} file downloaded yet. Run: yarn workspace @mtg/worker cli bulk:download ${type}`);
  return file;
}

export async function profileTags(): Promise<void> {
  const tagsFile = await requireBulk('oracle_tags');
  const cardsFile = await requireBulk('oracle_cards');

  // --- Pass 1: tags ---
  const tagStats: JsonlStats = { lines: 0, parseErrors: 0 };
  const tags = new Map<string, SlimTag>();
  const tagKeys = new Map<string, number>();
  const taggingKeys = new Map<string, number>();
  const tagTypes = new Map<string, number>();
  const weightTypes = new Map<string, number>();
  const stringWeights = new Map<string, number>();
  const numericWeights: number[] = [];
  const taggedOracleIds = new Set<string>();
  let taggings = 0;
  let taggingsWithoutOracleId = 0;

  for await (const tag of readJsonl<RawTag>(tagsFile, tagStats)) {
    for (const key of Object.keys(tag)) bump(tagKeys, key);
    bump(tagTypes, String(tag.type ?? '(missing)'));
    const list = Array.isArray(tag.taggings) ? tag.taggings : [];
    for (const t of list) {
      taggings++;
      for (const key of Object.keys(t)) bump(taggingKeys, key);
      const weightType = t.weight === null ? 'null' : typeof t.weight;
      bump(weightTypes, weightType);
      if (typeof t.weight === 'number') numericWeights.push(t.weight);
      else if (typeof t.weight === 'string') bump(stringWeights, t.weight);
      if (typeof t.oracle_id === 'string') taggedOracleIds.add(t.oracle_id);
      else taggingsWithoutOracleId++;
    }
    tags.set(tag.id, {
      id: tag.id,
      label: tag.label ?? tag.name ?? tag.slug ?? tag.id,
      parents: tag.parent_ids ?? [],
      children: tag.child_ids ?? [],
      direct: list.length,
    });
  }

  // --- Hierarchy ---
  let danglingRefs = 0;
  let asymmetricEdges = 0;
  for (const t of tags.values()) {
    for (const p of t.parents) {
      const parent = tags.get(p);
      if (!parent) danglingRefs++;
      else if (!parent.children.includes(t.id)) asymmetricEdges++;
    }
    for (const c of t.children) if (!tags.has(c)) danglingRefs++;
  }
  const roots = [...tags.values()].filter((t) => t.parents.length === 0);
  const parentsWithDirectTaggings = [...tags.values()].filter((t) => t.children.length > 0 && t.direct > 0);

  const height = new Map<string, number>();
  const visiting = new Set<string>();
  let cycleEdges = 0;
  const heightOf = (id: string): number => {
    const known = height.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) {
      cycleEdges++;
      return 0;
    }
    visiting.add(id);
    let h = 1;
    for (const c of tags.get(id)?.children ?? []) if (tags.has(c)) h = Math.max(h, 1 + heightOf(c));
    visiting.delete(id);
    height.set(id, h);
    return h;
  };
  const maxDepth = roots.reduce((m, r) => Math.max(m, heightOf(r.id)), 0);
  const unreachable = [...tags.keys()].filter((id) => !height.has(id)).length;

  // --- Pass 2: coverage over Commander-legal non-land cards ---
  const cardStats: JsonlStats = { lines: 0, parseErrors: 0 };
  const recentCutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  let eligible = 0;
  let eligibleTagged = 0;
  let recent = 0;
  let recentTagged = 0;
  const untaggedRecent: { name: string; released: string }[] = [];

  for await (const card of readJsonl<RawCard>(cardsFile, cardStats)) {
    if (card.legalities?.commander !== 'legal') continue;
    const frontType = card.card_faces?.[0]?.type_line ?? card.type_line ?? '';
    if (/\bLand\b/.test(frontType)) continue;
    const oracleId = card.oracle_id ?? card.card_faces?.[0]?.oracle_id;
    const tagged = oracleId !== undefined && taggedOracleIds.has(oracleId);
    eligible++;
    if (tagged) eligibleTagged++;
    if ((card.released_at ?? '') >= recentCutoff) {
      recent++;
      if (tagged) recentTagged++;
      else untaggedRecent.push({ name: card.name, released: card.released_at ?? '' });
    }
  }
  untaggedRecent.sort((a, b) => b.released.localeCompare(a.released));

  // --- Report ---
  numericWeights.sort((a, b) => a - b);
  const directByTag = new Map([...tags.values()].map((t) => [t.label, t.direct]));
  const lines = [
    `# Oracle Tags profile`,
    ``,
    `- Tags file: \`${path.basename(tagsFile)}\` (${tagStats.lines} lines, ${tagStats.parseErrors} parse errors)`,
    `- Cards file: \`${path.basename(cardsFile)}\` (${cardStats.lines} lines, ${cardStats.parseErrors} parse errors)`,
    `- Generated: ${new Date().toISOString()}`,
    ``,
    `## Shape`,
    `- Tags: ${tags.size}; types: ${top(tagTypes, 10).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    `- Tag fields: ${top(tagKeys, 30).map(([k, v]) => `${k}(${v})`).join(', ')}`,
    `- Tagging fields: ${top(taggingKeys, 30).map(([k, v]) => `${k}(${v})`).join(', ')}`,
    `- Taggings: ${taggings}; without oracle_id: ${taggingsWithoutOracleId}; distinct oracle_ids: ${taggedOracleIds.size}`,
    ``,
    `## Weight`,
    `- Value types: ${top(weightTypes, 10).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    numericWeights.length > 0
      ? `- Numeric: min ${numericWeights[0]}, p10 ${quantile(numericWeights, 0.1)}, median ${quantile(numericWeights, 0.5)}, p90 ${quantile(numericWeights, 0.9)}, max ${numericWeights.at(-1)}`
      : `- Numeric: none`,
    stringWeights.size > 0 ? `- String values: ${top(stringWeights, 20).map(([k, v]) => `"${k}"=${v}`).join(', ')}` : `- String values: none`,
    ``,
    `## Hierarchy`,
    `- Roots: ${roots.length}; max depth: ${maxDepth}; cycle edges: ${cycleEdges}; unreachable from roots: ${unreachable}`,
    `- Dangling parent/child refs: ${danglingRefs}; parent edges not mirrored in child_ids: ${asymmetricEdges}`,
    `- Parent tags that also have direct taggings: ${parentsWithDirectTaggings.length}` +
      (parentsWithDirectTaggings.length > 0
        ? ` (e.g. ${parentsWithDirectTaggings.slice(0, 8).map((t) => `${t.label}=${t.direct}`).join(', ')})`
        : ' (matches "parents have no direct taggings")'),
    ``,
    `## Coverage (Commander-legal, non-land, one row per oracle card)`,
    `- Tagged: ${eligibleTagged} of ${eligible} (${pct(eligibleTagged, eligible)})`,
    `- Released in the last ${RECENT_DAYS} days: ${recentTagged} of ${recent} tagged (${pct(recentTagged, recent)})`,
    `- Newest untagged: ${untaggedRecent.slice(0, 15).map((c) => `${c.name} (${c.released})`).join('; ') || 'none'}`,
    ``,
    `## Most direct taggings`,
    ...top(directByTag, 20).map(([label, n]) => `- ${label}: ${n}`),
    ``,
  ];

  const report = lines.join('\n');
  await mkdir(REPORTS_DIR, { recursive: true });
  const reportPath = path.join(REPORTS_DIR, `tag-profile-${new Date().toISOString().slice(0, 10)}.md`);
  await writeFile(reportPath, report);
  console.log(report);
  console.log(`Report written to ${reportPath}`);
}
