// Turns the two source files into the single object the page and the alert both read.
// Pure: same input + same clock -> same output, so the screen and the 8am message
// can never disagree.

import { parseCsv } from './parse.js';
import { cleanRegistrations, titleCase } from './clean.js';
import { dedupe } from './dedupe.js';

export const DAY_MS = 86_400_000;

// The events team is in Sydney, so "today" and "days to event" are Sydney dates.
// Using UTC here shifts every date by one for most of the working day.
export function sydneyDate(value) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dayKey(dateString) {
  return Date.parse(dateString + 'T00:00:00Z');
}

// Both arguments are YYYY-MM-DD.
export function diffDays(laterDate, earlierDate) {
  return Math.round((dayKey(laterDate) - dayKey(earlierDate)) / DAY_MS);
}

export function buildModel({ csvText, eventsJson, now }) {
  const rawRows = parseCsv(csvText);
  const events = eventsJson.map((e) => ({ ...e }));
  const eventsById = new Map(events.map((e) => [e.event_id, e]));

  const { records, quarantined } = cleanRegistrations(rawRows, eventsById);
  const { records: unique, excludedDuplicates, possibleDuplicates, anomalies } = dedupe(records);

  const nowISO = new Date(now).toISOString();
  const today = sydneyDate(now);

  // ---- feed health -------------------------------------------------------
  const latestRegistrationISO = unique
    .map((r) => r.registered_at)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const exportLastRegistration = latestRegistrationISO ? sydneyDate(latestRegistrationISO) : null;

  const perEvent = new Map();
  for (const e of events) perEvent.set(e.event_id, []);
  for (const r of unique) perEvent.get(r.event_id).push(r);

  // ---- per event ---------------------------------------------------------
  const rows = events.map((event) => {
    const recs = perEvent.get(event.event_id) ?? [];
    const seats = recs.filter((r) => r.status === 'Accepted').length;
    const pending = recs.filter((r) => r.status === 'Pending').length;
    const cancelled = recs.filter((r) => r.status === 'Cancelled').length;
    const daysLeft = diffDays(event.date, today);
    const hasFeed = recs.length > 0;

    // Never treat "no rows in the export" as zero registrations. For events the
    // export does not cover we fall back to the nightly count, clearly labelled.
    // Closed events also use it: it is the newest number, and calling a finished
    // event "missed" off a three-week-old export would be wrong.
    const snapshotCount = Number.isFinite(event.current_registrations) ? event.current_registrations : null;
    const preferSnapshot = snapshotCount != null && (!hasFeed || daysLeft < 0);
    const basis = preferSnapshot ? snapshotCount : hasFeed ? seats : null;
    const basisLabel = preferSnapshot ? 'nightly count' : 'confirmed in export';
    const feedAsOf = hasFeed
      ? sydneyDate(recs.map((r) => r.registered_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0])
      : null;

    const pct = basis == null ? null : Math.round((basis / event.target_registrations) * 100);
    const gap = basis == null ? null : event.target_registrations - basis;
    const requiredPerDay =
      gap != null && gap > 0 && daysLeft > 0 ? Math.ceil(gap / daysLeft) : null;

    let volumeStatus;
    if (daysLeft < 0) volumeStatus = basis == null ? 'unknown' : basis >= event.target_registrations ? 'met' : 'missed';
    else if (basis == null) volumeStatus = 'unknown';
    else volumeStatus = basis >= event.target_registrations ? 'met' : 'behind';

    const group =
      daysLeft < 0
        ? 'closed'
        : volumeStatus === 'behind'
          ? daysLeft <= 7
            ? 'closing'
            : 'campaign'
          : volumeStatus === 'met'
            ? 'ontrack'
            : 'unknown';

    return {
      event_id: event.event_id,
      name: event.name,
      city: event.city,
      date: event.date,
      type: event.type,
      target: event.target_registrations,
      snapshot: snapshotCount,
      daysLeft,
      hasFeed,
      feedAsOf,
      basis,
      basisLabel,
      seats,
      pending,
      cancelled,
      total: recs.length,
      pct,
      gap,
      requiredPerDay,
      volumeStatus,
      group,
      registrationIds: recs.map((r) => r.registration_id),
    };
  });

  const rankByGap = (a, b) => (b.gap ?? 0) / b.target - (a.gap ?? 0) / a.target;

  const closing = rows.filter((r) => r.group === 'closing').sort(rankByGap);
  const campaign = rows.filter((r) => r.group === 'campaign').sort(rankByGap);
  const ontrack = rows.filter((r) => r.group === 'ontrack').sort((a, b) => a.daysLeft - b.daysLeft);
  const closed = rows.filter((r) => r.group === 'closed').sort((a, b) => a.daysLeft - b.daysLeft);
  const upcoming = rows.filter((r) => r.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft);

  // ---- data quality ------------------------------------------------------
  const countFlag = (flag) => unique.filter((r) => r.flags.includes(flag)).length;
  const rawCountFlag = (flag) => records.filter((r) => r.flags.includes(flag)).length;

  const exportAgeDays = exportLastRegistration ? diffDays(today, exportLastRegistration) : null;

  const dataQuality = {
    rowsRead: rawRows.length,
    uniqueRows: unique.length,
    duplicatesExcluded: excludedDuplicates,
    possibleDuplicates,
    quarantined,
    anomalies,
    flags: {
      no_email: countFlag('no_email'),
      email_obfuscated: countFlag('email_obfuscated'),
      email_inferred_tld: countFlag('email_inferred_tld'),
      email_needs_review: countFlag('email_needs_review'),
      name_reformatted: countFlag('name_reformatted'),
      phone_repaired: countFlag('phone_repaired'),
      pre_launch: countFlag('pre_launch'),
    },
    preLaunchRows: rawCountFlag('pre_launch'),
    drift: rows
      .filter((r) => r.hasFeed && r.snapshot != null)
      .map((r) => ({
        event_id: r.event_id,
        name: r.name,
        seats: r.seats,
        snapshot: r.snapshot,
        difference: r.seats - r.snapshot,
      })),
  };

  const feeds = {
    export: {
      covers: rows.filter((r) => r.hasFeed).length,
      events: rows.filter((r) => r.hasFeed).length,
      asOf: exportLastRegistration,
      ageDays: exportAgeDays,
      state: exportAgeDays == null ? 'missing' : exportAgeDays > 2 ? 'stale' : 'current',
    },
    snapshot: {
      covers: rows.filter((r) => !r.hasFeed && r.snapshot != null).length,
      label: 'nightly count (no timestamp in the source file)',
      state: 'current',
    },
  };

  return {
    generatedAt: nowISO,
    today,
    feeds,
    totals: {
      attention: closing.length + campaign.length,
      seatsUpcoming: upcoming.reduce((sum, r) => sum + (r.basis ?? 0), 0),
      nextEvent: upcoming[0] ?? null,
    },
    groups: { closing, campaign, ontrack, closed },
    events: rows,
    dataQuality,
  };
}

// The same digest the webhook posts. One function, two consumers.
export function renderAlert(model) {
  const line = (r) =>
    `${r.event_id} ${r.basis}/${r.target} (${r.hasFeed ? 'export' : 'nightly'}, ${r.daysLeft}d left)`;
  const parts = [`Northstar registrations — ${formatDate(model.today)}`];
  if (model.groups.closing.length) parts.push('BEHIND: ' + model.groups.closing.map(line).join(' · '));
  if (model.groups.campaign.length) parts.push('CAMPAIGN: ' + model.groups.campaign.map(line).join(' · '));
  if (model.groups.ontrack.length) parts.push('ON TRACK: ' + model.groups.ontrack.map(line).join(' · '));
  if (model.feeds.export.state === 'stale') {
    parts.push(`Note: registration export last updated ${model.feeds.export.asOf} (${model.feeds.export.ageDays}d old).`);
  }
  return parts.join('\n');
}

export function formatDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function daysLabel(days) {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export { titleCase };
