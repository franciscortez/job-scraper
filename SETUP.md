# SETUP.md — Technical Setup and System Reference

This is the technical companion to `README.md`. `README.md` is for daily use in plain language. This file is for installation, commands, architecture, and troubleshooting.

Project: Google Sheets job tracker for OnlineJobs.ph, built locally with Node.js and deployed with clasp to Google Apps Script.

## 1. Prerequisites

- Node.js 20 or newer.
- A Google account with access to the target spreadsheet.
- Google Apps Script API enabled at <https://script.google.com/home/usersettings>.
- Local files: `.clasp.json` must exist and keep `rootDir` set to `dist`. Do not commit `.clasp.json`, credentials, `node_modules/`, or `dist/`. They are git-ignored.

Current installation reference:

- Spreadsheet ID `1tM6MzR-ol3Njd5wvhrf8VrPPaOu6LY9ytVlkGJaY5JQ`
- Script ID `1hRAfASmKOBGZH6MaEwSMjNGI0s5mF_-xf8oYNHkq9OSuyBT_sb7VMHAb`

## 2. Command reference

All commands run from the repo root.

| Command | What it does |
|---------|--------------|
| `npm ci` | Clean install from `package-lock.json`. Run first after cloning. |
| `npm test` | Run all local tests with `node --test`. Mocks Google services. No cloud access. |
| `npm run build` | Bundle `src/app.js` plus `htmlparser2` with esbuild into `dist/Code.js`, copy `appsscript.json` to `dist/appsscript.json`, then verify Apps Script entrypoints load in a clean VM context without Node or browser globals. |
| `npm run check` | `npm test && npm run build`. Required gate before pushing. |
| `npm run push` | `npm run check && clasp push`. Rebuilds, tests, then uploads `dist/` to Apps Script. Does not commit or push git changes. |
| `npm run open` | `clasp open-script`. Opens the bound Apps Script project in the browser. |
| `npm exec clasp -- login` | Authenticate clasp with your Google account. |
| `npm exec clasp -- create-script --type sheets --title "OnlineJobs Job Tracker" --rootDir dist` | Create a new spreadsheet-bound script once for a fresh install. Do not run this if `.clasp.json` already exists. Reuse the existing project. |
| `npm exec clasp -- push --force` | Force upload when clasp reports “Skipping push” or asks about replacing `appsscript.json`. Accept the manifest replacement for this project. Use only after `npm run check` passes. |
| `npm exec clasp -- open` | Same as `npm run open`. Direct clasp alternative. |

Typical flows:

```sh
# First time on a machine
npm ci
npm exec clasp -- login

# New spreadsheet + script, only once
npm exec clasp -- create-script --type sheets --title "OnlineJobs Job Tracker" --rootDir dist
npm run push
npm run open

# Normal code change
npm run check
npm run push
```

## 3. Apps Script manual steps

`npm run push` only uploads code. You must finish setup inside Google:

1. In the Apps Script editor, select function `setup` and run it. Complete the OAuth flow for spreadsheet access, external requests, and triggers.
2. Reload the spreadsheet. Confirm the **Job Tracker** menu appears. Do not manually run `onOpen` from the editor. It only runs on spreadsheet open to build the menu.
3. In the **Searches** sheet, review Enabled, Keywords, Employment Type, Max Pages. Blank keywords are skipped.
4. Click **Job Tracker > Run now**. Confirm rows appear in the employment tabs and **Runs** says Success.
5. Run again. Confirm no duplicates and existing rows update.
6. Click **Job Tracker > Enable hourly refresh**. Confirm a later scheduled run appears in **Runs**. Use **Disable hourly refresh** to stop it.
7. For auth failures, platform timeouts, or missing log rows, check the Apps Script **Executions** page, not just the **Runs** sheet.

Menu functions exposed as globals by `scripts/build.mjs`:

- `onOpen`
- `setup`
- `runScraper`
- `enableHourlyRefresh`
- `disableHourlyRefresh`

## 4. How the system works

### 4.1 Repository layout

