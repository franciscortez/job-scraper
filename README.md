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
4. Adds new open jobs to your sheet.
5. Updates jobs it already knows about.
6. Hides jobs that closed, do not fit, or could not be checked.
7. Moves Applied jobs to Applications, then deletes unapplied discovery jobs that are 14 days old or older, plus Applications rows still stuck on Applied 14 days after transfer.
8. Writes a short report about what it did.

Status and Notes are preserved during refresh. Applied jobs move to Applications; rows still on Applied 14 days after transfer are deleted, other outcomes (Interviewing, Accepted, Rejected, Withdrawn) stay permanently. Other discovery rows are deleted when they expire.

## The three pages in your spreadsheet

Think of the spreadsheet as three pages:

- **Part Time, Full Time, Gig, Any:** editable job lists. Each job is stored in its employment-type tab.
- **Searches:** what to look for. Turn searches on or off, change the words, pick the job type, pick how many pages to read.
- **Runs:** a diary. Each run writes one line saying what happened, how many jobs were added, and if anything went wrong.

To use it daily:

1. Open the spreadsheet.
2. Use the **Job Tracker** menu at the top.
3. Click **Run now** when you want fresh jobs.
4. Read the employment-type tabs. Only open jobs are shown at first.
5. For jobs you like, use **Saved** and add **Notes**. After applying, choose **Applied**; the next hourly or manual refresh moves the row to **Applications** and stamps Last Seen as arrival time. Rows still on **Applied** 14 days later are deleted on refresh; change the status to Interviewing or beyond to keep them.
6. Turn on **Enable hourly refresh** if you want it to check by itself. Turn it off with **Disable hourly refresh**.

That is all most people need.

## Your preferred matches

Next.js, Codex, Claude Code, and Supabase each add **5 points**. Other matching skills, including Google Apps Script, add **1 point** each. Explicit AI-assisted development wording adds **3 points once**. Repeating a keyword does not add extra points.

Keywords can appear in the job title, tags, summary, or full description. Check **Match Score**, **Match Reason**, and **Match Location** to see why a job ranks higher. A generic title can still qualify when its description clearly asks for coding or technical automation work.

The tracker keeps nine default searches but runs at most five at a time: four preferred searches and a rotating secondary search. Each batch reserves up to 38 job checks for preferred candidates and 12 for other candidates, with unused slots shared. Later runs rotate through both groups. New searches use one page; your existing page limits and disabled searches stay unchanged.

## Rules in plain words

These are the rules the helper always follows.

| Area | Rule |
|------|------|
| What shows up | Only jobs that look open right now. Closed jobs, bad matches, and jobs that could not be checked stay hidden. |
| What counts as a fit | The job has to be a developer, software, integration, or automation kind of job, plus mention at least one of your skills. |
| Your skills it looks for | Next.js, React, TypeScript, JavaScript, Node.js, Supabase, Laravel, PHP, Python, Express.js, Flask, PostgreSQL, MySQL, MongoDB, Tailwind CSS, REST APIs, webhooks, Apps Script, PayMongo, Claude Code, and Codex. |
| Jobs it ignores | Social media, admin, and other non-developer jobs, even if they mention one of those tools by accident. |
| Special words that do not count alone | n8n and GoHighLevel, including GHL, do not count as a skill match by themselves. A job mentioning them can still appear if it also needs one of your real skills, like React. |
| Full time, part time, gig | All of them can appear: Full Time, Part Time, Gig, and Any. You can narrow this in the Searches page. |
| What “Open” means | It means the public job page was still there, still had an apply button, and had no closed message the last time it was checked. It cannot promise the employer is still hiring. |
| How many jobs it checks per run | At most 50 job pages per run. This keeps it fast and safe. If there is more to check, the next run continues where it left off. |
| What “Limited” means | Limited is normal. It only means there were more than 50 jobs to check, so some are waiting for the next run. |
| How old jobs can get | 14 days for unapplied discovery jobs, and 14 days in Applications for rows still on Applied (clock starts at transfer, within about an hour of marking Applied when hourly refresh is on). Other application outcomes are kept permanently. Expired rows are deleted on refresh, including Status and Notes, not at the exact birthday minute. |
| Old jobs coming back | Very old jobs are not added again. If an employer reposts the same job with a fresh date, it can appear again as new. |
| Your Status and Notes | Never overwritten by the helper. Only you change them. Progressed applications retain them permanently; stale Applied rows and expired discovery rows lose them when deleted. |
| Duplicates | The same job never appears twice, even if it shows up in several searches or pages. |
| Best matches first | The strongest skill matches float to the top of the list, so you see the most promising jobs first. |
| Salary and dates | Copied exactly as written on the job site. Nothing is converted or guessed. Missing details stay blank. |
| Sorting and editing | Sort whole rows together, never one column alone. Completely empty rows are skipped during refresh; sorting may move them. Rows with Notes, custom data, or formulas still need a valid Job ID. Do not change the top header row or the Job ID column. Do not sort while a run is happening. |
| One run at a time | If one run is already working, another one waits. This protects your sheet from mixed-up rows. |
| Hourly checking | Hourly means about once an hour, not exactly on the hour. Google decides the exact minute. |
| When the job site blocks access | The run stops safely, keeps your old jobs, and writes what happened in the Runs page. It does not try to sneak around blocks. |
| When something looks wrong on the site | If the job site changes its layout, the helper reports an error instead of guessing. Check the Runs page first. |

