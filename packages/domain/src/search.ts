import { pinyin } from 'pinyin-pro';

interface Spelling {
  text: string[];
  initials: string[];
  syllables: string[];
  full: string;
}

function syllablesOf(text: string) {
  const syllables = pinyin(text, { toneType: 'none', type: 'array', v: true });
  return { syllables, full: syllables.join('') };
}

function spell(text: string): Spelling {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return {
    text: Array.from(normalized),
    initials: pinyin(normalized, { pattern: 'first', toneType: 'none', type: 'array', v: true }),
    ...syllablesOf(normalized),
  };
}

function indexOf(haystack: readonly string[], needle: readonly string[]) {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((c, k) => haystack[i + k] === c)) return i;
  }
  return -1;
}

// Where the earliest run of the needle's characters, in order but with gaps allowed, begins.
function subsequenceStart(haystack: readonly string[], needle: readonly string[]) {
  let start = -1;
  let k = 0;
  for (let i = 0; i < haystack.length && k < needle.length; i++) {
    if (haystack[i] !== needle[k]) continue;
    if (k === 0) start = i;
    k++;
  }
  return k === needle.length ? start : -1;
}

// The fewest insertions, deletions, substitutions and adjacent swaps that turn the query into
// some stretch of the text, so a typo anywhere in a longer name still counts as a close match.
function editsToStretch(text: readonly string[], query: readonly string[]) {
  let before: number[] = [];
  let previous = new Array<number>(text.length + 1).fill(0);
  for (let i = 1; i <= query.length; i++) {
    const current = [i];
    for (let j = 1; j <= text.length; j++) {
      let edits = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (query[i - 1] === text[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && query[i - 1] === text[j - 2] && query[i - 2] === text[j - 1]) {
        edits = Math.min(edits, before[j - 2]! + 1);
      }
      current[j] = edits;
    }
    before = previous;
    previous = current;
  }
  return Math.min(...previous);
}

// The first syllable from which the name's pinyin reads as the query, so 「a」 finds 安 but not the
// 「a」 inside 「mao」.
function syllableStart(syllables: readonly string[], query: string) {
  let rest = syllables.join('');
  for (let i = 0; i < syllables.length; i++) {
    if (rest.startsWith(query)) return i;
    rest = rest.slice(syllables[i]!.length);
  }
  return -1;
}

const han = /\p{Script=Han}/u;

// A Han character carries more of a name than a Latin letter, so Han text tolerates a typo sooner;
// short Latin queries tolerate none, since a one-letter slip would match half the catalog.
function typosAllowed(query: readonly string[]) {
  return Math.floor(query.length / (query.some((c) => han.test(c)) ? 3 : 5));
}

// Lower tiers are better matches; within a tier, the lower distance (offset or edits) wins.
function rank(name: Spelling, query: Spelling): { tier: number; distance: number } | null {
  const at = indexOf(name.text, query.text);
  if (at === 0) return { tier: name.text.length === query.text.length ? 0 : 1, distance: 0 };
  if (at > 0) return { tier: 2, distance: at };

  const tiers: [number, () => number][] = [
    [3, () => indexOf(name.initials, query.text)],
    [4, () => syllableStart(name.syllables, query.full)],
    [5, () => subsequenceStart(name.text, query.text)],
    [6, () => subsequenceStart(name.initials, query.text)],
  ];
  for (const [tier, offset] of tiers) {
    const offsetAt = offset();
    if (offsetAt !== -1) return { tier, distance: offsetAt };
  }

  const fullQuery = Array.from(query.full);
  const typos = [
    [editsToStretch(name.text, query.text), typosAllowed(query.text)],
    [editsToStretch(Array.from(name.full), fullQuery), typosAllowed(fullQuery)],
  ]
    .filter(([edits, allowed]) => allowed! > 0 && edits! <= allowed!)
    .map(([edits]) => edits!);
  return typos.length > 0 ? { tier: 7, distance: Math.min(...typos) } : null;
}

const collator = new Intl.Collator('zh-Hans-CN');

// Matches names by Chinese text, pinyin initials (「dbcz」 for 「得宝抽纸」), full pinyin, and
// near misses such as homophones, a wrong or swapped character; best match first.
export function searchByName<T extends { name: string }>(items: readonly T[], query: string): T[] {
  const q = spell(query);
  if (q.text.length === 0) return [];
  return items
    .map((item) => {
      const name = spell(item.name);
      return { item, length: name.text.length, match: rank(name, q) };
    })
    .filter((entry) => entry.match !== null)
    .sort(
      (a, b) =>
        a.match!.tier - b.match!.tier ||
        a.match!.distance - b.match!.distance ||
        a.length - b.length ||
        collator.compare(a.item.name, b.item.name),
    )
    .map((entry) => entry.item);
}
