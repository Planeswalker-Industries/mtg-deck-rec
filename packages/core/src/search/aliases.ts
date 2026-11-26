/**
 * What the worker does about each collection name before a drain, decided without touching the index.
 *
 * After a --rebuild every real collection is versioned (`cards_1789…`, the suffix is `Date.now()`) and the plain name
 * is an alias. A Typesense restart that replays its Raft log has been seen to bring every collection back but not an
 * alias, and creating a plain collection under the freed name would serve an empty index. So a missing name is aliased
 * to a version when one exists, and created plain only when none does (a true first run).
 */

const VERSION_SUFFIX = /^\d+$/;

export interface CollectionInfo {
  name: string;
  numDocuments: number;
}

export type CollectionStep =
  | { name: string; kind: 'present' }
  /** `leftovers` are the other versions: left in place (the next --rebuild drops them), only reported. */
  | { name: string; kind: 'alias'; target: string; documents: number; leftovers: CollectionInfo[] }
  | { name: string; kind: 'create' };

/**
 * True when `collection` is a version of `name`: the name, an underscore, then digits only. Compared as strings, never
 * as a pattern built from the name, so `cards_extra_123` and `commander_cards_123` are not versions of `cards`.
 */
export function isCollectionVersion(name: string, collection: string): boolean {
  const prefix = `${name}_`;
  return collection.startsWith(prefix) && VERSION_SUFFIX.test(collection.slice(prefix.length));
}

const suffix = (name: string, collection: string): number => Number(collection.slice(name.length + 1));

/**
 * One step per name. A name is present when its alias resolves or a plain collection holds it. Otherwise the version
 * with the most documents is picked, ties going to the newest suffix: a rebuild that crashed part way leaves a newer,
 * smaller copy, and the complete older one is the better index to serve.
 */
export function planCollections(
  names: readonly string[],
  collections: readonly CollectionInfo[],
  aliases: Readonly<Record<string, string | null | undefined>>,
): CollectionStep[] {
  const plain = new Set(collections.map((c) => c.name));
  return names.map((name): CollectionStep => {
    if (aliases[name] || plain.has(name)) return { name, kind: 'present' };
    const versions = collections
      .filter((c) => isCollectionVersion(name, c.name))
      .sort((a, b) => b.numDocuments - a.numDocuments || suffix(name, b.name) - suffix(name, a.name));
    const [pick, ...leftovers] = versions;
    if (!pick) return { name, kind: 'create' };
    return { name, kind: 'alias', target: pick.name, documents: pick.numDocuments, leftovers };
  });
}
