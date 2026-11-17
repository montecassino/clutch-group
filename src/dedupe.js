// Three tiers, deliberately different in how much they are allowed to do:
//   1. same registration_id      -> later row wins (upstream replay)
//   2. same event + same email   -> one winner per group, the rest excluded from counts
//   3. same event + same person, different email -> flagged, ALWAYS counted
// A human's two identities is a decision for the events team, not for me.

const SUBSTANTIVE = ['first_name', 'last_name', 'company', 'job_title', 'mobile'];

function conflict(a, b) {
  const differing = SUBSTANTIVE.filter((f) => a[f] !== b[f]);
  if (!differing.length) return null;
  const material = differing.filter((f) => f !== 'mobile' || a[f].length === b[f].length);
  return material.length ? material : null;
}

const registeredAt = (record) => Date.parse(record.registered_at);

// Later timestamp wins; on an exact tie the row that appeared first in the file wins.
function pickWinner(members) {
  let winner = members[0];
  for (const member of members.slice(1)) {
    if (registeredAt(member.record) > registeredAt(winner.record)) winner = member;
  }
  return winner;
}

// Tier 1: collapse replayed registration IDs before anything else, so the counts
// below cannot see two rows claiming to be the same registration.
function collapseReplayedIds(records) {
  const byId = new Map();
  const anomalies = [];

  for (const record of records) {
    const existing = byId.get(record.registration_id);
    if (!existing) {
      byId.set(record.registration_id, record);
      continue;
    }
    anomalies.push({
      kind: 'replayed_id',
      detail: `${record.registration_id} appears twice in the export (rows ${existing.raw.__rowNumber} and ${record.raw.__rowNumber})`,
    });
    const winner = registeredAt(record) >= registeredAt(existing) ? record : existing;
    byId.set(record.registration_id, { ...winner, flags: [...winner.flags, 'replayed_id'] });
  }

  return { records: [...byId.values()], anomalies };
}

// Tier 2: one pass over the records, bucketing by event+email while remembering the
// position of each group's first row. Groups are resolved afterwards, once, with a
// named winner — no array surgery and no dependence on iteration order.
function collapseEmailDuplicates(records) {
  const slots = []; // ordered: either { record } or { group }
  const groups = new Map(); // "event|email" -> group

  records.forEach((record, index) => {
    if (!record.email_norm) {
      // Nothing to match on. Still a seat, emitted where it appears.
      slots.push({ record });
      return;
    }
    const key = `${record.event_id}|${record.email_norm}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, event_id: record.event_id, email_norm: record.email_norm, members: [] };
      groups.set(key, group);
      slots.push({ group });
    }
    group.members.push({ record, index });
  });

  const resolved = [];
  const exclusions = []; // { order, entry, anomaly }

  for (const slot of slots) {
    if (slot.record) {
      resolved.push(slot.record);
      continue;
    }

    const { group } = slot;
    const winner = pickWinner(group.members);
    const losers = group.members.filter((member) => member !== winner);

    for (const loser of losers) {
      const differing = conflict(winner.record, loser.record);
      exclusions.push({
        // Reported where the pair is completed, so the data-quality table reads in
        // the same order as the export itself.
        order: Math.max(winner.index, loser.index),
        entry: {
          key: group.key,
          kept: winner.record.registration_id,
          dropped: loser.record.registration_id,
          event_id: group.event_id,
          reason: differing ? 'conflicting_duplicate' : 'duplicate',
        },
        anomaly: differing
          ? {
              kind: 'conflicting_duplicate',
              detail: `${group.email_norm} (${group.event_id}) has ${differing.join(', ')} differing between ${loser.record.registration_id} and ${winner.record.registration_id}`,
            }
          : null,
      });
    }

    resolved.push(
      losers.length
        ? { ...winner.record, flags: [...winner.record.flags, 'duplicate_excluded'] }
        : winner.record,
    );
  }

  exclusions.sort((a, b) => a.order - b.order);

  return {
    records: resolved,
    excludedDuplicates: exclusions.map((exclusion) => exclusion.entry),
    anomalies: exclusions.map((exclusion) => exclusion.anomaly).filter(Boolean),
  };
}

// Tier 3: report, never merge.
function findPossibleDuplicates(records) {
  const byPerson = new Map();
  for (const record of records) {
    const key = [
      record.event_id,
      record.first_name.toLowerCase(),
      record.last_name.toLowerCase(),
      record.company,
    ].join('|');
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key).push(record);
  }

  const possibleDuplicates = [];
  for (const group of byPerson.values()) {
    if (group.length < 2) continue;
    const emails = new Set(group.map((record) => record.email_norm).filter(Boolean));
    if (emails.size < 2) continue;
    const [first] = group;
    possibleDuplicates.push({
      event_id: first.event_id,
      person: `${first.first_name} ${first.last_name}`,
      company: first.company,
      emails: [...emails],
    });
    for (const record of group) record.flags.push('possible_duplicate');
  }
  return possibleDuplicates;
}

export function dedupe(records) {
  const replayed = collapseReplayedIds(records);
  const emailGroups = collapseEmailDuplicates(replayed.records);
  const possibleDuplicates = findPossibleDuplicates(emailGroups.records);

  return {
    records: emailGroups.records,
    excludedDuplicates: emailGroups.excludedDuplicates,
    possibleDuplicates,
    anomalies: [...replayed.anomalies, ...emailGroups.anomalies],
  };
}
