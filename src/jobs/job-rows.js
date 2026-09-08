import { RETENTION_MS, JOB_INDEX } from '../config/settings.js';
export function postedTime(text) {
  const match = String(text).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const time = Date.parse(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`,
  );
  if (!Number.isFinite(time)) return null;
  const roundTrip = new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
  return roundTrip === text ? time : null;
}

export function expiredRow(row, now) {
  const posted = postedTime(row[JOB_INDEX['Posted Date Text']]);
  const firstSeen =
    row[JOB_INDEX['First Seen']] instanceof Date &&
    Number.isFinite(row[JOB_INDEX['First Seen']].getTime())
      ? row[JOB_INDEX['First Seen']].getTime()
      : null;
  const date = posted ?? firstSeen;
  return date !== null && now - date >= RETENTION_MS;
}

export function rowJob(row) {
  return {
    id: String(row[JOB_INDEX['Job ID']]),
    title: row[JOB_INDEX['Title']],
    url: row[JOB_INDEX['URL']],
    salary: row[JOB_INDEX['Salary Text']],
    type: row[JOB_INDEX['Employment Type']],
    posted: row[JOB_INDEX['Posted Date Text']],
    snippet: row[JOB_INDEX['Description Snippet']],
    skills: row[JOB_INDEX['Skills']],
    matches: String(row[JOB_INDEX['Matched Searches']]).split('\n').filter(Boolean),
    checked: row[JOB_INDEX['Last Checked']],
    priorSkills: String(row[JOB_INDEX['Matched Skills']] || '')
      .split(', ')
      .filter(Boolean),
  };
}

// Apostrophe forces literal text in Sheets without changing its displayed value.
export const cell = (value) =>
  typeof value === 'string' && /^\s*[=+@-]/.test(value) ? "'" + value : value;

export function mergeJobs(existing, incoming, now) {
  const rows = existing.map((row) => row.slice());
  const index = new Map();
  rows.forEach((row, i) => {
    const id = String(row[JOB_INDEX['Job ID']]);
    if (!/^\d+$/.test(id) || index.has(id))
      throw new Error(
        'Jobs contains missing or duplicate IDs. Restore valid IDs before refreshing.',
      );
    index.set(id, i);
  });
  let added = 0;
  const updated = new Set();
  for (const job of incoming) {
    const position = index.get(job.id);
    const old = position === undefined ? null : rows[position];
    const matches = [
      ...new Set([
        ...(old ? String(old[JOB_INDEX['Matched Searches']]).split('\n').filter(Boolean) : []),
        ...job.matches,
      ]),
    ]
      .sort()
      .join('\n');
    const row = [
      job.id,
      job.title,
      job.url,
      job.salary,
      job.type,
      job.posted,
      job.snippet,
      job.skills,
      matches,
      old?.[JOB_INDEX['First Seen']] || now,
      now,
      old?.[JOB_INDEX['Status']] || 'New',
      old?.[JOB_INDEX['Notes']] || '',
      old?.[JOB_INDEX['Availability']] || 'Unknown',
      old?.[JOB_INDEX['Last Checked']] || '',
      old?.[JOB_INDEX['Matched Skills']] || '',
      old?.[JOB_INDEX['Match Score']] || 0,
      old?.[JOB_INDEX['Match Reason']] || '',
      old?.[JOB_INDEX['Match Location']] || '',
    ];
    if (old) {
      rows[position] = row;
      if (position < existing.length) updated.add(job.id);
    } else {
      index.set(job.id, rows.length);
      rows.push(row);
      added++;
    }
  }
  return { rows, added, updated: updated.size };
}

export function applyVerification(rows, checks) {
  for (const row of rows) {
    const check = checks.get(String(row[JOB_INDEX['Job ID']]));
    row[JOB_INDEX['Availability']] = check?.state || 'Unknown';
    row[JOB_INDEX['Last Checked']] = check?.checked || row[JOB_INDEX['Last Checked']] || '';
    row[JOB_INDEX['Matched Skills']] = check
      ? check.skills.join(', ')
      : row[JOB_INDEX['Matched Skills']] || '';
    row[JOB_INDEX['Match Score']] = check ? check.score || 0 : row[JOB_INDEX['Match Score']] || 0;
    row[JOB_INDEX['Match Reason']] = check
      ? check.reason || ''
      : row[JOB_INDEX['Match Reason']] || '';
    row[JOB_INDEX['Match Location']] = check
      ? check.location || ''
      : row[JOB_INDEX['Match Location']] || '';
  }
}
