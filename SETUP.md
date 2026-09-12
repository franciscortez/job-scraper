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
5. Run again. Confirm no duplicates, existing cells stay unchanged, and employment tabs sort by posting date descending.
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

- `src/app.js`: the six public Apps Script entrypoints, wrapped with operation logging. `src/scraper/scraper.js` orchestrates validation, Applied transfers, discovery, verification of unseen IDs, appending, date sorting, and cursor persistence.
- `src/config/settings.js`: headers, named row indexes/sheet columns, defaults, and run limits. `src/scraper/searches.js` handles search validation and rotation; `src/jobs/matching.js` handles skill evidence and ranking.
- `src/scraper/parsing.js`: source HTML parsing and availability inspection. `src/scraper/collection.js` and `src/scraper/verification.js` drive requests through `src/platform/requests.js`, which preserves search/detail pacing and response policies.
- `src/jobs/job-rows.js`: date parsing and row construction. `src/spreadsheet/sheets.js`: spreadsheet validation, formatting, filter migration, and native whole-row date sorting. `src/spreadsheet/profile.js`: existing profile migration. `src/spreadsheet/operations.js`: setup and trigger controls. `src/platform/runtime.js`: lock and Google request adapters.
- `src/logging/logging.js`: best-effort JSON console logging with one execution ID per entrypoint call. `src/core.js` retains compatibility exports for existing consumers.
- `scripts/build.mjs`: esbuild bundle. Entry `src/app.js`, output `dist/Code.js` as IIFE with `globalName: JobTracker`, `platform: neutral`, `target: es2020`. Appends global wrappers for the six entrypoints. Copies `appsscript.json` to `dist/`. Runs a `node:vm` smoke check that all entrypoints exist.
- `appsscript.json`: manifest. `timeZone: Asia/Manila`, `runtimeVersion: V8`, `exceptionLogging: STACKDRIVER`, OAuth scopes `spreadsheets.currentonly`, `script.external_request`, `script.scriptapp`.
- `.clasp.json`: clasp project binding. `scriptId`, `parentId` spreadsheet ID, `rootDir: dist`.
- `.claspignore`: uploads only `Code.js` and `appsscript.json`. Everything else in `dist/` is ignored.
- `test/`: `core.test.js` for parser, searches, merge, collector behavior; `app.test.js` for setup, scraping, triggers, append-only preservation, date sorting, migration with mocked Google services; `profile.test.js` for resume matching, posting-date parsing, inspection, and verification; `fixtures/search.html` for source-shaped markup.
- `dist/`: build output. Generated, not committed.

### 4.2 Runtime flow in `runScraper`

1. Acquire the script lock. Contention logs Skipped without fetching or writing job data.
2. Open and validate employment tabs and Applications. Legacy job-layout repairs belong to explicit setup; ordinary refresh does not rewrite Status values.
3. Move Applied rows to Applications before fetching, even with disabled searches. Preserve user formulas with native `copyTo({contentsOnly:true})`; compare R1C1 formulas separately from literal values, ignoring recalculated formula results. Verify destination and re-read source values/formulas before deleting the source copy. An incomplete formula copy retains the source and reports a conflict instead of accepting flattened values. Last Seen records transfer time. Interrupted matching transfers resume; conflicts preserve both copies and stop the run.
4. Open and validate the Expired IDs ledger. The `expiredIdsSheet` document property records its identity; missing, replaced, empty, or malformed initialized history blocks refresh. After Applied transfers, remove expired discovery rows, recording each ID durably before deletion and rechecking physical row identity/status. Build the known-ID set from discovery, Applications, and Expired IDs. Cleanup runs even when searches are disabled or fetching fails.
5. On the first updated setup or refresh, remove the old Availability `TEXT_EQUAL_TO Open` criterion once per tab. Preserve other criteria and stored availability. Later user filters remain intact. Extend filter ranges as capacity grows.
6. Apply the existing search-profile migration and select at most five enabled searches: up to four preferred searches, plus rotating secondary searches. With none enabled, log Skipped without fetching.
7. Collect selected search pages, combining duplicate IDs and matched search labels. Preserve URL validation, markup checks, request pacing, two retries for 5xx, access-block stops, and the shared three-minute run target.
8. Exclude all known IDs before detail verification. New candidates need valid Manila posting dates, not in the future, less than `RETENTION_MS` old. Missing/invalid/older dates are rejected only for new additions.
9. Verify at most 50 unique unseen candidates. Preferred candidates receive up to 38 slots, secondary 12, with unused slots shared. Independent ID cursors rotate candidates. Candidates must have matching identity, a supported employment type, technical skill relevance, and an application control to qualify as Open. Closed, unknown, and nonmatching candidates are not appended.
10. Re-read all employment tabs and Applications after fetching. Exclude newly inserted IDs before writing, so concurrent user insertions are not duplicated.
11. Construct only new rows; set First Seen and Last Seen at insertion, Status to New, and availability/ranking fields from verification. Append beneath the last occupied row in the verified employment tab. Existing cells are never rewritten from scraper snapshots.
12. Persist search and candidate cursors. After nonfailed discovery, including runs adding zero rows, sort each employment tab by posting timestamp descending, then numeric Job ID descending. Invalid/missing historical dates go last, followed by empty rows. Journal temporary columns in `pendingJobSort:<sheetId>` before insertion and mark both headers with a unique token before writing keys. Native whole-row sorting includes all custom cells and formulas. Recovery runs before job records are read and verifies journal phase, grid width, and both markers before deleting helpers. A lost response before insertion or after deletion clears only the journal when the original width is restored; ambiguous columns are retained and refresh fails. Applications is not sorted.
13. Log the outcome by inserting the Runs summary directly below the header, newest first. `updated` remains zero; `removed` reports discovery expiry deletions; historical Runs columns are retained. JSON `candidates.prepared` and `scraper.completed` include `skippedKnown`. Toast reports additions, excluded IDs skipped, Applied transfers, and expired jobs removed.

