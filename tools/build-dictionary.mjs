// Builds Wordpie's built-in dictionary (site/dict/) from two free sources:
//   12dicts 6.0.2 by Alan Beale (public domain)   http://wordlist.aspell.net/12dicts/
//     - International/3of6game.txt : a mid-size word-game list with plurals and verb forms
//     - Lemmatized/2+2+3frq.txt    : base words in frequency tiers, used to rank how common a word is
//   Princeton WordNet 3.1 (WordNet licence, see site/dict/WORDNET-LICENSE.txt)   https://wordnet.princeton.edu/
//     - index.* / data.*  : definitions;  *.exc : irregular forms (told -> tell)
//
// Usage: node tools/build-dictionary.mjs <path to unpacked 12dicts folder> <path to WordNet dict folder>
// Output:
//   site/dict/words.txt      one "word score" per line, 3-6 letters; score 0 (rare) .. 9 (very common)
//   site/dict/def/<ab>.json  { word: [partOfSpeech, meaning] } for words starting with <ab>
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const [D12, WN] = process.argv.slice(2);
if (!D12 || !WN) { console.error("Usage: node tools/build-dictionary.mjs <12dicts folder> <WordNet dict folder>"); process.exit(1); }
const OUT = new URL("../site/dict/", import.meta.url);
const read = p => readFileSync(p, "utf8").replace(/\r/g, "");
const ok = w => /^[a-z]{3,6}$/.test(w);

