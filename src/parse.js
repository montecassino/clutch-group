// Minimal RFC4180 CSV parser: quotes, escaped quotes, CRLF, BOM.
// Values are kept VERBATIM (no trimming) so the cleaning step can report
// what it changed instead of silently swallowing it.

export function parseCsv(text) {
  const clean = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];

  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r, i) => {
      const out = {};
      header.forEach((h, j) => {
        out[h] = r[j] ?? '';
      });
      out.__rowNumber = i + 2; // 1-based line in the source file, header excluded
      return out;
    });
}
