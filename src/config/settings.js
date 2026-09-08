export const ORIGIN = 'https://www.onlinejobs.ph';
export const SEARCH_HEADERS = ['Enabled', 'Keywords', 'Employment Type', 'Max Pages'];
export const JOB_HEADERS = [
  'Job ID',
  'Title',
  'URL',
  'Salary Text',
  'Employment Type',
  'Posted Date Text',
  'Description Snippet',
  'Skills',
  'Matched Searches',
  'First Seen',
  'Last Seen',
  'Status',
  'Notes',
  'Availability',
  'Last Checked',
  'Matched Skills',
  'Match Score',
  'Match Reason',
  'Match Location',
];
export const RUN_HEADERS = [
  'Start Time',
  'Duration (seconds)',
  'Searches Processed',
  'Pages Fetched',
  'Added',
  'Updated',
  'Result',
  'Error',
  'Removed (14 days old)',
];
export const APPLICATION_STATUSES = ['Applied', 'Interviewing', 'Accepted', 'Rejected', 'Withdrawn'];
export const STATUSES = ['New', 'Saved', 'Applied', 'Interviewing', 'Rejected', 'Archived'];
export const TYPES = ['All', 'Full Time', 'Part Time', 'Gig'];
export const DEFAULT_SEARCHES = [
  'developer',
  'React',
  'Supabase',
  'Laravel',
  'automation',
  'Next.js',
  'Codex',
  'Claude Code',
  'Google Apps Script',
].map((keyword) => [true, keyword, 'All', 1]);
export const PREFERRED_SKILLS = ['Next.js', 'Codex', 'Claude Code', 'Supabase'];
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_JOB_CHECKS_PER_RUN = 50;

export const RUN_BUDGET_MS = 240000;
export const REQUEST_DELAY_MS = 1000;
export const MAX_RETRIES = 2;
export const PREFERRED_JOB_SLOTS = 38;
export const SECONDARY_JOB_SLOTS = 12;
export const MAX_SEARCHES_PER_RUN = 5;
export const PREFERRED_SEARCH_SLOTS = 4;
// Row indexes are zero-based; sheet columns are one-based.
export const JOB_INDEX = Object.freeze(
  Object.fromEntries(JOB_HEADERS.map((name, index) => [name, index])),
);
export const JOB_COLUMN = Object.freeze(
  Object.fromEntries(JOB_HEADERS.map((name, index) => [name, index + 1])),
);

export const JOB_TAB_TYPES = ['Part Time', 'Full Time', 'Gig', 'Any'];