A failed append can leave successfully saved rows. The next run reads their IDs and skips them. No rollback clears job data. If a write succeeds but its response fails, that run's added count can be lower than the actual saved count; inspect rows and the failure log before retrying. Failed source requests never reset saved availability. Discovery cleanup occurs before fetching; Applications history is exempt.

### 4.3 Matching and scoring

- `isRelevantRole`: title matches developer, software engineer, full-stack, front-end, back-end, programmer, automation, integration, workflow, apps script, or snippet plus detail contains build/develop/implement/maintain/debug/write within 100 chars before app/application/software/website/API/code/script.
- `PROFILE_SKILLS` patterns: Next.js, React, TypeScript, JavaScript, Node.js, Supabase, Laravel, PHP, Python, Express.js, Flask, PostgreSQL, MySQL, MongoDB, Tailwind CSS, REST APIs, Webhooks, Apps Script, PayMongo, Claude Code, Codex.
- `rankMatch`: zero score and empty skills when not a relevant role. Otherwise preferred skills score 5, others score 1, plus 3 for affirmative AI-assisted coding, vibe-coding, or AI-powered development sentence in title, summary, or description. Negated sentences with no, not, never, without, prohibited, forbidden, disallowed do not count. Returns skills, score, semicolon-joined reason and location strings.
- n8n and GoHighLevel, including GHL and Go High Level, have no skill patterns, so they never match alone. They are also cleared from saved searches on migration. Listings mentioning them can still pass through another skill such as React.
- `cell` prefixes `=`, `+`, `-`, `@`, including leading whitespace, with a single quote so scraped text is stored literally and cannot execute as a Sheet formula.

### 4.4 Sheets schema

- **Searches** `SEARCH_HEADERS = ['Enabled', 'Keywords', 'Employment Type', 'Max Pages']`. `readSearches` accepts checkbox true or string `true`, trims keywords, defaults missing pages to 3, enforces type in `All`, `Full Time`, `Part Time`, `Gig` and integer pages 1–3, deduplicates by normalized keyword plus type. Duplicate searches collapse to one.
- **Part Time, Full Time, Gig, Any** share `JOB_HEADERS = ['Job ID', 'Title', 'URL', 'Salary Text', 'Employment Type', 'Posted Date Text', 'Description Snippet', 'Skills', 'Matched Searches', 'First Seen', 'Last Seen', 'Status', 'Notes', 'Availability', 'Last Checked', 'Matched Skills', 'Match Score', 'Match Reason', 'Match Location']`. `STATUSES = ['New', 'Saved', 'Applied', 'Interviewing', 'Rejected', 'Archived']`. Availability values are Open, Closed, Not a match, Unknown. Job tabs have no automatic availability restriction after the one-time migration; user filters are preserved.
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

### 4.6 Discovery expiry and permanent application history

- `RETENTION_MS = 14 * 24 * 60 * 60 * 1000` is the new-post eligibility window and discovery retention period.
- `postedTime(text)` accepts `YYYY-MM-DD HH:MM:SS`, interprets Asia/Manila `+08:00`, and rejects impossible dates.
- New additions require `posted <= now` and `now - posted < RETENTION_MS`. At exactly 14 days they are ineligible.
- Discovery rows expire when `now - posted >= RETENTION_MS`. September 11 at 08:00 Manila expires September 25 at 08:00 Manila, removed on the next refresh. For legacy invalid posting dates, use valid First Seen; preserve rows if neither date is valid. Applied transfers happen first; late Applied edits survive cleanup. Every application status remains permanent.
- Existing details, availability, and Last Checked are historical and are not rechecked. First Seen and Last Seen remain unchanged in discovery; an Applied transfer stamps Last Seen in Applications.
- Identity is the numeric Job ID across discovery, Applications, and Expired IDs. Expiry records IDs in the Expired IDs sheet (single Job ID column), flushes and verifies each record before deleting its source. Interrupted deletion retries safely. Expired same-ID reposts stay excluded even with fresh dates. Manual clear preserves the ledger. Manually deleted unexpired IDs may still return while eligible.
- Old hidden rows become visible when the automatic filter is removed, but stored availability is not changed to Open. Previously deleted records cannot be recovered from the current sheet automatically.

