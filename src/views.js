// Server-rendered HTML. No client framework and no build step: the page is a
// string. It has to be readable on a phone in a hallway, so meaning lives in
// words and numbers first, colour second.
//
// Colour system — one meaning per colour, no exceptions:
//   green  = on track / target met
//   amber  = behind target (needs attention)
//   grey   = finished / no data (nothing to do)
//   red    = the numbers themselves can't be trusted (stale or missing feed)
// What a *number* is (accepted / pending / cancelled) is carried by shape and
// labels instead, so a bar segment can never be confused with a status.

import { formatDate, daysLabel } from './model.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `
:root{
  --ink:#101828;--ink2:#344054;--muted:#667085;--line:#e4e7ec;--bg:#f6f7f9;--card:#fff;
  --ok:#067647;--ok-bg:#ecfdf3;--ok-line:#a9efc5;
  --attn:#b54708;--attn-bg:#fffaeb;--attn-line:#fedf89;
  --data:#b42318;--data-bg:#fef3f2;--data-line:#fecdca;
  --closed:#475467;--closed-bg:#f2f4f7;--closed-line:#d0d5dd;
  --seg:#1d2939;--track:#eaecf0;--link:#175cd3;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1060px;margin:0 auto;padding:28px 20px 64px}
a{color:var(--link)}
code{font-size:.92em;background:#f2f4f7;padding:1px 4px;border-radius:4px}
.brand{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font-size:30px;line-height:1.15;margin:6px 0 6px;letter-spacing:-.02em}
h2{font-size:19px;margin:0 0 12px;letter-spacing:-.01em;display:flex;align-items:baseline;gap:8px}
h2 .count{font-size:13px;font-weight:500;color:var(--muted)}
h3{font-size:15px;margin:0}
.lede{color:var(--ink2);font-size:15px;margin:0 0 4px;max-width:62ch}
.meta{color:var(--muted);font-size:13px}
section{margin-top:26px}

/* colour key */
.key{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:16px;padding:10px 14px;
  background:var(--card);border:1px solid var(--line);border-radius:10px;font-size:13px;color:var(--ink2)}
.key span{display:inline-flex;align-items:center;gap:7px}
.swatch{width:11px;height:11px;border-radius:3px;flex:none}
.swatch.ok{background:var(--ok)}.swatch.attn{background:var(--attn)}
.swatch.closed{background:var(--closed)}.swatch.data{background:var(--data)}

/* feed sources */
.feeds{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.feed{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 15px;display:flex;gap:11px}
.feed.bad{border-color:var(--data-line);background:var(--data-bg)}
.dot{width:9px;height:9px;border-radius:50%;margin-top:6px;flex:none;background:var(--closed)}
.feed.bad .dot{background:var(--data)}
.feed b{display:block;font-size:13.5px;font-weight:600}
.feed.bad b{color:var(--data)}
.feed span{font-size:13px;color:var(--muted)}

/* summary */
.hero{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 16px}
.stat .k{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;
  display:flex;align-items:center;gap:7px}
.stat .v{font-size:28px;font-weight:650;letter-spacing:-.02em;margin-top:4px;font-variant-numeric:tabular-nums}
.stat .s{font-size:13px;color:var(--muted)}

/* status pills */
.pill{display:inline-block;font-size:12px;font-weight:650;padding:2px 9px;border-radius:99px;
  border:1px solid transparent;white-space:nowrap;letter-spacing:.01em}
.pill.ok{background:var(--ok-bg);color:var(--ok);border-color:var(--ok-line)}
.pill.attn{background:var(--attn-bg);color:var(--attn);border-color:var(--attn-line)}
.pill.closed{background:var(--closed-bg);color:var(--closed);border-color:var(--closed-line)}

/* attention */
.attention{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.group+.group{margin-top:20px}
.group h3{font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:2px}
.group p.hint{font-size:13px;color:var(--muted);margin:0 0 8px}
.arow{display:grid;grid-template-columns:1fr auto;gap:2px 14px;align-items:baseline;
  padding:11px 0;border-top:1px solid var(--line)}
.group h3+.arow{border-top:0}
.arow .who{font-weight:600}
.arow .where{color:var(--muted);font-size:13px;font-weight:400}
.arow .num{font-variant-numeric:tabular-nums;font-weight:650;text-align:right;white-space:nowrap}
.arow .num small{font-weight:400;color:var(--muted)}
.arow .why{grid-column:1/-1;font-size:13px;color:var(--ink2)}
.arow .why em{color:var(--muted);font-style:normal}
.empty{color:var(--muted);font-size:14px;padding:6px 0}

/* event cards */
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--closed-line);
  border-radius:14px;padding:16px}
.card.ok{border-left-color:var(--ok)}
.card.attn{border-left-color:var(--attn)}
.card.closed{border-left-color:var(--closed)}
.card-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px}
.when{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.card .name{font-size:16px;font-weight:650;letter-spacing:-.01em;margin:0 0 1px}
.card .where2{font-size:13px;color:var(--muted);margin:0 0 12px}
.figures{display:flex;align-items:baseline;gap:6px;font-variant-numeric:tabular-nums;margin-bottom:8px}
.figures b{font-size:27px;font-weight:680;letter-spacing:-.02em;line-height:1}
.figures .of{color:var(--muted);font-size:14px}
.figures .pc{margin-left:auto;font-size:13px;font-weight:600;color:var(--ink2)}

/* bar: quantity only. Solid = accepted, hatched = pending. Colour is the card's status. */
.bar{position:relative;height:10px;background:var(--track);border-radius:99px;margin:0 0 7px}
.bar .fill{position:absolute;inset:0 auto 0 0;background:var(--seg);border-radius:99px}
.bar .pend{position:absolute;top:0;bottom:0;border-radius:0 99px 99px 0;
  background:rgba(29,41,57,.10);
  background-image:repeating-linear-gradient(135deg,rgba(29,41,57,.55) 0 2px,transparent 2px 5px)}
.bar .mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink2);opacity:.5;border-radius:2px}