## What it will not do

- It will not apply to jobs for you.
- It will not message employers.
- It will not guarantee a job is still available.
- Unapplied discovery jobs go away after 14 days. Applications rows stuck on Applied go away 14 days after transfer; Interviewing and beyond remain until you manually delete them.
- It will not fix renamed headers by itself. Keep the header row as it is.
- It will not send your name, contact details, or work history to the job site. It only reads public job pages.

## If something looks wrong

1. Open the **Runs** page and read the newest line from right to left: result, error, numbers.
2. If your Status or Notes look odd, check whether the row just expired (14-day discovery rule, or stale Applied in Applications).
3. If no new jobs appear, check the **Searches** page: at least one row needs to be turned on and have words in it.
4. If the sheet says headers changed, put the header names back in the original order.
5. If an ID error appears, use the tab and cell locations in Runs to find the affected records. Missing or invalid IDs on non-empty rows and duplicate IDs still stop refresh. Completely empty rows do not.
6. For setup problems, error messages, and all technical commands, see `SETUP.md`.


### JSON progress logs

The scraper now logs structured JSON for each stage, checked job, retry, and final result. Each execution has one `executionId`; `job.checked` shows availability and match score, and `scraper.completed` shows totals. The Runs tab still provides the usual summary. See [SETUP.md](SETUP.md#json-execution-logs) for the event reference.


### Software development focus and clearing jobs

Claude Code and other preferred tools count only for eligible development roles. Content-creation titles such as YouTube automation, video editing, and scriptwriting are excluded. Generic AI or workflow titles need programming responsibilities in their summary or description. Software development involving the YouTube API remains eligible.

To clear existing results, select `clearJobs` in the Apps Script editor and run it. This clears all data below the headers in Part Time, Full Time, Gig, and Any, including hidden rows, Status, Notes, and custom columns. Applications, Searches, and Runs remain intact. The reset also clears rotation cursors; it does not fetch jobs. Run `runScraper` afterward to refill results with the current filters.

### Employment-type tabs

Jobs are stored directly in **Part Time**, **Full Time**, **Gig**, and **Any**. Edit Status and Notes in the same tab as the job. There is no central Jobs table and no formula view.

Run `setup` once after this update. It migrates existing Jobs records (including tracking and custom cells) into the correct tabs, verifies the copies, then removes the old Jobs tab. Unrelated tab-name conflicts stop migration. Do not edit data while migration runs.

The cap is **50 unique job checks total per run across all tabs**, not 50 per tab or 50 new matches. Search requests and retries are additional. The four-minute budget can stop a run before 50 checks.

Hourly runs are supported but setup does not enable them. Run `enableHourlyRefresh` once to schedule hourly checks for your account. Existing hourly triggers remain active. Confirm scheduled runs in Runs or Apps Script Executions; the CLI has not verified the live trigger.

### Application tracking

**Applications** is created by setup or the first refresh after deployment. Mark a row **Applied** in an employment tab to move it there on the next hourly refresh (when enabled), or run `runScraper` manually. Transfers happen before cleanup and fetching, even when searches are disabled or the source is unavailable.

Applications supports **Applied**, **Interviewing**, **Accepted**, **Rejected**, and **Withdrawn**. Change these statuses manually in Applications; progressed rows stay regardless of status or availability. Only rows still on **Applied** 14 days after transfer (Last Seen) expire; all other application history is exempt from cleanup and `clearJobs`. Application IDs are excluded from discovery additions and availability checks. No application date is added automatically.

Transfers preserve job details, Notes, and custom column values. Destination copies are verified before source rows are deleted. If a transfer is interrupted, a later run can finish an identical copy without duplication. Conflicting copies or edits during transfer stop the run and retain the source; reconcile the rows before retrying. Unrelated content in an existing Applications tab is never overwritten. Refresh summaries and execution logs report moved counts; errors also appear in Runs.

Applications uses 60-pixel data rows, clipped text, top alignment, wider text columns, and alternating row colors. Setup and refresh reapply this layout, including to newly transferred rows. Select a cell to read its complete text in the formula bar.