### 4.7 Triggers, timezone, and safety limits

- Timezone fixed to `Asia/Manila` in manifest and on spreadsheet during setup.
- `enableHourlyRefresh` requires at least one valid search, creates one hourly `runScraper` trigger, deletes duplicates, keeps unrelated triggers. One Google account manages only its own triggers.
- `disableHourlyRefresh` deletes all `runScraper` triggers for the current account.
- Request pacing minimum 1 second, 5xx retried twice with exponential backoff, 401, 403, 429 and Cloudflare or access-denied titles stop run, redirects never followed.
- Shared 180-second run target: network requests stop starting at 135 seconds, new sheet work at 165 seconds, with 15 seconds reserved for finalization. Checks cover initialization, transfers, cleanup, appends, and sorting. Google calls already in flight cannot be interrupted, so this is a cooperative limit and must be measured in the native engine.
- Formula injection guard via leading-quote escaping. Unexpected search markup is an error, not silent empty success.

## 5. Testing and verification checklist

```sh
npm test
npm run build
npm run check
```

- `npm test` covers parser fixtures, settings validation, deduplication, tracking preservation, safe text, pagination, retries, access blocks, time budgets, resume matching, employment types, closure signals, new-post age cutoff, permanent application history, schema migration, repeat setup, trigger management, and Sheet service interactions.
- Local tests mock Google services. Before relying on automation, verify in the real spreadsheet: manual run, repeat run adding zero duplicates, newest-first order, preserved Notes/custom formulas, Applied transfers, discovery expiry, permanent Applications history, expired-ID exclusion, and a scheduled execution. Runs should show Success or an expected Limited/Partial result.
- The local suite covers JSON logs, shared execution IDs, counts, source failures, append retries, accumulation beyond 50 saved jobs, filter migration, date sorting, custom formulas, nine defaults, and search rotation. The build also verifies all six entrypoints in a clean VM. This does not replace a live Apps Script execution check.

## 6. Troubleshooting

- Check **Runs** first. Error column holds joined search, fetch, verification, and budget messages. Removed counts discovery rows deleted by 14-day cleanup. Historical counts stay intact.
- `Another tracker operation is running`: lock contention. Wait and retry. Contended runs log Skipped without fetching.
- `Missing <name> tab. Run setup first.`: run `setup` from Apps Script editor.
- `<name> headers changed. Restore original header order.`: restore exact header names and order. Setup does not silently repair renamed headers.
- Completely empty rows inside job tables are skipped, including hidden rows. Refresh does not delete these rows; normal whole-row sorting may move them. A row containing Notes, custom values, or a formula (even one displaying an empty string) is not empty and must have a valid Job ID.
- `<tab>!A<row>: missing Job ID on a non-empty row` or `invalid Job ID; expected digits only`: restore the ID at the reported cell. Arbitrary cell contents are not included in diagnostics.
- `Duplicate Job ID <id>: <cell> and <cell>`: reconcile the two reported records while preserving tracking data. IDs must be unique across discovery tabs and separately within Applications; application-transfer conflict rules still apply.
- Older deployments report `Jobs contains missing or duplicate IDs.` without locations. Deploy the updated build to tolerate blank rows and receive precise diagnostics.
- `Searches row N: use supported employment type and Max Pages 1–3.`: fix dropdown value.
- `No enabled searches with keywords.`: enable at least one row with non-blank keywords.
- `HTTP 401/403/429` or `Access challenge received`: Google-hosted requests blocked. Keep scheduling disabled. Project does not bypass challenges or add external scraping infrastructure.
- `Network budget reached` or `Run budget reached`: normal under load. Reduce Max Pages to 1, let cursor rotate across runs.
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
- `work.deferred`, `sort.recovered`: deadline stops and verified sort-helper recovery.
- `search.coverage`: discovered, known, eligible, checked and deferred candidate counts per selected search. Overlapping searches can count the same ID; these totals are not additive. `search.completed` includes `oldestPosted`, page count and `morePages`; it does not claim full 14-day coverage.
- `cleanup.completed`, `searches.selected`, `search.started`, `search.page`, `search.completed`, `collection.completed`, `candidates.prepared`: discovery progress and counts.
- `request.completed`, `request.retry`, `search.failed`: HTTP status, retry attempt, and failures. Requests include a search label/page or job ID; response bodies are omitted.
- `verification.batch`, `job.checked`, `verification.completed`, `verification.skipped`, `verification.budget_exhausted`: selected batch, each attempted job's availability and score, and stop conditions.
- `jobs.saved`, `cursors.saved`, `scraper.skipped`, `scraper.failed`, `scraper.completed`: persistence and final outcome. The scraper summary includes duration in milliseconds, pages, checked jobs, added, updated, removed, and errors. A failure before scraper initialization is reported by `operation.failed` instead.

