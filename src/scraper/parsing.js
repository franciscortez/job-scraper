import { parseDocument } from 'htmlparser2';
import { ORIGIN } from '../config/settings.js';
import { rankMatch } from '../jobs/matching.js';
function all(node, predicate) {
  const result = [];
  function visit(item) {
    if (predicate(item)) result.push(item);
    for (const child of item.children || []) visit(child);
  }
  visit(node);
  return result;
}
const hasClass = (node, name) => (node.attribs?.class || '').split(/\s+/).includes(name);
function content(node, skip = () => false) {
  if (!node || skip(node) || ['script', 'style'].includes(node.name)) return '';
  if (node.type === 'text') return node.data;
  if (node.name === 'br') return ' ';
  return (node.children || []).map((child) => content(child, skip)).join('');
}
const clean = (text) => text.replace(/\s+/g, ' ').trim();
const first = (node, predicate) => all(node, predicate)[0];
const value = (node) => clean(content(node));

export function safeSearchUrl(url) {
  if (url.startsWith('/jobseekers/jobsearch')) url = ORIGIN + url;
  if (!/^https:\/\/www\.onlinejobs\.ph\/jobseekers\/jobsearch(?:\/\d+)?(?:\?[^#\s]*)?$/.test(url)) {
    throw new Error('Unexpected search URL; refusing request.');
  }
  return url;
}

export function parsePage(html) {
  if (/cf-chl-|id=["']challenge-form|<title>\s*(?:Just a moment|Access denied)/i.test(html)) {
    throw new Error('Access challenge received.');
  }
  const doc = parseDocument(html, { decodeEntities: true });
  const cards = all(doc, (node) => hasClass(node, 'jobpost-cat-box'));
  const jobs = cards.map((card) => {
    let anchor = card.parent;
    while (anchor && anchor.name !== 'a') anchor = anchor.parent;
    const href =
      anchor?.attribs?.href ||
      first(
        card,
        (node) => node.name === 'a' && /\/jobseekers\/job\//.test(node.attribs?.href || ''),
      )?.attribs.href;
    const path = (href || '').replace(ORIGIN, '');
    const id = path.match(/^\/jobseekers\/job\/[^/?#]+-(\d+)$/)?.[1];
    const heading = first(card, (node) => node.name === 'h4');
    const title = clean(content(heading, (node) => hasClass(node, 'badge')));
    if (!id || !title)
      throw new Error('Job card missing ID or title; source markup may have changed.');
    const posted = first(card, (node) => node.attribs?.['data-temp'] !== undefined);
    const description = first(card, (node) => hasClass(node, 'desc'));
    const tags = first(card, (node) => hasClass(node, 'job-tag'));
    return {
      id,
      title,
      url: ORIGIN + path,
      salary: value(first(card, (node) => node.name === 'dd')),
      type: value(first(heading || card, (node) => hasClass(node, 'badge'))),
      posted:
        posted?.attribs['data-temp'] ||
        value(first(card, (node) => node.name === 'em')).replace(/^Posted on\s*/i, ''),
      snippet: clean(
        content(description, (node) => node.name === 'a' && value(node) === 'See More'),
      ),
      skills: [
        ...new Set(
          all(tags || { children: [] }, (node) => node.name === 'a')
            .map(value)
            .filter(Boolean),
        ),
      ].join(', '),
    };
  });
  if (!cards.length && !/Displaying\s+0\s+out of\s+0\s+jobs?\b/i.test(value(doc))) {
    throw new Error('Expected job cards or explicit zero results; source markup may have changed.');
  }
  const next = first(
    doc,
    (node) => node.name === 'a' && (node.attribs?.rel || '').split(/\s+/).includes('next'),
  );
  return { jobs, next: next?.attribs?.href ? safeSearchUrl(next.attribs.href) : null };
}

export function safeJobUrl(url, id) {
  if (
    !/^https:\/\/www\.onlinejobs\.ph\/jobseekers\/job\/(?:[^/?#]+-)?\d+$/.test(url) ||
    (!url.endsWith(`-${id}`) && !url.endsWith(`/${id}`))
  )
    throw new Error('Unexpected job URL.');
  return url;
}

export function inspectJob(response, job) {
  if ([404, 410].includes(response.status)) return { state: 'Closed', skills: [] };
  if (response.status !== 200) throw new Error(`HTTP ${response.status} checking job.`);
  if (
    /cf-chl-|id=["']challenge-form|<title>\s*(?:Just a moment|Access denied)/i.test(response.body)
  )
    throw Object.assign(new Error('Access challenge received.'), { stop: true });
  const doc = parseDocument(response.body, { decodeEntities: true });
  const title = first(doc, (node) => node.name === 'h1' && hasClass(node, 'job__title'));
  const description = first(doc, (node) => node.attribs?.id === 'job-description');
  const closed =
    /\b(?:this (?:job|position|role|posting)(?: posting)? (?:is|has been) (?:closed|filled|expired)|(?:this |the )?(?:position|role|job) is no longer (?:available|accepting applications)|we (?:have )?(?:already )?filled (?:this|the) (?:position|role)|we are no longer (?:hiring|accepting applications))\b/i;
  const noticeText = all(
    doc,
    (node) => ['h1', 'h2', 'h3'].includes(node.name) || hasClass(node, 'alert'),
  )
    .map(value)
    .join(' ');
  if (
    closed.test(noticeText) ||
    closed.test(value(description)) ||
    /\b(?:no longer available|position filled|job closed)\b/i.test(value(title))
  )
    return { state: 'Closed', skills: [] };
  if (
    !title ||
    title.attribs['data-jobid'] !== job.id ||
    !description ||
    description.attribs['data-jobid'] !== job.id
  )
    throw new Error('Job identity or detail markup could not be verified.');
  const typeHeader = first(doc, (node) => node.name === 'h3' && value(node) === 'TYPE OF WORK');
  const type = value(first(typeHeader?.parent || { children: [] }, (node) => node.name === 'p'));
  const current = { ...job, title: value(title), type };
  const detail = value(description);
  const ranking = rankMatch(current, detail);
  const skills = ranking.skills;
  if (!['Full Time', 'Part Time', 'Gig', 'Any'].includes(type) || !skills.length)
    return { state: 'Not a match', skills };
  const canApply = all(doc, (node) => ['h3', 'a', 'button'].includes(node.name)).some((node) =>
    /^(?:Please login or register as jobseeker to apply for this job\.|Apply (?:now|for this job))$/i.test(
      value(node),
    ),
  );
  if (!canApply) throw new Error('No current application control found.');
  return { state: 'Open', ...ranking, title: current.title, type: current.type };
}