- `src/app.js`: the six public Apps Script entrypoints, wrapped with operation logging. `src/scraper/scraper.js` orchestrates validation, cleanup, collection, verification, saving, and cursor persistence.
- `src/config/settings.js`: headers, named row indexes/sheet columns, defaults, and run limits. `src/scraper/searches.js` handles search validation and rotation; `src/jobs/matching.js` handles skill evidence and ranking.
- `src/scraper/parsing.js`: source HTML parsing and availability inspection. `src/scraper/collection.js` and `src/scraper/verification.js` drive requests through `src/platform/requests.js`, which preserves search/detail pacing and response policies.
- `src/jobs/job-rows.js`: retention and row mapping. `src/spreadsheet/sheets.js`: spreadsheet validation, formatting, cleanup, and writes. `src/spreadsheet/profile.js`: existing profile migration. `src/spreadsheet/operations.js`: setup and trigger controls. `src/platform/runtime.js`: lock and Google request adapters.
- `src/logging/logging.js`: best-effort JSON console logging with one execution ID per entrypoint call. `src/core.js` retains compatibility exports for existing consumers.
- `scripts/build.mjs`: esbuild bundle. Entry `src/app.js`, output `dist/Code.js` as IIFE with `globalName: JobTracker`, `platform: neutral`, `target: es2020`. Appends global wrappers for the six entrypoints. Copies `appsscript.json` to `dist/`. Runs a `node:vm` smoke check that all entrypoints exist.
- `appsscript.json`: manifest. `timeZone: Asia/Manila`, `runtimeVersion: V8`, `exceptionLogging: STACKDRIVER`, OAuth scopes `spreadsheets.currentonly`, `script.external_request`, `script.scriptapp`.
- `.clasp.json`: clasp project binding. `scriptId`, `parentId` spreadsheet ID, `rootDir: dist`.
- `.claspignore`: uploads only `Code.js` and `appsscript.json`. Everything else in `dist/` is ignored.
- `test/`: `core.test.js` for parser, searches, merge, collector behavior; `app.test.js` for setup, scraping, triggers, retention, migration with mocked Google services; `profile.test.js` for resume matching, 14-day boundary, inspection, and verification; `fixtures/search.html` for source-shaped markup.
- `dist/`: build output. Generated, not committed.

### 4.2 Runtime flow in `runScraper`

1. Acquire script lock via `LockService.getScriptLock().tryLock(1000)`. On contention, log a Skipped row and return. This blocks concurrent manual and timed runs.
2. Validate IDs across all employment tabs with `mergeJobs(beforeCleanup, [], started)`. Missing or duplicate numeric IDs throw before any network call.
3. Delete expired rows bottom-up with `expiredRow(row, now)`. Counts removals for the **Runs** `Removed (14 days old)` column. Cleanup runs even with searches disabled or later fetch failure.
4. Reset surviving rows column N Availability to `Unknown` so stale Open state cannot pass as current. Re-apply the Open-only filter.
5. Run `applyProfile` migration, then `readSearches` to validate enabled searches, then `selectSearches(searches, secondarySearchCursor)` to pick at most 5 searches for this run: preferred-skill searches first up to 4, plus rotated secondary searches. This rotates through large search lists across runs.
6. If no valid searches, log Skipped and stop without fetching.
7. `collect(searches, io, start)`:
   - Builds search URLs with `searchUrl`. Type All requests `gig=on&partTime=on&fullTime=on`. Other types request one flag.
   - Validates pagination URLs with `safeSearchUrl`. Only `https://www.onlinejobs.ph/jobseekers/jobsearch` with optional page and query is allowed.
   - Sleeps at least 1000 ms between attempts, retries HTTP 5xx twice, stops whole run on HTTP 401, 403, 429 or access challenge. Does not follow redirects. Enforces shared 240000 ms budget.
   - Parses cards with class `jobpost-cat-box` via `parsePage`. Requires job ID from `/jobseekers/job/<slug>-<id>` and non-empty title. Throws on changed markup unless body shows explicit `Displaying 0 out of 0 job`. Merges overlapping results across searches with accumulated `matches` labels.
8. Build candidate map from surviving sheet rows plus fresh `recent` results. `recent` filter requires valid Manila `postedTime`, not future, age less than `RETENTION_MS`. Relevance and skill checks happen later in `inspectJob` and `rankMatch`. New rows with missing, invalid, future, or already-expired dates are never inserted.
9. `verifyJobs(candidates, io, start, { preferred: preferredJobCursor, secondary: secondaryJobCursor })` unless collection set `stop`, in which case verification is skipped:
   - Deduplicates by ID, sorts descending numeric ID for stable cursor rotation.
   - Splits preferred candidates, those matching `PREFERRED_SKILLS` (`Next.js`, `Codex`, `Claude Code`, `Supabase`), from secondary. Preferred get priority: `min(preferred.length, 38 + max(0, 12 - secondary.length))`, total capped at `MAX_JOB_CHECKS_PER_RUN = 50`.
   - Fetches each detail URL validated by `safeJobUrl`. Same sleep, retry, block-stop, and 4-minute budget rules as collection.
   - `inspectJob` returns Closed on HTTP 404 or 410, or on closed/filled/expired/no-longer-available wording in title, headings, alerts, or description. Throws on access challenge, identity mismatch (`h1.job__title[data-jobid]` and `#job-description[data-jobid]` must equal job ID), missing detail markup, or missing application control (`Please login or register as jobseeker to apply for this job.` or `Apply now` / `Apply for this job`). Otherwise requires type in `Full Time`, `Part Time`, `Gig`, `Any` and at least one resume skill from `rankMatch`. Success returns Open plus title, type, skills, score, reason, location.
   - Failures become Unknown, never Open. Errors accumulate. `stop` errors break the batch. Returns `limited: true` when candidates exceed the 50 selected checks.