Logs omit raw HTML, full descriptions, tracking notes, and resume contact details. A failed console sink cannot interrupt scraping. Detailed logs add diagnostics without adding network requests. Cloud verification is still required after uploading this local refactor.


### Manual Jobs reset

`clearJobs` is an explicit editor function, separate from setup and scheduled scraping. It uses the same lock as scraping, validates employment-tab headers, clears all data below each employment-tab header across used columns, resets rotation cursors, and emits `jobs.cleared` with removed and remaining counts. It preserves Applications, Expired IDs, Searches, Runs, formatting, and the header. Existing hourly refresh can populate jobs again on its next run.

The software-focus update was uploaded through clasp. Remote `clearJobs` execution returned Google storage `NOT_FOUND`; the live Jobs reset was not verified. Run `clearJobs` from the bound Apps Script editor to perform the reset.

### Direct employment tables

`src/spreadsheet/job-tabs.js` owns migration and cross-tab storage. Part Time, Full Time, Gig, and Any contain actual records with editable Status and Notes. Formula views have been removed. Setup preflights target ownership, preserves tracking and custom values from legacy Jobs, verifies migrated records, rechecks the source for concurrent edits, and only then deletes Jobs. A conflicting record or failed copy leaves Jobs intact. Existing generated view tabs are converted during this migration.

All tab IDs are checked together before fetching. Newly verified records route by employment type. Existing IDs are not rechecked or moved between employment tabs. Only Applied transfers move existing records; discovery expiry deletes old rows after recording their IDs. New additions are appended, then each employment tab is sorted newest first; manual clearing still applies to all four employment tabs.

50 unique unseen-candidate detail checks are shared across all tabs; saved rows do not consume checks and have no count limit. Preferred candidates receive up to 38 slots and secondary candidates 12, sharing unused capacity. The three-minute run target reserves write/reporting time; retry and query limits remain unchanged. No guarantee of 50 new records per run.

Scheduling remains explicit: `enableHourlyRefresh` creates an hourly trigger for the current account and `disableHourlyRefresh` removes it. Setup does not alter scheduling. Cloud API execution has returned `NOT_FOUND`, so run setup and enableHourlyRefresh from the bound editor and verify subsequent scheduled executions.


### Restore the original job layout

The two-status/hidden-column change has been withdrawn. All A–S job columns are visible, with original Status in L and the original status options. Setup can restore a partially moved H Status column without rebuilding or deleting job records. Any already-converted Not Applied value becomes New; existing other values are preserved. Statuses previously collapsed into Applied cannot be reconstructed automatically.

### Expiry verification

Test the exact 14-day Manila boundary, sparse row deletion, Applied edits during cleanup, expiry ledger write/deletion failures, and exclusion of expired IDs when source posting dates change. Expired IDs stores identity only; deleted job details and Notes cannot be reconstructed from it. Do not delete or edit this ledger if expired-ID exclusion must remain permanent.

## Native acceptance and release gate

Use a copied workbook and separate bound script, with no scheduled triggers. Upload the verified build plus `scripts/acceptance.gs` to that isolated script only, replacing `__ACCEPTANCE_WORKBOOK_ID__` with the copy's ID. The helper refuses any other workbook and any project with triggers. Run `runAcceptanceChecks` from its editor after authorizing the copy. It inserts two synthetic jobs, verifies expiry/ID history, Applied transfer with a calculated formula and Notes, date sorting, and duplicate-free repeated discovery. Use a fresh copy for each test; the fixtures deliberately prevent accidental repeat use. This helper is not bundled or uploaded by the normal production push.

Before production deployment, retain an XLSX/Google workbook backup, downloaded deployed source, cleanup preview, and verified bundle hash. Compare remote uploaded source to that hash. Run two manual checks, then observe hourly activity for 48 hours with no unexplained errors, duplicates, detached tracking, history loss or quota exhaustion. Inspect all enabled searches across rotation and actual per-search coverage. Do not interpret 50 checks as a guarantee of 50 new jobs or exhaustive two-week discovery.

If native validation fails, disable the refresh trigger in the affected project and reconcile records using the backup and ledger. Restoring old code alone is not safe: it can reinstate availability resets and old expiry behavior. Production deployment and enabling production triggers require separate authorization.
