'use strict';

const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } };

const { forLanguage, baseLanguage, EN, TRANSLATIONS } = require('../src/nls');

assert(Object.keys(TRANSLATIONS).length === 0, 'no translations — the extension speaks English only');

for (const key of Object.keys(EN)) {
  const value = EN[key];
  {
    assert(typeof value === 'string' && value !== '', key + ': base value is a non-empty string');
  }
}

assert(baseLanguage('pl-PL') === 'pl' && baseLanguage('en-US') === 'en' && baseLanguage('') === 'en',
  'language tag reduces to its base');

const en = forLanguage('en-US');
const pl = forLanguage('pl-PL');
const de = forLanguage('de');
assert(en.lang === 'en' && pl.lang === 'en' && de.lang === 'en', 'every language resolves to English');
assert(en.t('error.saveFirst') === EN['error.saveFirst'] && pl.t('error.saveFirst') === EN['error.saveFirst'],
  'simple lookup, and every language gets the English text');
assert(en.t('info.saved', { path: 'a/b.md' }) === 'Saved: a/b.md', 'placeholder substitution');
assert(en.t('no.such.key') === 'no.such.key', 'unknown key returns the key');

const strings = en.stringsTable();
assert(typeof strings['error.saveFirst'] === 'string', 'the strings table carries the catalogue');

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

const wordListPath = process.env.API_DESIGNER_PRIVATE_WORDS ||
  path.join(root, '..', 'private-words.txt');
const privateWords = fs.existsSync(wordListPath)
  ? fs.readFileSync(wordListPath, 'utf8').split('\n').map((w) => w.trim()).filter(Boolean)
  : [];
const PRIVATE_NAMES = privateWords.length
  ? new RegExp('\\b(' + privateWords.join('|') + ')\\b')
  : null;

const POLISH_WORDS = /\b(kontrakt(u|y|ow|em|ami|ach)?|schemat(u|y|ow|em|ami|ach)?|slownik(i|a|ow|iem)?|komponent(y|u|ow|em|ami)?|typy danych|dodaj|nowy|nowa|wersj[aeiy]|zapisz|uslug[aiey]|pakiet(u|y|ow|em)?|przyklad(y|u|ow|em)?|odpowiedz(i|ia)?|zadani[ea]|wybor|klucz|tekst|szablon(y|u|ow|em)?|wlasciwosci|zapis|zmiana|zmiany|nazwy|dotyka|referencj\\w*|ktory|ktora|ktore|zeby|czyli|wiec|mozna|trzeba|wlasnie|zamiast|juz|jeszcze|licznosc|pelne|pilnuje|wracaja|prosil)\b/i;

const GUARDED = [
  { dir: 'src', ext: /\.js$/ },
  { dir: 'media', ext: /\.(js|css|html)$/ },
  { dir: 'test', ext: /\.js$/, skip: /^nls-test\.js$/ },
  { dir: '.', ext: /^(README|CHANGELOG|SECURITY)\.md$/ }
];
for (const area of GUARDED) {
  const dir = path.join(root, area.dir);
  for (const file of fs.readdirSync(dir)) {
    if (!area.ext.test(file)) continue;
    if (area.skip && area.skip.test(file)) continue;
    const name = (area.dir === '.' ? '' : area.dir + '/') + file;
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert(!POLISH.test(text), name + ' holds no Polish text');
    const word = text.match(POLISH_WORDS);
    assert(!word, name + ' holds no Polish word: ' + (word && word[0]));
    const priv = PRIVATE_NAMES && text.match(PRIVATE_NAMES);
    assert(!priv, name + ' names nothing from the private word list: ' + (priv && priv[0]));
  }
}

const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const nlsEn = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const used = new Set((manifest.match(/%[\w.]+%/g) || []).map((m) => m.slice(1, -1)));
assert(used.size > 0, 'manifest references nls keys');
for (const key of used) {
  assert(typeof nlsEn[key] === 'string' && nlsEn[key] !== '', 'package.nls.json defines ' + key);
}
const nlsFiles = fs.readdirSync(root).filter((f) => /^package\.nls\..+\.json$/.test(f));
assert(nlsFiles.length === 0, 'no per-language manifest files, got: ' + nlsFiles.join(', '));

const SENTENCE = /'([A-Z][^'\\]{14,}?[.?!])'/g;
const catalogText = new Set(Object.values(EN).map(String));
const UI_FILES = ['src/designerGui.js', 'src/extension.js',
  'src/wsdlXsdAvro.js', 'src/schemaConvert.js']
  .concat(fs.readdirSync(path.join(root, 'media'))
    .filter((f) => /^designer-.+\.js$/.test(f))
    .map((f) => 'media/' + f));
for (const file of UI_FILES) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  let m;
  while ((m = SENTENCE.exec(text))) {
    const sentence = m[1];
    if (catalogText.has(sentence)) continue;
    if (/\{\{|\bhttps?:|^[A-Z][a-z]+\.[a-z]/.test(sentence)) continue;
    if (sentence.split(' ').length < 3) continue;
    assert(false, file + ' says a sentence outside the catalogue: ' + sentence);
  }
}

console.log('nls-test OK');
