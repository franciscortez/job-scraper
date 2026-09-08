import { PREFERRED_SKILLS } from '../config/settings.js';
import { isPreferredSearch } from '../scraper/searches.js';
const PROFILE_SKILLS = [
  ['Next.js', /\bnext[ .-]*js\b/i],
  ['React', /\breact(?:[ .-]?js)?\b/i],
  ['TypeScript', /\btypescript\b/i],
  ['JavaScript', /\bjavascript\b/i],
  ['Node.js', /\bnode[ .-]?js\b/i],
  ['Supabase', /\bsupabase\b/i],
  ['Laravel', /\blaravel\b/i],
  ['PHP', /\bphp\b/i],
  ['Python', /\bpython\b/i],
  ['Express.js', /\bexpress[ .-]?js\b/i],
  ['Flask', /\bflask\b/i],
  ['PostgreSQL', /\bpostgres(?:ql)?\b/i],
  ['MySQL', /\bmysql\b/i],
  ['MongoDB', /\bmongodb\b/i],
  ['Tailwind CSS', /\btailwind\b/i],
  ['REST APIs', /\brest(?:ful)?\s*apis?\b/i],
  ['Webhooks', /\bwebhooks?\b/i],
  ['Apps Script', /\b(?:google\s+)?apps?\s+script\b/i],
  ['PayMongo', /\bpaymongo\b/i],
  ['Claude Code', /\bclaude\s+code\b/i],
  ['Codex', /\bcodex\b/i],
];

// Tool names alone do not establish that a role involves software development.
const SOFTWARE_TITLE = /\b(?:software (?:developer|engineer)|(?:web|application|app|full[ -]?stack|front[ -]?end|back[ -]?end) (?:developer|engineer)|programmer|developer)\b/i;
const CONTENT_ROLE = /\b(?:(?:content|video|youtube|social media|copy)\s*(?:creator|creation|producer|production|editor|editing|writer|writing|manager|management|developer)|(?:youtube|video)\s+automation|script\s*writer|copywriter|youtuber)\b/i;

export function isRelevantRole(job, detail = '') {
  const title = String(job.title || '');
  if (CONTENT_ROLE.test(title)) return false;
  if (SOFTWARE_TITLE.test(title)) return true;

  // Generic AI/automation titles need concrete programming responsibilities.
  return `${job.snippet || ''} ${detail}`.split(/[!?;\n]+|\.(?=\s|$)/).some((sentence) => {
    if (/\b(?:write|writing)\s+(?:articles?|posts?|blogs?|documentation|content)\b/i.test(sentence)) return false;
    if (/\b(?:no|not|never|without)\b[^.!?]{0,40}\b(?:coding|programming|development)\b/i.test(sentence)) return false;
    const responsibility = sentence.replace(/\bclaude\s+code\b/gi, 'ClaudeTool');
    return /\b(?:build(?:ing)?|develop(?:ing)?|implement(?:ing)?|maintain(?:ing)?|debug(?:ging)?|writ(?:e|ing))\b[^!?]{0,100}\b(?:apps?|applications?|software|websites?|apis?|code|(?:python|javascript|typescript|apps? script|shell|sql) scripts?)\b/i.test(responsibility);
  });
}

export function matchedSkills(job, detail = '') {
  return rankMatch(job, detail).skills;
}

function skillEvidence(job, detail = '') {
  const fields = [
    ['Title', job.title],
    ['Tags', job.skills],
    ['Summary', job.snippet],
    ['Description', detail],
  ];
  return PROFILE_SKILLS.map(([name, pattern]) => ({
    name,
    locations: fields
      .filter(([, text]) => pattern.test(String(text || '')))
      .map(([source]) => source),
  })).filter((item) => item.locations.length);
}

export function rankMatch(job, detail = '') {
  if (!isRelevantRole(job, detail)) return { skills: [], score: 0, reason: '', location: '' };
  const evidence = skillEvidence(job, detail);
  const aiLocations = [
    ['Title', job.title],
    ['Summary', job.snippet],
    ['Description', detail],
  ]
    .filter(([, text]) =>
      String(text || '')
        .split(/[!?;\n]+|\.(?=\s|$)/)
        .some(
          (sentence) =>
            /\b(?:ai[ -](?:assisted|powered) (?:coding|development|software development)|vibe[ -]?coding)\b/i.test(
              sentence,
            ) && !/\b(?:no|not|never|without|prohibited|forbidden|disallowed)\b/i.test(sentence),
        ),
    )
    .map(([source]) => source);
  const score =
    evidence.reduce((total, item) => total + (PREFERRED_SKILLS.includes(item.name) ? 5 : 1), 0) +
    (aiLocations.length && evidence.length ? 3 : 0);
  const reasons = evidence.map(
    (item) => `${item.name} (+${PREFERRED_SKILLS.includes(item.name) ? 5 : 1})`,
  );
  const locations = evidence.map((item) => `${item.name}: ${item.locations.join(', ')}`);
  if (aiLocations.length && evidence.length) {
    reasons.push('AI-assisted development (+3)');
    locations.push(`AI-assisted development: ${aiLocations.join(', ')}`);
  }
  return {
    skills: evidence.map((item) => item.name),
    score,
    reason: reasons.join('; '),
    location: locations.join('; '),
  };
}

export function isPreferredCandidate(job) {
  if (CONTENT_ROLE.test(String(job.title || ''))) return false;
  return (
    skillEvidence(job).some((item) => PREFERRED_SKILLS.includes(item.name)) ||
    (job.priorSkills || []).some((skill) => PREFERRED_SKILLS.includes(skill)) ||
    (job.matches || []).some((label) =>
      isPreferredSearch({ keywords: label.replace(/ \[[^\]]+\]$/, '') }),
    )
  );
}