10. Keep only `recent` jobs whose verification state is Open, using verified title and type.
11. Re-read all employment tabs after network work so edits made during fetching survive. Call `mergeJobs(existing, accepted, now)`. Preserve First Seen, Status, Notes. Accumulate Matched Searches historically. Then overwrite Availability, Last Checked, Matched Skills, Match Score, Match Reason, Match Location from verification results.
12. Expand sheet capacity if needed, write existing rows columns A–K only so Status and Notes cells are never rewritten, append new rows full-width, write columns N–S Availability, Last Checked, Matched Skills, Match Score, Match Reason, Match Location, re-apply number format on Match Score, sort used rows by Match Score descending then Posted Date descending then Job ID descending with tracking columns attached, re-apply Open filter, flush.
13. Persist `preferredJobCursor` and `secondaryJobCursor` from `verification.cursors`, persist `secondarySearchCursor` from `selection.cursor` when collection did not stop. Set outcome: Failed on throw or zero pages with partial errors, Partial when errors exist but some pages succeeded, Limited when clean but candidates remain, Success otherwise. Append **Runs** row with start, duration, searches processed, pages fetched, added, updated, result, error text, removed. Toast summary.

### 4.3 Matching and scoring

- `isRelevantRole`: title matches developer, software engineer, full-stack, front-end, back-end, programmer, automation, integration, workflow, apps script, or snippet plus detail contains build/develop/implement/maintain/debug/write within 100 chars before app/application/software/website/API/code/script.
- `PROFILE_SKILLS` patterns: Next.js, React, TypeScript, JavaScript, Node.js, Supabase, Laravel, PHP, Python, Express.js, Flask, PostgreSQL, MySQL, MongoDB, Tailwind CSS, REST APIs, Webhooks, Apps Script, PayMongo, Claude Code, Codex.
- `rankMatch`: zero score and empty skills when not a relevant role. Otherwise preferred skills score 5, others score 1, plus 3 for affirmative AI-assisted coding, vibe-coding, or AI-powered development sentence in title, summary, or description. Negated sentences with no, not, never, without, prohibited, forbidden, disallowed do not count. Returns skills, score, semicolon-joined reason and location strings.
- n8n and GoHighLevel, including GHL and Go High Level, have no skill patterns, so they never match alone. They are also cleared from saved searches on migration. Listings mentioning them can still pass through another skill such as React.
- `cell` prefixes `=`, `+`, `-`, `@`, including leading whitespace, with a single quote so scraped text is stored literally and cannot execute as a Sheet formula.

### 4.4 Sheets schema

- **Searches** `SEARCH_HEADERS = ['Enabled', 'Keywords', 'Employment Type', 'Max Pages']`. `readSearches` accepts checkbox true or string `true`, trims keywords, defaults missing pages to 3, enforces type in `All`, `Full Time`, `Part Time`, `Gig` and integer pages 1–3, deduplicates by normalized keyword plus type. Duplicate searches collapse to one.
- **Part Time, Full Time, Gig, Any** share `JOB_HEADERS = ['Job ID', 'Title', 'URL', 'Salary Text', 'Employment Type', 'Posted Date Text', 'Description Snippet', 'Skills', 'Matched Searches', 'First Seen', 'Last Seen', 'Status', 'Notes', 'Availability', 'Last Checked', 'Matched Skills', 'Match Score', 'Match Reason', 'Match Location']`. `STATUSES = ['New', 'Saved', 'Applied', 'Interviewing', 'Rejected', 'Archived']`. Availability values are Open, Closed, Not a match, Unknown. Default job-tab filter shows only Open.
- **Runs** `RUN_HEADERS = ['Start Time', 'Duration (seconds)', 'Searches Processed', 'Pages Fetched', 'Added', 'Updated', 'Result', 'Error', 'Removed (14 days old)']`. Result values are Success, Partial, Limited, Failed, Skipped.
- `setup` creates missing tabs, freezes header row, styles headers bold with `#d9ead3` background and wrap, sets column widths, creates full-width filters, adds checkbox validation for Enabled, dropdowns for Employment Type and Max Pages 1–3, dropdown for Status, date formats for First Seen, Last Seen, Last Checked, Start Time, integer format for Match Score, and wrap for long text.
- Legacy migration: 16-column and 13-column Jobs plus 8-column Runs headers auto-extend when old prefix matches and trailing cells are empty. Other header changes throw and require manual restore.

