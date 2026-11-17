// Markdown → print-ready HTML for the assessment doc.
// Handles exactly the subset docs/answers.md uses: h1-h3, bold, italic, inline
// code, links, blockquotes, pipe tables, ordered/unordered lists, rules and
// paragraphs. No dependencies, no build step beyond `node scripts/build-doc.mjs`.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'docs', 'answers.md'), 'utf8');

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(text) {
  let out = escapeHtml(text);
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;

  out = out.replace(/`([^`]+)`/g, (_m, code) => keep(`<code>${code}</code>`));
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => keep(`<a href="${href}">${label}</a>`));
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)]);
}

const isBlank = (line) => line.trim() === '';
const isRule = (line) => /^---+\s*$/.test(line.trim());
const isHeading = (line) => /^#{1,3}\s/.test(line);
const isTableStart = (line, next) => line.trim().startsWith('|') && next && /^\|[\s:|-]+\|?\s*$/.test(next.trim());
const isUl = (line) => /^[-*]\s+/.test(line);
const isOl = (line) => /^\d+\.\s+/.test(line);
const isQuote = (line) => /^>\s?/.test(line);

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

function render(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let i = 0;
  let headingCount = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    if (isRule(line)) {
      html.push('<hr>');
      i++;
      continue;
    }

    if (isHeading(line)) {
      const level = line.match(/^(#{1,3})/)[1].length;
      const text = line.replace(/^#{1,3}\s+/, '').trim();
      let cls = '';
      if (level === 1) cls = headingCount++ === 0 ? ' class="title"' : ' class="part"';
      html.push(`<h${level}${cls}>${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const head = splitRow(line);
      i += 2; // header + separator
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const keepClass = head.length === 4 ? ' class="grid keep"' : ' class="grid keep"';
      html.push(`<table${keepClass}><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`);
      for (const row of rows) {
        html.push(`<tr>${row.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
      }
      html.push('</tbody></table>');
      continue;
    }

    if (isQuote(line)) {
      const parts = [];
      while (i < lines.length && isQuote(lines[i])) {
        parts.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      html.push(`<blockquote><p>${inline(parts.join(' '))}</p></blockquote>`);
      continue;
    }

    if (isUl(line) || isOl(line)) {
      const ordered = isOl(line);
      const items = [];
      while (i < lines.length) {
        const current = lines[i];
        if (!(ordered ? isOl(current) : isUl(current))) break;
        let text = current.replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, '');
        i++;
        // indented continuation lines belong to the same item
        while (i < lines.length && /^\s+\S/.test(lines[i]) && !isBlank(lines[i])) {
          text += ' ' + lines[i].trim();
          i++;
        }
        items.push(text);
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
      continue;
    }

    // paragraph
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !isHeading(lines[i]) && !isRule(lines[i]) && !isUl(lines[i]) && !isOl(lines[i]) && !isQuote(lines[i]) && !lines[i].trim().startsWith('|')) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) html.push(`<p>${inline(para.join(' '))}</p>`);
    else i++;
  }

  return html.join('\n');
}

const CSS = `
@page { size: A4; margin: 15mm 14mm 14mm; }

:root {
  --ink: #14181f;
  --muted: #5b6472;
  --rule: #d8dce2;
  --accent: #1d2939;
  --tint: #f4f6f8;
}

* { box-sizing: border-box; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  margin: 0;
  color: var(--ink);
  font: 10pt/1.42 Charter, Georgia, "Times New Roman", serif;
  background: #fff;
  orphans: 2;
  widows: 2;
}

h1, h2, h3, th {
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
}

h1.title {
  font-size: 20pt;
  line-height: 1.2;
  letter-spacing: -.015em;
  margin: 0 0 10px;
  padding-bottom: 8px;
  border-bottom: 2.5pt solid var(--accent);
}

h1.part {
  font-size: 17pt;
  line-height: 1.2;
  letter-spacing: -.01em;
  margin: 0 0 12px;
  padding-bottom: 6px;
  border-bottom: 1.5pt solid var(--accent);
  break-before: page;
  page-break-before: always;
  break-after: avoid;
}

h2 {
  font-size: 12.2pt;
  margin: 11px 0 4px;
  break-after: avoid;
  page-break-after: avoid;
}

h3 {
  font-size: 10.6pt;
  margin: 10px 0 3px;
  break-after: avoid;
  page-break-after: avoid;
}

p { margin: 0 0 6px; }

a { color: #1d4ed8; text-decoration: none; border-bottom: .5pt solid #b9c6ea; }

code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: .88em;
  background: #f1f3f6;
  border: .5pt solid #e2e6eb;
  border-radius: 3px;
  padding: 0 3px;
}

strong { font-weight: 700; }

hr {
  border: 0;
  border-top: .5pt solid var(--rule);
  margin: 14px 0;
}

ul, ol { margin: 0 0 9px; padding-left: 18px; }
li { margin: 0 0 3px; }

blockquote {
  margin: 8px 0 10px;
  padding: 8px 12px;
  background: var(--tint);
  border-left: 2.5pt solid #98a2b3;
  font-size: 9.6pt;
  color: #3d4653;
}
blockquote p { margin: 0; }

table {
  width: 100%;
  border-collapse: collapse;
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-size: 9pt;
  line-height: 1.4;
  margin: 8px 0 13px;
  /* the Part 3 table must never be split across pages */
  break-inside: avoid;
  page-break-inside: avoid;
}

thead { display: table-header-group; }

th {
  text-align: left;
  font-weight: 650;
  font-size: 8.4pt;
  letter-spacing: .02em;
  background: #eef1f4;
  border-bottom: 1pt solid #aab2bd;
  padding: 5px 7px;
}

td {
  vertical-align: top;
  border-bottom: .5pt solid var(--rule);
  padding: 5px 7px;
}

tr { break-inside: avoid; page-break-inside: avoid; }

td:first-child, th:first-child { width: 4%; white-space: nowrap; text-align: center; }
td:nth-child(2) { width: 26%; }
td:nth-child(3) { width: 17%; }

td:nth-child(3) strong { color: var(--accent); }

@media screen {
  body { max-width: 780px; margin: 0 auto; padding: 32px 24px 64px; }
  h1.part { break-before: auto; page-break-before: auto; margin-top: 34px; }
}
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Digital &amp; Tech Lead — Skills Assessment (Parts 2–5)</title>
<meta name="author" content="Mark Benedict D. Lutab">
<style>${CSS}</style>
</head>
<body>
${render(source)}
</body>
</html>
`;

writeFileSync(join(root, 'docs', 'answers.html'), html, 'utf8');
console.log('wrote docs/answers.html', html.length, 'bytes');
