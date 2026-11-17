# Northstar Events — live registration report

One page the events team can open any time: seats against target per event, which events need
attention, and how old the underlying numbers are. Server-rendered HTML, no framework, no client
build step, no database.

**Live:** https://northstar-registration-report-xdkgyu.freebuff.page
**Written answers (Parts 2–5):** [`docs/answers.pdf`](docs/answers.pdf) · [`docs/answers.md`](docs/answers.md)
(submission PDF is generated from the Markdown: `node scripts/build-doc.mjs`, then print `docs/answers.html` to PDF)

```bash
npm install   # one dev dependency: esbuild (bundling only)
npm test      # 13 checks against the real files in data/
npm run dev   # http://localhost:4321
npm run build # dist/worker.js - the deployable bundle
```

Requires Node 20+ (developed on 26).

## Routes

| Route | What |
|---|---|
| `/` | the report |
| `/api/report.json` | the same numbers as JSON (what a CRM or sheet would consume) |
| `/alert.txt` | the weekday morning message, rendered from the same model |
| `/healthz` | 200 + event count, for uptime checks |

## Where the numbers come from

`data/registrations.csv` (export) and `data/events.json` (targets + last night's count). Nothing is
hard-coded in the page. Locally both are read on each request (2s cache), so replacing either file
updates the page on refresh; the deployed Worker has them inlined at build time, so there you rebuild
and redeploy (see [Deploying](#deploying-and-updating-the-live-page)).

**Seats** = accepted registrations, de-duplicated. **Progress** = seats / target. **Pending** is drawn as a
dashed tail — still in play, not a seat. **Cancelled** frees a seat and is never counted as attendance.

### Two source clocks, never blended

The export covers 3 events and its newest registration is 27 Oct — 21 days old, which the page says out
loud (the export job looks stopped, not quiet). The other 5 events only exist in `events.json` as a nightly
count; they show that number, labelled, plus a "Nightly count only" badge. **An event with no export rows is
never rendered as `0/target`** — that would read as "nobody registered" when the truth is "we have no live feed".

Where both exist, the drift is displayed rather than averaged (`E101: 37 accepted in the export, 42 in the
nightly count`). The export is older, so part of that difference is just time. **Closed events** use the
nightly count because it is the newer number — judging a finished event off a three-week-old export would
show E114 as "missed" when it actually finished 46 against a target of 45.

### Needs attention

- Events inside 7 days and short of target → **closing**. Chasing rarely lands a registration in a day, so the
  decision is whether to hold the room or reschedule; the row says how many are missing and how long is left.
- Events further out and short → **campaign**, with the confirmed-per-day rate the gap implies.
- Events on/after their date are **closed** and excluded from attention entirely.

## Messy data: repaired, flagged, or quarantined — never dropped silently

Every change is counted on the page under **Data quality**, and the original CSV row is kept on the record.

| Issue in this export | Rows | What happens |
|---|---|---|
| Blank email | 6 | kept as a seat, flagged `no_email` |
| `name[at]company` obfuscation | 8 | repaired to `@`, flagged |
| Email with no TLD (`grace.tran@harbourins`) | 6 | suffix inferred from the company's own valid emails, flagged |
| Padded/shouting names (`"  DANIEL "`) | 16 | tidied, flagged |
| 9-digit or spaced phone numbers | 25 | converted to E.164, flagged; plain `04…` converts silently |
| Duplicate registrations (same event + email) | 7 | one seat kept, the other listed in the report |
| Duplicate with *conflicting* details (Daniel Khan: two phones, two titles) | 1 | newest kept, conflict listed as an anomaly |
| Same person, two emails (work + personal) | 4 | **counted twice on purpose** — merging identities needs a human decision |
| Registrations dated before the event launched (E125) | 15 | flagged as an events-data problem, not a registrant problem |

Rows that cannot be trusted at all (unknown event, unknown status, unparseable timestamp) are quarantined
with a reason and listed on the page. None in the current file.

Dates use **Australia/Sydney** for "today" and "days to event" — using UTC shifts every number by a day for
most of the working day.

## Keeping it up to date (next step, not built yet)

1. Cron every 15 min → fetch the registration platform's CSV export URL → same clean/dedupe/upsert path.
2. Or the platform's webhook → `POST /api/ingest` (one registration at a time, idempotent on `registration_id`).
3. Manual CSV upload at `/admin` (token-protected) as the always-works fallback.
4. **Freshness watchdog** in the same cron: if no registration is newer than 48h, or the last ingest failed,
   post to the alert webhook and badge the page. Today's 21-day-old export is exactly the failure this
   prevents — a dead feed must not look like a quiet week.

Upserting on `registration_id` is what makes re-running an export safe; this file already contains replayed
IDs (R1210 mirroring R1010), which a naive append would have double-counted.

## Assumptions

- The export is authoritative for the three events it covers; the nightly count is a separate, undocumented
  measure (it sits between accepted and total, so it is not simply "all registrations"). They are shown side
  by side, never combined.
- Pending registrations are not seats.
- Cancelled registrations free capacity.
- `events.json` has no `as_of` field, so the page says "last night" rather than inventing a timestamp.
- One human registering with two addresses is two seats until the events team says otherwise.

## Deploying and updating the live page

The live page is a single Cloudflare Worker (`dist/worker.js`) with no bindings. esbuild inlines
`data/registrations.csv` and `data/events.json` into the bundle, so the Worker has no filesystem, no
database and no secrets — and `npm run dev` and the deployed Worker run the exact same handler.

To update it with a fresh export:

```bash
# 1. replace the files
cp ~/Downloads/registrations.csv data/registrations.csv
# 2. check the numbers still parse and the counts still make sense
npm test
# 3. rebuild and redeploy
npm run build
```

Then run the deploy for the Site (`deploy.json` is the manifest). The page states its own
freshness, so a stale export is visible rather than hidden: replacing the file without redeploying
leaves the old "as of" date on screen.

Site: `northstar-registration-report` — production `https://northstar-registration-report-xdkgyu.freebuff.page`,
preview `https://northstar-registration-report-xdkgyu-preview.freebuff.page`.

Because the data is bundled at build time, there is no write path in production: a scheduled pull,
CSV upload endpoint or webhook would each need a storage binding (D1 or R2). That is the next step,
not something the current deployment pretends to have.

## Not done / if I had more time

- Persistence + ingest endpoint + cron (needs D1 or R2 for writes; today the data is baked into the bundle).
- The weekday morning webhook (the message text is already at `/alert.txt`, ready to POST).
- Per-event drill-down (the attendee list behind each card) and CSV export for the sponsor-list request.
- History: storing each nightly count would let the page show a trend line instead of a single point.

## How I used AI

I used AI for drafting and for arguing with my own reasoning — it helped shape the build plan and the
written answers, and some of the sharper calls (showing "no live feed" instead of `0 / target`, reading the
replayed R1200 IDs as a retried batch) came out of that.

It was also confidently wrong: an early summary said the export had six obfuscated emails; recomputing
from `registrations.csv` gave eight. Every number in the page, the written answers and the Loom was
re-derived by script, and `npm test` pins them. The judgement calls — dedupe on `registration_id`, flagging
work/personal pairs instead of merging them, splitting "closing" from "campaign" — stayed with me.