### 4.5 Search profile seeding and migration

- `DEFAULT_SEARCHES`: `developer`, `React`, `Supabase`, `Laravel`, `automation`, `Next.js`, `Codex`, `Claude Code`, `Google Apps Script`, each `[true, keyword, 'All', 1]`.
- Document property `resumeSearchesVersion`:
  - Missing or unrecognized: clear Searches and seed all `DEFAULT_SEARCHES`, then run banned-keyword cleanup.
  - `1`: migrate non-blank keyword rows Employment Type to All, preserve keywords, enabled flags, page limits.
  - `2` or `3`: keep rows, run banned-keyword cleanup plus missing-search backfill below.
  - `4`: current, no-op.
- Banned-keyword cleanup scans column B for `n8n`, `gohighlevel`, `go high level`, `ghl` and replaces matching rows columns A–B with `[false, '']`, preserving type and pages. Runs on setup and every `runScraper` via `applyProfile`.
- Missing-search backfill appends any `DEFAULT_SEARCHES` keyword not already present, without touching user edits. Then clears legacy cursor properties `jobCheckCursor`, `preferredJobCursor`, `secondaryJobCursor`, `secondarySearchCursor` and sets version to `4`.

### 4.6 Retention rule, exact definition

- `RETENTION_MS = 14 * 24 * 60 * 60 * 1000`.
- `postedTime(text)` accepts only `YYYY-MM-DD HH:MM:SS`, interprets it as Asia/Manila `+08:00`, rejects impossible dates and non-round-tripping values.
- `expiredRow(row, now)`: prefers posted timestamp column F, falls back to First Seen column J when posted is unreadable, only for existing rows. If both unknown, returns false and keeps row hidden rather than guessing age.
- Expiration condition is `now - date >= RETENTION_MS`. Deletion happens during refresh, not by timer. Enable hourly refresh for automatic cleanup.

### 4.7 Triggers, timezone, and safety limits

- Timezone fixed to `Asia/Manila` in manifest and on spreadsheet during setup.
- `enableHourlyRefresh` requires at least one valid search, creates one hourly `runScraper` trigger, deletes duplicates, keeps unrelated triggers. One Google account manages only its own triggers.
- `disableHourlyRefresh` deletes all `runScraper` triggers for the current account.
- Request pacing minimum 1 second, 5xx retried twice with exponential backoff, 401, 403, 429 and Cloudflare or access-denied titles stop run, redirects never followed.
- Shared 4-minute network budget for collection plus verification, leaving time for Sheet writes before Apps Script quota kills execution.
- Formula injection guard via leading-quote escaping. Unexpected search markup is an error, not silent empty success.

## 5. Testing and verification checklist

```sh
npm test
npm run build
npm run check
```

- `npm test` covers parser fixtures, settings validation, deduplication, tracking preservation, safe text, pagination, retries, access blocks, time budgets, resume matching, employment types, closure signals, exact 14-day cutoff, schema migration, repeat setup, trigger management, and Sheet service interactions.
- Local tests mock Google services. Before relying on automation, verify in the real spreadsheet: manual run, repeat run with no duplicates, edited Status and Notes survive, scheduled run fires, expired rows delete, Runs logs Success or expected Limited or Partial.
- The refactor passes 60 tests, including JSON record validation, shared execution IDs, progress totals, retries, source failures, and logging failures. Existing tests cover nine defaults, version-4 migration, search rotation, and sorting with custom columns. The build also verifies all six entrypoints in a clean VM. This does not replace a live Apps Script execution check.

## 6. Troubleshooting

- Check **Runs** first. Error column holds joined search, fetch, verification, and budget messages. Removed column holds expired-row count.
- `Another tracker operation is running`: lock contention. Wait and retry. Contended runs log Skipped without fetching.
- `Missing <name> tab. Run setup first.`: run `setup` from Apps Script editor.
- `<name> headers changed. Restore original header order.`: restore exact header names and order. Setup does not silently repair renamed headers.
- `Jobs contains missing or duplicate IDs.`: restore numeric unique IDs before refreshing.
- `Searches row N: use supported employment type and Max Pages 1–3.`: fix dropdown value.
- `No enabled searches with keywords.`: enable at least one row with non-blank keywords.
- `HTTP 401/403/429` or `Access challenge received`: Google-hosted requests blocked. Keep scheduling disabled. Project does not bypass challenges or add external scraping infrastructure.
- `Four-minute budget reached`: normal under load. Reduce Max Pages to 1, let cursor rotate across runs.
- Clasp `Skipping push`: run `npm run check` then `npm exec clasp -- push --force`.
- Platform timeouts or missing log rows: check Apps Script **Executions** page.

