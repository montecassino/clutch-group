// Normalise + validate + flag. Nothing is dropped silently: every record that
// cannot be trusted goes to `quarantined` with a reason, everything else keeps
// a `flags` array describing what was repaired.

const STATUS_MAP = new Map([
  ['accepted', 'Accepted'],
  ['pending', 'Pending'],
  ['cancelled', 'Cancelled'],
  ['canceled', 'Cancelled'],
]);

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

export function titleCase(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s'\-])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

// `04XXXXXXXX` and `+61XXXXXXXXX` are both legitimate as written; converting them is
// housekeeping, not a repair. Only flag a number that actually arrived malformed,
// otherwise the "repaired" badge fires on 95% of rows and tells nobody anything.
const PHONE_AS_WRITTEN = /^(\+61\d{9}|04\d{8})$/;

export function normalisePhone(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { value: '', flag: null };
  const digits = trimmed.replace(/[^\d+]/g, '');
  let e164 = null;
  if (/^\+61\d{9}$/.test(digits)) e164 = digits;
  else if (/^61\d{9}$/.test(digits)) e164 = '+' + digits;
  else if (/^0\d{9}$/.test(digits)) e164 = '+61' + digits.slice(1);
  else if (/^4\d{8}$/.test(digits)) e164 = '+61' + digits; // 9 digits: leading 0 lost upstream
  const repaired = Boolean(e164) && !PHONE_AS_WRITTEN.test(trimmed);
  return { value: e164 ?? trimmed, flag: repaired ? 'phone_repaired' : null };
}

// A company's real domain, learned from the emails that are already valid.
// Used only to repair `name@company` emails that lost their TLD.
export function learnCompanyDomains(rawRows) {
  const tally = new Map();
  for (const row of rawRows) {
    const email = row.email.trim().toLowerCase();
    const company = row.company.trim();
    if (!company || !EMAIL_SHAPE.test(email)) continue;
    const domain = email.split('@')[1];
    if (!tally.has(company)) tally.set(company, new Map());
    const perCompany = tally.get(company);
    perCompany.set(domain, (perCompany.get(domain) ?? 0) + 1);
  }
  const learned = new Map();
  for (const [company, domains] of tally) {
    let best = null;
    let bestCount = -1;
    for (const [domain, count] of domains) {
      if (count > bestCount) {
        best = domain;
        bestCount = count;
      }
    }
    learned.set(company, best);
  }
  return learned;
}

export function cleanEmail(raw, company, companyDomains) {
  const flags = [];
  let email = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!email) return { email: '', norm: '', flags: ['no_email'] };

  const obfuscated = /^([^@\s]+?)\s*(?:\[at\]|\(at\))\s*([^@\s]+)$/i.exec(email);
  if (obfuscated) {
    email = `${obfuscated[1]}@${obfuscated[2]}`;
    flags.push('email_obfuscated');
  }

  if (!EMAIL_SHAPE.test(email) && email.includes('@')) {
    const [local, domain] = email.split('@');
    const learned = companyDomains.get(company);
    if (learned && domain && learned.startsWith(domain)) {
      email = `${local}@${learned}`;
      flags.push('email_inferred_tld');
    } else {
      flags.push('email_needs_review');
    }
  }

  return { email, norm: email, flags };
}

export function cleanRegistrations(rawRows, eventsById) {
  const companyDomains = learnCompanyDomains(rawRows);
  const records = [];
  const quarantined = [];

  for (const row of rawRows) {
    const flags = [];
    const rawEvent = row.event.trim();
    const eventId = rawEvent.split(' ')[0];
    const event = eventsById.get(eventId);

    if (!event) {
      quarantined.push({ rowNumber: row.__rowNumber, reason: 'unknown_event', raw: row });
      continue;
    }

    const status = STATUS_MAP.get(row.status.trim().toLowerCase());
    if (!status) {
      quarantined.push({ rowNumber: row.__rowNumber, reason: 'unknown_status', raw: row });
      continue;
    }

    const registeredAt = row.registered_at.trim();
    if (!registeredAt || Number.isNaN(Date.parse(registeredAt))) {
      quarantined.push({ rowNumber: row.__rowNumber, reason: 'bad_timestamp', raw: row });
      continue;
    }

    const rawFirst = row.first_name;
    const rawLast = row.last_name;
    const first = titleCase(rawFirst.trim().replace(/\s+/g, ' '));
    const last = titleCase(rawLast.trim().replace(/\s+/g, ' '));
    if (first !== rawFirst || last !== rawLast) flags.push('name_reformatted');

    const company = row.company.trim();
    const { email, norm, flags: emailFlags } = cleanEmail(row.email, company, companyDomains);
    flags.push(...emailFlags);

    const phone = normalisePhone(row.mobile);
    if (phone.flag) flags.push(phone.flag);

    if (Date.parse(registeredAt) < Date.parse(event.launched + 'T00:00:00Z')) {
      flags.push('pre_launch');
    }

    records.push({
      registration_id: row.registration_id.trim(),
      event_id: eventId,
      event_name: event.name,
      first_name: first,
      last_name: last,
      email,
      email_norm: norm,
      company,
      job_title: row.job_title.trim(),
      mobile: phone.value,
      registered_at: registeredAt,
      status,
      flags,
      raw: row,
    });
  }

  return { records, quarantined };
}
