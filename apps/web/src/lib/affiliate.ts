// Impact (TCGplayer's affiliate network) universal tracking tag. The account's tag id comes from the environment so
// the public repo carries none, and each deploy can turn it on or off. The root layout renders the result in <head>.
const IMPACT_TAG_ID_PATTERN = /^A[0-9a-f-]+$/i;
const IMPACT_CDN = "https://utt.impactcdn.com";

/**
 * Impact's loader, verbatim apart from the script URL; `transformLinks` rewrites TCGplayer links into affiliate links.
 * Null when NEXT_PUBLIC_IMPACT_TAG_ID is unset or malformed: the id lands inside an inline script, so anything but the
 * expected shape is refused rather than escaped.
 */
export function impactLoaderScript(): string | null {
  const tagId = process.env.NEXT_PUBLIC_IMPACT_TAG_ID?.trim();
  if (!tagId || !IMPACT_TAG_ID_PATTERN.test(tagId)) return null;
  const src = JSON.stringify(`${IMPACT_CDN}/P-${tagId}.js`);
  return `(function(i,m,p,a,c,t){c.ire_o=p;c[p]=c[p]||function(){(c[p].a=c[p].a||[]).push(arguments)};t=a.createElement(m);var z=a.getElementsByTagName(m)[0];t.async=1;t.src=i;z.parentNode.insertBefore(t,z)})(${src},'script','impactStat',document,window);impactStat('transformLinks');impactStat('trackImpression');`;
}