/* gap line — the one place status colour appears in prose */
.gap{margin:0 0 11px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.gap.attn{color:var(--attn)}
.gap.ok{color:var(--ok)}
.gap.closed{color:var(--muted)}

/* chips: shape tells you what the number is, never colour */
.chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0 0 11px}
.chip{font-size:12px;padding:2px 9px 2px 7px;border-radius:99px;background:#f9fafb;
  border:1px solid var(--line);color:var(--ink2);display:inline-flex;align-items:center;gap:6px;
  font-variant-numeric:tabular-nums}
.chip::before{content:"";width:9px;height:9px;border-radius:50%;flex:none}
.chip.acc::before{background:var(--seg)}
.chip.pen::before{border:1px solid var(--seg);
  background:linear-gradient(90deg,var(--seg) 50%,transparent 50%)}
.chip.can::before{border:1.5px solid #98a2b3;background:transparent}
.chip.info::before{background:#d0d5dd}

.src{font-size:12.5px;color:var(--muted);margin:0;border-top:1px solid var(--line);padding-top:9px}
.src .tag{display:inline-block;font-size:11px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink2);background:var(--closed-bg);border:1px solid var(--closed-line);
  border-radius:5px;padding:0 5px;margin-right:6px}
.src .tag.fresh{background:var(--ok-bg);border-color:var(--ok-line);color:var(--ok)}

/* data quality */
details.quality{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
details.quality.flagged{border-color:var(--data-line)}
details.quality summary{cursor:pointer;font-weight:600;font-size:15px;display:flex;flex-wrap:wrap;gap:6px;align-items:baseline}
details.quality summary .badge{font-weight:500;color:var(--muted);font-size:13px}
details.quality summary .badge.alert{color:var(--data);font-weight:600}
.qgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0 6px}
.q{background:#fafbfc;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.q b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.q span{font-size:12px;color:var(--muted)}
table{width:100%;border-collapse:collapse;font-size:14px;margin-top:12px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600}
td.n{text-align:right;font-variant-numeric:tabular-nums}
.note{font-size:13px;color:var(--muted);margin-top:10px}

footer{margin-top:34px;border-top:1px solid var(--line);padding-top:16px}
.legend{font-size:13px;color:var(--ink2);line-height:1.7}
.legend b{color:var(--ink);font-weight:650}
.legend .links{color:var(--muted)}

@media (max-width:760px){
  .feeds,.hero,.cards,.qgrid{grid-template-columns:1fr}
  h1{font-size:25px}
  .wrap{padding:20px 14px 48px}
  .arow{grid-template-columns:1fr auto}
}
@media print{
  body{background:#fff}.wrap{max-width:none;padding:0}
  .card,.attention,.stat,.feed,.key{break-inside:avoid}
  details.quality{display:none}
}
`;

function bar(event) {
  const pct = Math.max(0, Math.min(100, event.pct ?? 0));
  const pendingPct = event.hasFeed
    ? Math.max(0, Math.min(100 - pct, Math.round((event.pending / event.target) * 100)))
    : 0;
  return `<div class="bar" role="img" aria-label="${event.basis ?? 0} of ${event.target} seats, ${pct}%${pendingPct ? `, ${pendingPct}% pending` : ''}">
      <div class="fill" style="width:${pct}%"></div>
      ${pendingPct ? `<div class="pend" style="left:${pct}%;width:${pendingPct}%"></div>` : ''}
      <div class="mark" style="left:calc(100% - 2px)"></div>
    </div>`;
}

// Volume status → the only thing colour is allowed to encode.
function tone(event) {
  if (event.volumeStatus === 'met') return 'ok';
  if (event.volumeStatus === 'behind') return 'attn';
  return 'closed';
}

function statusPill(event) {
  if (event.volumeStatus === 'met') return '<span class="pill ok">Target met</span>';
  if (event.volumeStatus === 'behind') return '<span class="pill attn">Behind target</span>';
  return '<span class="pill closed">No count</span>';
}

function gapLine(event) {
  const t = tone(event);
  if (event.basis == null) return `<p class="gap closed">No count for this event yet</p>`;
  if (event.gap <= 0) {
    const over = Math.abs(event.gap);
    return `<p class="gap ok">${over === 0 ? 'Exactly on target' : `${over} over target`}</p>`;
  }
  return `<p class="gap ${t}">${event.gap} short of target</p>`;
}

function card(event) {
  const t = tone(event);
  const chips = event.hasFeed
    ? `<ul class="chips">
        <li class="chip acc">${event.seats} accepted</li>
        <li class="chip pen">${event.pending} pending</li>
        <li class="chip can">${event.cancelled} cancelled</li>
      </ul>`
    : `<ul class="chips"><li class="chip info">${event.basis ?? '—'} from last night's count</li></ul>`;

  const drift =
    event.hasFeed && event.snapshot != null && event.snapshot !== event.seats
      ? ` · last night's count ${event.snapshot}`
      : '';
  const src = event.hasFeed
    ? `<span class="tag">Export</span>last registration ${formatDate(event.feedAsOf)} · ${event.total} rows${drift}`
    : `<span class="tag">Nightly</span>no rows in the export · count from last night`;

  return `<article class="card ${t}">
    <div class="card-top">${statusPill(event)}<span class="when">${daysLabel(event.daysLeft)}</span></div>
    <p class="name">${esc(event.name)}</p>
    <p class="where2">${esc(event.city)} · ${formatDate(event.date)} · ${esc(event.event_id)}</p>
    <div class="figures"><b>${event.basis ?? '—'}</b><span class="of">of ${event.target} seats</span><span class="pc">${event.pct == null ? '' : event.pct + '%'}</span></div>
    ${bar(event)}
    ${gapLine(event)}
    ${chips}
    <p class="src">${src}</p>
  </article>`;
}

function attentionRow(event, kind) {
  const where = `${esc(event.city)} · ${formatDate(event.date)} · ${daysLabel(event.daysLeft)}`;
  const why =
    kind === 'closing'
      ? `The window is nearly shut, so this is a decision about the room, not more outreach.`
      : `Needs about ${event.requiredPerDay ?? '—'} confirmed seats a day to land it — a campaign, not a nudge.`;
  return `<div class="arow">
      <div><div class="who">${esc(event.name)}</div><div class="where">${where}</div></div>
      <div class="num">${event.basis} <small>of ${event.target}</small></div>
      <div class="why">${event.gap} short. ${why}${event.hasFeed ? '' : ' <em>From last night\'s count — no live feed for this event.</em>'}</div>
    </div>`;
}

export function renderPage(model) {
  const { feeds, totals, groups, dataQuality, events } = model;
  const upcoming = events.filter((e) => e.daysLeft >= 0).sort((a, b) => a.daysLeft - b.daysLeft);
  const exportFeed = feeds.export;
  const exportStale = exportFeed.state === 'stale';
  const missingEmail = dataQuality.flags.no_email;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Northstar Events — Registration report</title>
<style>${CSS}</style></head>
<body><div class="wrap">

<header>
  <div class="brand">Northstar Events</div>
  <h1>Registration report</h1>
  <p class="lede">Confirmed seats against target for every upcoming event, and which ones need someone to act today.</p>
  <div class="meta">Today is ${formatDate(model.today)} · rendered ${new Date(model.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour12: false })} Sydney</div>
</header>

<div class="key" aria-label="Colour key">
  <span><i class="swatch ok"></i>On track</span>
  <span><i class="swatch attn"></i>Behind target</span>
  <span><i class="swatch closed"></i>Finished or no data</span>
  <span><i class="swatch data"></i>The numbers can't be trusted</span>
</div>

<section class="feeds">
  <div class="feed ${exportStale ? 'bad' : ''}">
    <div class="dot"></div>
    <div>
      <b>Registration export${exportStale ? ' — out of date' : ''}</b>
      <span>${exportFeed.covers} of ${events.length} events · ${
        exportFeed.asOf
          ? `newest registration ${formatDate(exportFeed.asOf)} (${exportFeed.ageDays} days ago)`
          : 'no export loaded'
      }${exportStale ? ' · this looks like a stopped export, not a quiet week' : ''}</span>
    </div>
  </div>
  <div class="feed">
    <div class="dot"></div>
    <div>
      <b>Nightly count</b>
      <span>${feeds.snapshot.covers} of ${events.length} events · last night · no timestamp in the source file</span>
    </div>
  </div>
</section>

<section class="hero">
  <div class="stat">
    <div class="k"><i class="swatch attn"></i>Needs attention</div>
    <div class="v">${totals.attention}</div>
    <div class="s">${groups.closing.length} closing this week · ${groups.campaign.length} needs a campaign</div>
  </div>
  <div class="stat">
    <div class="k">Seats booked</div>
    <div class="v">${totals.seatsUpcoming}</div>
    <div class="s">across ${upcoming.length} events still to run</div>
  </div>
  <div class="stat">
    <div class="k">Next event</div>
    <div class="v">${totals.nextEvent ? daysLabel(totals.nextEvent.daysLeft) : '—'}</div>
    <div class="s">${totals.nextEvent ? `${esc(totals.nextEvent.name)} · ${esc(totals.nextEvent.city)}` : 'nothing scheduled'}</div>
  </div>
</section>

<section class="attention">
  <h2>Needs attention <span class="count">${totals.attention}</span></h2>
  <div class="group">
    <h3>Closing this week</h3>
    <p class="hint">Events inside seven days that are short of target.</p>
    ${groups.closing.length ? groups.closing.map((e) => attentionRow(e, 'closing')).join('') : '<div class="empty">Nothing short of target inside the next seven days.</div>'}
  </div>
  <div class="group">
    <h3>Needs a campaign</h3>
    <p class="hint">Events further out that are behind, where sustained outreach can still close the gap.</p>
    ${groups.campaign.length ? groups.campaign.map((e) => attentionRow(e, 'campaign')).join('') : '<div class="empty">Nothing behind with more than a week to go.</div>'}
  </div>
</section>

<section>
  <h2>Upcoming events <span class="count">${upcoming.length}</span></h2>
  <div class="cards">${upcoming.map(card).join('')}</div>
</section>

<section>
  <details class="quality ${exportStale ? 'flagged' : ''}">
    <summary>Data quality
      <span class="badge">${dataQuality.duplicatesExcluded.length} duplicates removed</span>
      <span class="badge">${missingEmail} registrations have no email</span>
      <span class="badge ${exportStale ? 'alert' : ''}">${exportStale ? `export is ${exportFeed.ageDays} days old` : 'export current'}</span>
    </summary>
    <div class="qgrid">
      <div class="q"><b>${dataQuality.rowsRead}</b><span>rows in the export</span></div>
      <div class="q"><b>${dataQuality.uniqueRows}</b><span>after removing duplicates</span></div>
      <div class="q"><b>${dataQuality.flags.no_email + dataQuality.flags.email_obfuscated + dataQuality.flags.email_inferred_tld + dataQuality.flags.email_needs_review}</b><span>emails repaired or unusable</span></div>
      <div class="q"><b>${dataQuality.preLaunchRows}</b><span>registrations dated before launch</span></div>
      <div class="q"><b>${dataQuality.flags.email_obfuscated}</b><span>obfuscated <code>[at]</code> emails repaired</span></div>
      <div class="q"><b>${dataQuality.flags.email_inferred_tld}</b><span>missing domain suffix inferred</span></div>
      <div class="q"><b>${dataQuality.flags.phone_repaired}</b><span>phone numbers repaired</span></div>
      <div class="q"><b>${dataQuality.flags.name_reformatted}</b><span>names tidied (padding/case)</span></div>
    </div>

    <h3 style="margin-top:18px">Export vs last night's count</h3>
    <table>
      <thead><tr><th>Event</th><th class="n">Export (accepted)</th><th class="n">Last night</th><th class="n">Difference</th></tr></thead>
      <tbody>${dataQuality.drift
        .map(
          (d) =>
            `<tr><td>${esc(d.name)} <span class="meta">${esc(d.event_id)}</span></td><td class="n">${d.seats}</td><td class="n">${d.snapshot}</td><td class="n">${d.difference > 0 ? '+' : ''}${d.difference}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
    <p class="note">The two sources measure different things and are never blended. The export is older, so some of every gap is just time.</p>

    <h3 style="margin-top:18px">Duplicates removed</h3>
    <table>
      <thead><tr><th>Kept</th><th>Dropped</th><th>Event</th><th>Reason</th></tr></thead>
      <tbody>${dataQuality.duplicatesExcluded
        .map(
          (d) =>
            `<tr><td>${esc(d.kept)}</td><td>${esc(d.dropped)}</td><td>${esc(d.event_id)}</td><td>${esc(d.reason.replace(/_/g, ' '))}</td></tr>`,
        )
        .join('')}</tbody>
    </table>
    ${
      dataQuality.possibleDuplicates.length
        ? `<h3 style="margin-top:18px">Possible duplicates — counted, not merged</h3>
           <table><thead><tr><th>Person</th><th>Company</th><th>Event</th><th>Emails</th></tr></thead><tbody>
           ${dataQuality.possibleDuplicates
             .map(
               (d) =>
                 `<tr><td>${esc(d.person)}</td><td>${esc(d.company)}</td><td>${esc(d.event_id)}</td><td>${d.emails.map(esc).join(' · ')}</td></tr>`,
             )
             .join('')}</tbody></table>
           <p class="note">Same name and company, different address — probably one person who registered twice with work and personal email. Left as two seats because merging identities needs a human decision.</p>`
        : ''
    }
    ${dataQuality.quarantined.length ? `<p class="note">${dataQuality.quarantined.length} rows quarantined: ${dataQuality.quarantined.map((q) => esc(q.reason)).join(', ')}.</p>` : ''}
  </details>
</section>

<section>
  <h2>Finished</h2>
  <table>
    <thead><tr><th>Event</th><th>Date</th><th class="n">Final</th><th class="n">Target</th><th>Result</th></tr></thead>
    <tbody>${groups.closed
      .map(
        (e) =>
          `<tr><td>${esc(e.name)} <span class="meta">${esc(e.city)}</span></td><td>${formatDate(e.date)}</td><td class="n">${e.basis ?? '—'}</td><td class="n">${e.target}</td><td>${
            e.volumeStatus === 'met'
              ? '<span class="pill ok">Target met</span>'
              : e.volumeStatus === 'missed'
                ? '<span class="pill closed">Closed short</span>'
                : '<span class="pill closed">No count</span>'
          }</td></tr>`,
      )
      .join('')}</tbody>
  </table>
</section>

<footer class="legend">
  <p><b>Seats</b> are accepted registrations after duplicates are removed. In each bar the solid part is accepted seats and
  the hatched part is pending registrations, which are not seats yet — pending and cancelled are shown as chips under the bar.
  Events with no rows in the export show <b>last night's count</b> instead, labelled on the card; they are never shown as zero.</p>
  <p><b>Closing</b> events are inside seven days and short of target: chasing rarely lands a registration in a day, so the decision is
  whether to hold the room or reschedule. Events further out are <b>campaigns</b>. Finished events are listed at the bottom and excluded
  from attention.</p>
  <p class="links">Sources: <code>registrations.csv</code> (export) and <code>events.json</code> (targets + nightly counts) · <a href="/api/report.json">JSON</a> · <a href="/alert.txt">morning alert text</a></p>
</footer>

</div></body></html>`;
}
