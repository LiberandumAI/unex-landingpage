// Generates /uz/index.html and /en/index.html from the Russian index.html.
// Dictionaries are keyed by the exact Russian string (i18n/*.json), so the
// source page stays plain HTML with no template syntax. Runs before dev/build.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'node-html-parser';

const LANGS = {
  ru: { path: '/', label: 'RU' },
  uz: { path: '/uz/', label: 'UZ' },
  en: { path: '/en/', label: 'EN' },
};
const SKIP_TAGS = new Set(['script', 'style', 'svg', 'iframe']);
const norm = (s) => s.replace(/&nbsp;/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const source = readFileSync('index.html', 'utf8');

for (const lang of ['uz', 'en']) {
  const dict = JSON.parse(readFileSync(`i18n/${lang}.json`, 'utf8'));
  const meta = dict.$meta;
  const root = parse(source, { comment: true });
  const missing = new Set();

  const tr = (raw) => {
    const key = norm(raw);
    if (!key) return null;
    if (dict[key] !== undefined) return dict[key];
    if (/[А-Яа-яЁё]/.test(key)) missing.add(key);
    return null;
  };

  root.querySelector('title').set_content(meta.title); // before the walk: not a dictionary key
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const t = tr(child.rawText);
        if (t !== null) {
          // keep the surrounding whitespace so inline layout does not change
          const lead = child.rawText.match(/^\s*/)[0];
          const tail = child.rawText.match(/\s*$/)[0];
          child.rawText = lead + t + tail;
        }
      } else if (child.nodeType === 1 && !SKIP_TAGS.has(child.tagName?.toLowerCase())) {
        walk(child);
      }
    }
  };
  walk(root);

  for (const el of root.querySelectorAll('[aria-label],[alt],[title]')) {
    for (const attr of ['aria-label', 'alt', 'title']) {
      const v = el.getAttribute(attr);
      const t = v ? tr(v) : null;
      if (t !== null) el.setAttribute(attr, t);
    }
  }

  root.querySelector('html').setAttribute('lang', meta.lang);
  root.querySelector('meta[name="description"]').setAttribute('content', meta.description);

  // language switchers: mark the current one
  for (const a of root.querySelectorAll('.lang a, .footer__col a[hreflang]')) {
    const isCurrent = a.getAttribute('hreflang') === lang;
    if (isCurrent) a.classList.add('is-active');
    else a.classList.remove('is-active');
    if (isCurrent) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }

  mkdirSync(lang, { recursive: true });
  writeFileSync(`${lang}/index.html`, root.toString());
  console.log(`i18n: ${lang}/index.html written` + (missing.size ? `, ${missing.size} untranslated:` : ''));
  for (const m of missing) console.log('   -', m);
}
