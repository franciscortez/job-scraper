# Job Tracker for OnlineJobs.ph

This is a helper that watches OnlineJobs.ph for you and keeps the good matches in a Google Sheet.

You do not need to learn any code to use it every day. You only open your spreadsheet, press a button, and read the list.

If you need to install it, fix it, or change how it works, read `SETUP.md` instead. That file is for technical setup.

Your current setup:

- [Open the job spreadsheet](https://docs.google.com/spreadsheets/d/1tM6MzR-ol3Njd5wvhrf8VrPPaOu6LY9ytVlkGJaY5JQ/edit)
- [Open the behind-the-scenes script](https://script.google.com/d/1hRAfASmKOBGZH6MaEwSMjNGI0s5mF_-xf8oYNHkq9OSuyBT_sb7VMHAb/edit)

## What it does for you

Every time it runs, it:

1. Looks at the job searches you turned on.
2. Reads the newest job posts from OnlineJobs.ph.
3. Opens each promising post and checks if it is still open and if it fits your skills.
4. Skips Job IDs already saved in any employment tab or Applications.
5. Adds unseen open matches posted less than 14 days ago.
6. Sorts each employment tab by posting date, newest first. Equal dates use descending Job ID; missing or invalid historical dates go last.
7. Moves Applied jobs to Applications, then removes discovery jobs 14 days after their posting date.
8. Writes a short report about what it did.

Existing details, availability, Status, Notes, and custom cells are not refreshed. Sorting moves whole rows, keeping tracking and formulas attached. Applications stays in its existing order. Discovery jobs expire after 14 days, including their Status, Notes, and custom cells. Applications remains permanent. Cleanup happens on the next manual or hourly refresh after the deadline.

## The three pages in your spreadsheet

Think of the spreadsheet as three pages:

- **Part Time, Full Time, Gig, Any:** editable job lists. Each job is stored in its employment-type tab.
- **Searches:** what to look for. Turn searches on or off, change the words, pick the job type, pick how many pages to read.
- **Runs:** a diary of the latest 24 hours. Each run writes one line directly below the header so the newest run is always on top and older runs follow underneath. At the next scraper run, entries at least 24 hours old are deleted; headers and newer entries stay in the same tab. Cleanup requires the scraper lock and does not run while the scraper is idle. Entries with missing or invalid timestamps are kept for inspection.

To use it daily:

1. Open the spreadsheet.
2. Use the **Job Tracker** menu at the top.
3. Click **Run now** when you want fresh jobs.
4. Read the employment-type tabs. The latest posting dates appear first.
5. For jobs you like, use **Saved** and add **Notes**. After applying, choose **Applied**; the next hourly or manual refresh moves the row to **Applications** and stamps Last Seen as arrival time. All application statuses remain permanently, including Applied.
6. Turn on **Enable hourly refresh** if you want it to check by itself. Turn it off with **Disable hourly refresh**.

That is all most people need.

## Your preferred matches

Next.js, Codex, Claude Code, and Supabase each add **5 points**. Other matching skills, including Google Apps Script, add **1 point** each. Explicit AI-assisted development wording adds **3 points once**. Repeating a keyword does not add extra points.

Keywords can appear in the job title, tags, summary, or full description. Check **Match Score**, **Match Reason**, and **Match Location** to see why a job ranks higher. A generic title can still qualify when its description clearly asks for coding or technical automation work.

The tracker keeps nine default searches but runs at most five at a time: four preferred searches and a rotating secondary search. Each batch reserves up to 38 new-candidate checks for preferred candidates and 12 for other candidates, with unused slots shared. Later runs rotate through both groups. Existing saved IDs never consume detail checks. New searches use one page; your existing page limits and disabled searches stay unchanged.

## Rules in plain words

These are the rules the helper always follows.

| Area | Rule |
|------|------|
| What shows up | Newly added jobs must be open and match your skills. Saved jobs remain visible regardless of their stored availability, unless you apply your own filter. |
| What counts as a fit | The job has to be a developer, software, integration, or automation kind of job, plus mention at least one of your skills. |
| Your skills it looks for | Next.js, React, TypeScript, JavaScript, Node.js, Supabase, Laravel, PHP, Python, Express.js, Flask, PostgreSQL, MySQL, MongoDB, Tailwind CSS, REST APIs, webhooks, Apps Script, PayMongo, Claude Code, and Codex. |
| Jobs it ignores | Social media, admin, and other non-developer jobs, even if they mention one of those tools by accident. |
| Special words that do not count alone | n8n and GoHighLevel, including GHL, do not count as a skill match by themselves. A job mentioning them can still appear if it also needs one of your real skills, like React. |
| Full time, part time, gig | All of them can appear: Full Time, Part Time, Gig, and Any. You can narrow this in the Searches page. |
| What “Open” means | The public page had an application control and no closed message when added. Availability and Last Checked are historical; saved jobs are not rechecked. |
| How many jobs it checks per run | At most 50 unseen job pages per run, across all tabs. There is no 50-row storage limit. |
| What “Limited” means | More unseen candidates remain than this run could check. Later runs can check them when they appear in the selected search pages. |
| How old jobs can get | Discovery jobs expire 14 days after posting (September 11 becomes September 25 at the same time, Manila). Applications never expires. New additions need a valid posting date less than 14 days old. |
| Old jobs coming back | Retained and expired Job IDs are never added again, even with a new source date. Expired IDs are remembered in the Expired IDs tab. A repost with a different ID is a new candidate; manually deleted, unexpired IDs may return. |
| Your Status and Notes | Preserved during sorting and Applied transfers. Discovery expiry deletes the whole row, including Notes; Applications keeps them permanently. |
| Duplicates | The same job never appears twice, even if it shows up in several searches or pages. |
| Newest posts first | Each employment tab sorts by Posted Date, newest to oldest. Match Score remains available but no longer controls ordering. |
| Salary and dates | Copied exactly as written on the job site. Nothing is converted or guessed. Missing details stay blank. |
| Sorting and editing | Sort whole rows together, never one column alone. Empty rows remain empty but may move during sorting. Non-empty rows, including formulas and custom cells, need a valid Job ID. Keep headers and IDs intact; do not sort during a run. |
| One run at a time | If one run is already working, another one waits. This protects your sheet from mixed-up rows. |
| Hourly checking | Hourly means about once an hour, not exactly on the hour. Google decides the exact minute. |
| When the job site blocks access | The run stops safely, keeps your old jobs, and writes what happened in the Runs page. It does not try to sneak around blocks. |
| When something looks wrong on the site | If the job site changes its layout, the helper reports an error instead of guessing. Check the Runs page first. |

## What it will not do

- It will not apply to jobs for you.
- It will not message employers.
- It will not guarantee a job is still available.
- It will not keep discovery jobs beyond their 14-day expiry. Applications history remains permanent.
- It will not fix renamed headers by itself. Keep the header row as it is.
- It will not send your name, contact details, or work history to the job site. It only reads public job pages.

## If something looks wrong

1. Open the **Runs** page and read the line directly below the header (the newest run) from right to left: result, error, numbers.
2. If a job seems missing, check Applications, the Removed count in Runs, and your filters. The first updated run removes the old automatic Open-only filter; it does not change stored availability or recover deleted rows.
3. If no new jobs appear, check the **Searches** page: at least one row needs to be turned on and have words in it.
4. If the sheet says headers changed, put the header names back in the original order.
5. If an ID error appears, use the tab and cell locations in Runs to find the affected records. Missing or invalid IDs on non-empty rows and duplicate IDs still stop refresh. Completely empty rows do not.
6. For setup problems, error messages, and all technical commands, see `SETUP.md`.


### JSON progress logs

The scraper now logs structured JSON for each stage, checked job, retry, and final result. Each execution has one `executionId`; `job.checked` shows availability and match score, and `scraper.completed` shows totals. The Runs tab still provides the usual summary. See [SETUP.md](SETUP.md#json-execution-logs) for the event reference.


### Software development focus and clearing jobs

Claude Code and other preferred tools count only for eligible development roles. Content-creation titles such as YouTube automation, video editing, and scriptwriting are excluded. Generic AI or workflow titles need programming responsibilities in their summary or description. Software development involving the YouTube API remains eligible.

To clear existing results, select `clearJobs` in the Apps Script editor and run it. This clears all data below the headers in Part Time, Full Time, Gig, and Any, including hidden rows, Status, Notes, and custom columns. Applications, Searches, Runs, and Expired IDs remain intact. The reset also clears rotation cursors; it does not fetch jobs. Run `runScraper` afterward to refill results with the current filters.

### Employment-type tabs

Jobs are stored directly in **Part Time**, **Full Time**, **Gig**, and **Any**. Edit Status and Notes in the same tab as the job. There is no central Jobs table and no formula view.

Run `setup` once after this update. It migrates existing Jobs records (including tracking and custom cells) into the correct tabs, verifies the copies, then removes the old Jobs tab. Unrelated tab-name conflicts stop migration. Do not edit data while migration runs.

The cap is **50 unique unseen-job checks total per run across all tabs**, not 50 per tab or a limit on saved rows. Some candidates will not qualify. Search requests and retries are additional. A three-minute run target can stop work before 50 checks. Network requests stop starting after 135 seconds, new sheet work after 165 seconds, leaving 15 seconds for final reporting. In-flight Google calls cannot be interrupted.

Hourly runs are supported but setup does not enable them. Run `enableHourlyRefresh` once to schedule hourly checks for your account. Existing hourly triggers remain active. Confirm scheduled runs in Runs or Apps Script Executions; the CLI has not verified the live trigger.

### Application tracking

**Applications** is created by setup or the first refresh after deployment. Mark a row **Applied** in an employment tab to move it there on the next hourly refresh (when enabled), or run `runScraper` manually. Transfers happen before discovery cleanup and fetching, even when searches are disabled or the source is unavailable.

Applications supports **Applied**, **Interviewing**, **Accepted**, **Rejected**, and **Withdrawn**. Change these statuses manually in Applications. Every status stays permanently regardless of age or availability; `clearJobs` also leaves Applications intact. Application IDs are excluded from discovery additions and availability checks. No application date is added automatically.

Transfers preserve job details, Notes, and custom column values. Destination copies are verified before source rows are deleted. If a transfer is interrupted, a later run can finish an identical copy without duplication. Conflicting copies or edits during transfer stop the run and retain the source; reconcile the rows before retrying. Unrelated content in an existing Applications tab is never overwritten. Refresh summaries and execution logs report moved counts; errors also appear in Runs.

Applications uses 60-pixel data rows, clipped text, top alignment, wider text columns, and alternating row colors. Setup and refresh reapply this layout, including to newly transferred rows. Select a cell to read its complete text in the formula bar.

### Expired IDs

The tracker records each expired Job ID in **Expired IDs** before deleting its discovery row. Keep this tab intact: it prevents old listings from returning, even if their source date changes. It stores only IDs, not job details or Notes.

### Reliable refresh and recovery

A Limited result can mean work was deferred to a later run. Successfully copied applications, expired IDs, and appended jobs remain saved; a retry resumes from the sheet without clearing results. Existing job details are not rechecked.

The tracker records temporary sort columns before sorting. After an interruption, it removes only columns matching its recovery markers. If the columns were edited or ownership is unclear, refresh stops and preserves them for review.

After Expired IDs is initialized, a missing/replaced ledger or malformed content stops refresh before transfers, cleanup, or discovery. Restore the original history instead of creating an empty replacement. Application transfers preserve formulas using Google's native copy operation, then verify the destination before deleting the source.

For daily use: review the newest listings, use Match Score to prioritize, confirm the job remains open on its website, and mark Applied after applying. Update outcomes in Applications. Saved discovery rows still expire, including their Notes.