References: [OnlineJobs.ph search](https://www.onlinejobs.ph/jobseekers/jobsearch), [clasp](https://github.com/google/clasp), [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas), [UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app).


## JSON execution logs

Each entrypoint emits `console.log(JSON.stringify(record))`. Records contain `timestamp` (UTC ISO), `executionId`, `operation`, `level`, `event`, and a structured `details` object. The same execution ID connects request events to the final summary. Function return values and the Runs tab remain unchanged.

Example job decision:

```json
{"timestamp":"2026-09-08T04:00:00.000Z","executionId":"example-run","operation":"runScraper","level":"info","event":"job.checked","details":{"jobId":"12345","availability":"Open","score":10,"skills":["Next.js","Supabase"]}}
```

Events follow the scraper stages:

- `operation.started`, `operation.completed`, `operation.failed`: entrypoint lifecycle, including errors before a spreadsheet can be opened.
- `cleanup.completed`, `searches.selected`, `search.started`, `search.page`, `search.completed`, `collection.completed`, `candidates.prepared`: discovery progress and counts.
- `request.completed`, `request.retry`, `search.failed`: HTTP status, retry attempt, and failures. Requests include a search label/page or job ID; response bodies are omitted.
- `verification.batch`, `job.checked`, `verification.completed`, `verification.skipped`, `verification.budget_exhausted`: selected batch, each attempted job's availability and score, and stop conditions.
- `jobs.saved`, `cursors.saved`, `scraper.skipped`, `scraper.failed`, `scraper.completed`: persistence and final outcome. The scraper summary includes duration in milliseconds, pages, checked jobs, added, updated, removed, and errors. A failure before scraper initialization is reported by `operation.failed` instead.

Logs omit raw HTML, full descriptions, tracking notes, and resume contact details. A failed console sink cannot interrupt scraping. Detailed logs add diagnostics without adding network requests. Cloud verification is still required after uploading this local refactor.


### Manual Jobs reset

`clearJobs` is an explicit editor function, separate from setup and scheduled scraping. It uses the same lock as scraping, validates employment-tab headers, clears all data below each employment-tab header across used columns, resets rotation cursors, and emits `jobs.cleared` with removed and remaining counts. It preserves Searches, Runs, formatting, and the header. Existing hourly refresh can populate jobs again on its next run.

The software-focus update was uploaded through clasp. Remote `clearJobs` execution returned Google storage `NOT_FOUND`; the live Jobs reset was not verified. Run `clearJobs` from the bound Apps Script editor to perform the reset.

### Direct employment tables

`src/spreadsheet/job-tabs.js` owns migration and cross-tab storage. Part Time, Full Time, Gig, and Any contain actual records with editable Status and Notes. Formula views have been removed. Setup preflights target ownership, preserves tracking and custom values from legacy Jobs, verifies migrated records, rechecks the source for concurrent edits, and only then deletes Jobs. A conflicting record or failed copy leaves Jobs intact. Existing generated view tabs are converted during this migration.

All tab IDs are checked together before fetching. Newly verified records route by employment type. A verified type change moves its row with tracking and custom cells; source deletion follows destination verification. If a write fails during a move, the source remains available; resolve any duplicate IDs before retrying. Retention, wrapping, sorting and clearing operate on every job tab.

50 unique detail checks are shared across all tabs. Preferred candidates receive up to 38 slots and secondary candidates 12, sharing unused capacity. The four-minute budget, retries, and query limits remain unchanged. No guarantee of 50 new records per run.

Scheduling remains explicit: `enableHourlyRefresh` creates an hourly trigger for the current account and `disableHourlyRefresh` removes it. Setup does not alter scheduling. Cloud API execution has returned `NOT_FOUND`, so run setup and enableHourlyRefresh from the bound editor and verify subsequent scheduled executions.


### Restore the original job layout

The two-status/hidden-column change has been withdrawn. All A–S job columns are visible, with original Status in L and the original status options. Setup can restore a partially moved H Status column without rebuilding or deleting job records. Any already-converted Not Applied value becomes New; existing other values are preserved. Statuses previously collapsed into Applied cannot be reconstructed automatically.
