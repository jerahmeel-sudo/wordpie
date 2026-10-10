// Scans the English Wiktionary extract from kaikki.org (gzipped JSONL on stdin) and compares it with Wordpie's
// built-in dictionary. Writes a report of (a) new 3-6 letter words with a normal meaning and (b) meanings for words we
// already have but can't explain. Nothing in site/dict is changed; tools/apply-wiktionary.mjs does that after review.
//
// Usage:  curl -sL https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz |
//           node tools/scan-wiktionary.mjs <12dicts folder> <output.json>
// Data: Wiktionary (CC BY-SA 4.0), extracted by Wiktextract / kaikki.org (Tatu Ylonen, LREC 2022).
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [D12, OUTFILE] = process.argv.slice(2);
if (!D12 || !OUTFILE) { console.error("Usage: ... | node tools/scan-wiktionary.mjs <12dicts folder> <output.json>"); process.exit(1); }
const DICT = new URL("../site/dict/", import.meta.url);

/* ---------- what we have today ---------- */
const have = new Set(readFileSync(new URL("words.txt", DICT), "utf8").trim().split("\n").map(l => l.split(" ")[0]));
const haveMeaning = new Set();
const shards = {};
for (const w of have) {
  const k = w.slice(0, 2);
  if (!(k in shards)) { const f = new URL("def/" + k + ".json", DICT); shards[k] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {}; }
  if (shards[k][w]) haveMeaning.add(w);
}
// 12dicts' bigger lists, to tell well-known words from obscure ones
const known = new Set();
for (const f of [["International", "3of6all.txt"], ["International", "2of4brif.txt"], ["American", "2of12inf.txt"]]) {
  const p = join(D12, ...f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").replace(/\r/g, "").split("\n")) {
    const w = line.trim().replace(/[^A-Za-z]/g, "");
    if (/^[a-z]{3,6}$/.test(w)) known.add(w);
  }
}

/* ---------- filters ---------- */
const POS_OK = new Set(["noun", "verb", "adj", "adv", "intj", "prep", "pron", "conj", "det", "num"]);
const POS_NAME = { adj: "adjective", adv: "adverb", intj: "interjection", prep: "preposition", pron: "pronoun", conj: "conjunction", det: "determiner", num: "number" };
const BAD_TAGS = new Set(["obsolete", "archaic", "dated", "rare", "dialectal", "nonstandard", "misspelling", "abbreviation",
  "initialism", "acronym", "alt-of", "pronunciation-spelling", "eye-dialect", "uncommon", "nonce-word", "proscribed", "error-lua-exec"]);
const BAD_GLOSS = /^(alternative|obsolete|archaic|dated|rare|eye dialect|nonstandard|misspelling|abbreviation|initialism|acronym)\b.*\b(form|spelling|of)\b/i;
const FORM_TAGS = new Set(["plural", "past", "participle", "present", "third-person", "comparative", "superlative", "gerund"]);
const clean = g => {
  let d = String(g).replace(/\s+/g, " ").trim();
  if (d.length > 140) d = d.slice(0, 137).replace(/\s+\S*$/, "") + "…";
  return d ? d[0].toUpperCase() + d.slice(1) : d;
};

/* ---------- scan ---------- */
const found = new Map();   // word -> { pos, meaning, formOf }
let lines = 0, english = 0;
const rl = createInterface({ input: process.stdin.pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  lines++;
  if (lines % 200000 === 0) console.error(`… ${lines.toLocaleString()} entries read, ${found.size.toLocaleString()} usable short words so far`);
  if (line.length < 20) continue;
  let e;
  try { e = JSON.parse(line); } catch (err) { continue; }
  if (e.lang_code !== "en") continue;
  english++;
  const w = e.word;
  if (!/^[a-z]{3,6}$/.test(w) || !POS_OK.has(e.pos)) continue;
  for (const s of e.senses || []) {
    const tags = s.tags || [];
    if (tags.some(t => BAD_TAGS.has(t))) continue;
    const gloss = (s.glosses || [])[0];
    if (!gloss || BAD_GLOSS.test(gloss)) continue;
    const formOf = s.form_of && s.form_of[0] && s.form_of[0].word;
    if (formOf && !tags.some(t => FORM_TAGS.has(t))) continue;     // "form of" without plural/past/etc: skip
    const prev = found.get(w);
    // Prefer a real meaning over a "plural of …" one
    if (!prev || (prev.formOf && !formOf)) found.set(w, { pos: POS_NAME[e.pos] || e.pos, meaning: clean(gloss), formOf: formOf || "" });
    break;
  }
}

/* ---------- compare ---------- */
const add = {}, addKnown = {}, fill = {};
for (const [w, d] of found) {
  const entry = [d.pos, d.meaning, d.formOf];
  if (!have.has(w)) {
    // A form of a word we wouldn't have isn't worth adding
    if (d.formOf && !have.has(d.formOf) && !found.has(d.formOf)) continue;
    add[w] = entry;
    if (known.has(w)) addKnown[w] = entry;
  } else if (!haveMeaning.has(w)) fill[w] = entry;
}
const stillMissing = [...have].filter(w => !haveMeaning.has(w) && !fill[w]);
writeFileSync(OUTFILE, JSON.stringify({ add, addKnown, fill, stillMissing }, null, 0));
console.error(`done: ${lines.toLocaleString()} entries (${english.toLocaleString()} English), ${found.size.toLocaleString()} usable 3-6 letter words`);
console.error(`new words: ${Object.keys(add).length} (of which in 12dicts' bigger lists: ${Object.keys(addKnown).length})`);
console.error(`meanings found for words we have without one: ${Object.keys(fill).length}  (still without: ${stillMissing.length})`);
