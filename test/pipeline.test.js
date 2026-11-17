import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildModel, renderAlert } from '../src/model.js';
import { normalisePhone, titleCase } from '../src/clean.js';

const csvText = readFileSync(new URL('../data/registrations.csv', import.meta.url), 'utf8');
const eventsJson = JSON.parse(readFileSync(new URL('../data/events.json', import.meta.url), 'utf8'));
const now = new Date('2026-11-17T09:00:00+11:00');
const model = buildModel({ csvText, eventsJson, now });
const byId = (id) => model.events.find((e) => e.event_id === id);

test('parses every row and every column', () => {
  assert.equal(model.dataQuality.rowsRead, 145);
  assert.equal(model.dataQuality.uniqueRows, 138);
});

test('removes exact duplicate registrations, keeps one seat each', () => {
  assert.equal(model.dataQuality.duplicatesExcluded.length, 7);
  for (const dup of model.dataQuality.duplicatesExcluded) assert.notEqual(dup.kept, dup.dropped);
});

test('seats are deduped accepted counts per event', () => {
  assert.equal(byId('E101').seats, 37);
  assert.equal(byId('E114').seats, 43);
  assert.equal(byId('E125').seats, 37);
  assert.equal(byId('E101').pending, 2);
  assert.equal(byId('E101').cancelled, 5);
});

test('events with no export rows are not reported as zero', () => {
  const e130 = byId('E130');
  assert.equal(e130.hasFeed, false);
  assert.equal(e130.basis, 4);
  assert.equal(e130.basisLabel, 'nightly count');
  assert.equal(byId('E155').basis, null);
  assert.equal(byId('E155').volumeStatus, 'unknown');
});

test('flags repair the messy fields', () => {
  const f = model.dataQuality.flags;
  assert.equal(f.no_email, 6);
  assert.equal(f.email_obfuscated, 8);
  assert.equal(f.email_inferred_tld, 6);
  assert.equal(f.email_needs_review, 0);
  // 25 rows arrived malformed; two of them were dropped as duplicates.
  assert.equal(f.phone_repaired, 23);
  assert.equal(model.dataQuality.preLaunchRows, 15);
});

test('phone numbers become E.164', () => {
  assert.equal(normalisePhone('458414384').value, '+61458414384');
  assert.equal(normalisePhone('+61 427 874 296').value, '+61427874296');
  assert.equal(normalisePhone('0424 991 717').value, '+61424991717');
});

test('names lose padding and shouting', () => {
  assert.equal(titleCase('  DANIEL '), 'Daniel');
  assert.equal(titleCase('MURPHY'), 'Murphy');
});

test('duplicate with conflicting details is surfaced, not silently dropped', () => {
  const conflict = model.dataQuality.anomalies.find((a) => a.kind === 'conflicting_duplicate');
  assert.ok(conflict, 'expected a conflicting duplicate to be reported');
  assert.match(conflict.detail, /daniel\.khan/);
});

test('possible duplicates are counted, not merged', () => {
  assert.equal(model.dataQuality.possibleDuplicates.length, 4);
  for (const p of model.dataQuality.possibleDuplicates) assert.ok(p.emails.length >= 2);
});

test('attention groups match the runway from today', () => {
  const closing = model.groups.closing.map((e) => e.event_id);
  assert.ok(closing.includes('E101'));
  assert.ok(closing.includes('E126'));
  assert.ok(closing.includes('E130'));
  assert.deepEqual(model.groups.campaign.map((e) => e.event_id), ['E150']);
  assert.deepEqual(model.groups.ontrack.map((e) => e.event_id), ['E141']);
  assert.deepEqual(model.groups.closed.map((e) => e.event_id).sort(), ['E114', 'E155']);
  // Closed events report the newer nightly count, not the 21-day-old export.
  assert.equal(byId('E114').basis, 46);
  assert.equal(byId('E114').volumeStatus, 'met');
  assert.equal(model.totals.attention, closing.length + 1);
});

test('a stale export is reported as stale', () => {
  assert.equal(model.feeds.export.state, 'stale');
  assert.equal(model.feeds.export.ageDays, 21);
  assert.equal(model.feeds.export.asOf, '2026-10-27');
});

test('the morning alert carries the same numbers as the page', () => {
  const alert = renderAlert(model);
  assert.match(alert, /BEHIND:/);
  assert.match(alert, /E130 4\/25/);
  assert.match(alert, /export last updated 2026-10-27 \(21d old\)/);
});

test('report is deterministic for a fixed clock', () => {
  const again = buildModel({ csvText, eventsJson, now });
  assert.deepEqual(again.groups.closing.map((e) => e.event_id), model.groups.closing.map((e) => e.event_id));
});