/* ---------- WordNet: definitions for base words ---------- */
const POS = { noun: "noun", verb: "verb", adj: "adjective", adv: "adverb" };
const glossByPos = {};          // pos -> Map(offset -> { gloss, words })
for (const p of Object.keys(POS)) {
  const m = new Map();
  for (const line of read(join(WN, "data." + p)).split("\n")) {
    if (!line || line.startsWith("  ")) continue;                  // licence header lines start with spaces
    const bar = line.indexOf(" | ");
    if (bar < 0) continue;
    // "offset lexfile ss_type w_cnt(hex) word lex_id word lex_id ..." — words keep their capitals (Paris, NASA)
    const f = line.slice(0, bar).split(" ");
    const wCnt = parseInt(f[3], 16);
    const synWords = [];
    for (let i = 0; i < wCnt; i++) synWords.push(f[4 + i * 2].replace(/\(.*\)$/, ""));
    m.set(f[0], { gloss: line.slice(bar + 3).trim(), words: synWords });
  }
  glossByPos[p] = m;
}
// Keep the definition, drop the quoted examples:  'a hollow device ...; "the bells rang"'
const cleanGloss = g => {
  let d = g.split(/;\s*"/)[0].replace(/\s+/g, " ").trim().replace(/;$/, "");
  if (d.length > 140) d = d.slice(0, 137).replace(/\s+\S*$/, "") + "…";
  return d ? d[0].toUpperCase() + d.slice(1) : d;
};
// For each word, keep the most-used part of speech (WordNet's "tagsense" count: how many of its senses appear in
// real text) and, within it, the first sense where the word is written in lowercase — so "tell" is the verb, not
// William Tell, and "paris" (only ever a name) is left out.
const base = new Map();          // lemma -> { pos, meaning, weight }   (its most-used part of speech)
const perPos = { noun: new Map(), verb: new Map(), adj: new Map(), adv: new Map() };   // pos -> lemma -> { meaning, weight }
for (const p of ["noun", "verb", "adj", "adv"]) {
  for (const line of read(join(WN, "index." + p)).split("\n")) {
    if (!line || line.startsWith("  ")) continue;
    const f = line.split(" ");
    const lemma = f[0];
    if (!ok(lemma)) continue;
    const pCnt = parseInt(f[3], 10);
    const tagged = parseInt(f[5 + pCnt], 10) || 0;                  // senses seen in real text
    const offsets = f.slice(6 + pCnt).filter(x => /^\d{8}$/.test(x));
    let meaning = "";
    for (const off of offsets) {
      const syn = glossByPos[p].get(off);
      if (!syn) continue;
      const asWritten = syn.words.find(w => w.toLowerCase() === lemma);
      if (asWritten !== lemma) continue;                             // a name or an abbreviation in capitals
      const m = cleanGloss(syn.gloss);
      if (/^(an? )?abbreviation\b/i.test(m)) continue;
      meaning = m; break;
    }
    if (!meaning) continue;
    const weight = tagged + (p === "noun" ? 0.2 : p === "verb" ? 0.15 : p === "adj" ? 0.1 : 0);   // ties: noun, verb, adj
    perPos[p].set(lemma, { meaning, weight });
    const prev = base.get(lemma);
    if (!prev || weight > prev.weight) base.set(lemma, { pos: POS[p], meaning, weight });
  }
}

/* ---------- WordNet irregular forms: told -> tell, geese -> goose ---------- */
const irregular = new Map();      // form -> { base, pos }
for (const p of ["noun", "verb", "adj"]) {
  for (const line of read(join(WN, p + ".exc")).split("\n")) {
    const [form, b] = line.trim().split(" ");
    if (form && b && ok(form) && !irregular.has(form)) irregular.set(form, { base: b, pos: p });
  }
}

/* ---------- inflected forms get a meaning from their base word ---------- */
// Returns { pos, text, base, weight } using the base word's meaning in the matching part of speech, or null.
function describeForm(w) {
  const make = (b, label, p) => {
    const e = perPos[p].get(b);
    return e ? { pos: POS[p], text: label + b + ": " + lower(e.meaning), base: b, weight: e.weight } : null;
  };
  const irr = irregular.get(w);
  if (irr) {
    const r = make(irr.base, irr.pos === "noun" ? "Plural of " : irr.pos === "verb" ? "Past form of " : "Form of ", irr.pos);
    if (r) return r;
  }
  const tries = [];
  const add = (b, label, p) => tries.push([b, label, p]);
  const cut = n => w.slice(0, -n);
  if (w.endsWith("ies")) { add(cut(3) + "y", "Plural of ", "noun"); add(cut(3) + "y", "Form of ", "verb"); }
  if (/(s|x|z|ch|sh)es$/.test(w)) { add(cut(2), "Plural of ", "noun"); add(cut(2), "Form of ", "verb"); }
  if (w.endsWith("s") && !w.endsWith("ss")) { add(cut(1), "Plural of ", "noun"); add(cut(1), "Form of ", "verb"); }
  if (w.endsWith("ied")) add(cut(3) + "y", "Past tense of ", "verb");
  if (w.endsWith("ed")) {
    add(cut(1), "Past tense of ", "verb"); add(cut(2), "Past tense of ", "verb");
    if (w.length > 4 && w[w.length - 3] === w[w.length - 4]) add(cut(3), "Past tense of ", "verb");     // stopped -> stop
  }
  if (w.endsWith("ing")) {
    add(cut(3), "-ing form of ", "verb"); add(cut(3) + "e", "-ing form of ", "verb");
    if (w.length > 5 && w[w.length - 4] === w[w.length - 5]) add(cut(4), "-ing form of ", "verb");      // running -> run
  }
  if (w.endsWith("er")) { add(cut(2), "More ", "adj"); add(cut(1), "More ", "adj"); }
  if (w.endsWith("est")) { add(cut(3), "Most ", "adj"); add(cut(2), "Most ", "adj"); }
  for (const [b, label, p] of tries) {
    if (b.length < 2 || b === w) continue;
    const r = make(b, label, p);
    if (r) return r;
  }
  return null;
}
function lower(s) { return s ? s[0].toLowerCase() + s.slice(1) : s; }

/* ---------- frequency tiers -> score 0..9 ---------- */
const tierOf = new Map();
let tier = 0;
for (const line of read(join(D12, "Lemmatized", "2+2+3frq.txt")).split("\n")) {
  const t = line.match(/^-+\s*(\d+)\s*-+/);
  if (t) { tier = parseInt(t[1], 10); continue; }
  for (const w of line.trim().split(/,\s*/)) {
    const x = w.toLowerCase().replace(/[^a-z]/g, "");
    if (x && !tierOf.has(x)) tierOf.set(x, tier);
  }
}
const maxTier = Math.max(...tierOf.values());
const tierScore = w => {
  const t = tierOf.get(w);
  return t === undefined ? 0 : Math.max(1, 9 - Math.floor((t - 1) * 9 / maxTier));   // tier 1 -> 9, last tier -> 1
};
// Plurals and verb forms are as common as their base word (one less, as they're used a bit less)
const score = w => {
  const own = tierScore(w);
  if (own) return own;
  const f = describeForm(w);
  return f ? Math.max(0, tierScore(f.base) - 1) : 0;
};

/* ---------- the word list: 3of6game + every WordNet word of the right length ---------- */
const words = new Set();
for (const line of read(join(D12, "International", "3of6game.txt")).split("\n")) {
  const w = line.trim().replace(/[^a-z]/g, "");      // drops 12dicts' markers like $ and +
  if (ok(w) && line.trim().replace(/[^A-Za-z]/g, "") === line.trim().replace(/[^A-Za-z]/g, "").toLowerCase()) words.add(w);
}
const fromGameList = words.size;
for (const w of base.keys()) if (/[aeiouy]/.test(w)) words.add(w);       // real dictionary words the list missed

/* ---------- write the files ---------- */
if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(new URL("def/", OUT), { recursive: true });
const sorted = [...words].sort();
writeFileSync(new URL("words.txt", OUT), sorted.map(w => w + " " + score(w)).join("\n") + "\n");
const shards = {};
let withMeaning = 0;
for (const w of sorted) {
  const e = base.get(w), form = describeForm(w);
  // A rarely-used entry of its own (BAKED as an adjective) loses to "past tense of bake"
  const d = e && !(form && e.weight < 1 && form.weight >= 1) ? [e.pos, e.meaning] : form ? [form.pos, form.text] : null;
  if (!d) continue;
  withMeaning++;
  (shards[w.slice(0, 2)] = shards[w.slice(0, 2)] || {})[w] = d;
}
for (const [k, v] of Object.entries(shards)) writeFileSync(new URL("def/" + k + ".json", OUT), JSON.stringify(v));
// The WordNet licence is the numbered header of every data file; keep it with the definitions
const licence = read(join(WN, "data.noun")).split("\n").filter(l => l.startsWith("  "))
  .map(l => l.replace(/^\s+\d+\s?/, "")).join("\n").trim();
writeFileSync(new URL("WORDNET-LICENSE.txt", OUT), licence + "\n");

const byLen = [3, 4, 5, 6].map(n => n + ":" + sorted.filter(w => w.length === n).length).join(" ");
console.log(`words: ${sorted.length} (from game list ${fromGameList}, added from WordNet ${sorted.length - fromGameList})  by length ${byLen}`);
console.log(`with a meaning: ${withMeaning} (${Math.round(withMeaning * 100 / sorted.length)}%)  definition files: ${Object.keys(shards).length}`);
