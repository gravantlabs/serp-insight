/**
 * @fileoverview Toolbar popup. Injects content.js into the active Google tab,
 * resolves result URLs and matches them to page IDs by docid, then shows the
 * data in four views.
 */

/** The four views, in tab order. */
const TABS = ['overview', 'results', 'ai', 'signals'];

/** Google's redirect for encrypted result links. */
const GOTO = 'https://www.google.com/goto?url=';

/** Matches Google host names on any country domain. */
const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/;

/**
 * @param {string} id
 * @return {?HTMLElement}
 */
const byId = (id) => document.getElementById(id);

/**
 * Creates an element with properties and children. Empty children are left
 * out.
 * @param {string} tag
 * @param {!Object=} props
 * @param {...(?Node|string|number|undefined)} children
 * @return {!HTMLElement}
 */
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(
      ...children.filter((c) => c !== null && c !== undefined && c !== ''));
  return node;
}

/**
 * Returns the Google search URL for a Knowledge Graph ID.
 * @param {string} id
 * @return {string}
 */
const kgUrl = (id) =>
    `https://www.google.com/search?kgmid=${encodeURIComponent(id)}`;

/**
 * Returns a button that copies text and shows a check mark for a moment.
 * @param {string} text
 * @param {string} label Accessible name.
 * @return {!HTMLElement}
 */
function copyButton(text, label) {
  const button = el('button', {
    className: 'icon-button',
    type: 'button',
    textContent: '⧉',
    title: 'Copy ID',
    ariaLabel: label,
  });
  button.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
      button.textContent = '✓';
      setTimeout(() => {
        button.textContent = '⧉';
      }, 1200);
    });
  });
  return button;
}

/**
 * @param {string} text
 * @param {string} kind `ok` or `warn`.
 * @return {!HTMLElement}
 */
const pill = (text, kind) =>
    el('span', {className: `pill ${kind}`, textContent: text});

/**
 * Builds a list row.
 * @param {?Node} lead Element before the text, or null.
 * @param {string} title
 * @param {?(string|!Node|!Array<string|!Node>)} sub Second line, or null.
 * @param {...?Node} trail Elements after the text.
 * @return {!HTMLElement}
 */
function item(lead, title, sub, ...trail) {
  const text =
      el('div', {className: 'row-text'}, el('b', {textContent: title}),
         sub ? el('small', {}, ...[].concat(sub)) : null);
  return el('li', {}, lead, text, ...trail);
}

/**
 * @param {!Array<!Node>} rows
 * @return {!HTMLElement}
 */
const list = (rows) => el('ul', {}, ...rows);

/**
 * Builds a row of chips with an optional count each.
 * @param {!Array<!Array<string|number>>} pairs Text and count.
 * @return {!HTMLElement}
 */
function chips(pairs) {
  return el(
      'div', {className: 'chips'},
      ...pairs.map(
          ([text, n]) =>
              el('span', {className: 'chip'}, text,
                 n > 1 ? el('i', {textContent: ` ×${n}`}) : null)));
}

/**
 * Returns a section heading, an optional hint, and the body.
 * @param {string} title
 * @param {!Node} body
 * @param {string=} hint
 * @return {!Array<!Node>}
 */
function group(title, body, hint) {
  return [
    el('h2', {textContent: title}),
    hint ? el('p', {className: 'hint', textContent: hint}) : null,
    body,
  ].filter(Boolean);
}

/**
 * Removes what Google adds to a result URL: `#:~:text=` fragments and the
 * `srsltid` parameter.
 * @param {string} url
 * @return {string}
 */
function tidy(url) {
  return url.replace(/#:~:.*$/, '')
      .replace(/([?&])srsltid=[^&#]*&?/, '$1')
      .replace(/[?&](?=#|$)/, '');
}

/**
 * Resolves the URL behind each result link and adds `url` and `form` to the
 * result whose page ID matches it by docid. Direct links are used as they
 * are; `/goto` links are requested without cookies and the `Location`
 * header of the redirect is read.
 * @param {!Array<!Object>} results
 * @param {!Array<string>} links
 * @return {!Promise<void>}
 */
async function resolve(results, links) {
  const waiting = new Map();
  const locations = new Map();
  const onHeaders = (details) => {
    const header = details.responseHeaders?.find(
        (h) => h.name.toLowerCase() === 'location');
    locations.set(details.url, header?.value || '');
    waiting.get(details.url)?.();
  };
  chrome.webRequest.onHeadersReceived.addListener(
      onHeaders, {urls: [`${GOTO}*`]}, ['responseHeaders']);
  const urls = await Promise.all(links.map(async (href) => {
    const parsed = new URL(href);
    const target = GOOGLE_HOST.test(parsed.hostname) &&
        parsed.pathname === '/goto' && parsed.searchParams.get('url');
    if (!target) return GOOGLE_HOST.test(parsed.hostname) ? '' : tidy(href);
    const request = GOTO + target;
    const seen = new Promise((done) => {
      waiting.set(request, done);
      setTimeout(done, 4000);
    });
    // The redirect is read from the response headers, not the fetch result.
    await fetch(request, {redirect: 'manual', credentials: 'omit'})
        .catch(() => {});
    if (!locations.has(request)) await seen;
    const raw = tidy(locations.get(request) || '');
    return /^https?:\/\//.test(raw) ? raw : '';
  }));
  chrome.webRequest.onHeadersReceived.removeListener(onHeaders);
  for (const result of results) {
    for (const url of urls) {
      const match = url && docid.match(result.id, url);
      if (match) {
        result.url = match[0];
        result.form = match[1];
        break;
      }
    }
  }
}

/**
 * Builds one line of "Copy all" with 8 tab-separated columns. Tabs and line
 * breaks inside a value become a space, so no value moves to another column.
 * @param {...*} values Up to 8 values; missing ones are empty.
 * @return {string}
 */
function tsvLine(...values) {
  return Array.from({length: 8}, (_, i) => values[i] ?? '')
      .map((v) => String(v).replace(/[\t\r\n]+/g, ' '))
      .join('\t');
}

/**
 * Shows one view and remembers it.
 * @param {string} tab
 */
function select(tab) {
  for (const t of TABS) {
    byId(`tab-${t}`).setAttribute('aria-selected', t === tab);
    byId(`tab-${t}`).tabIndex = t === tab ? 0 : -1;
    byId(`${t}-panel`).hidden = t !== tab;
  }
  try {
    localStorage.setItem('tab', tab);
  } catch {
    // Storage can be off; the popup then opens on the first view.
  }
}

/**
 * Draws all four views from the page data.
 * @param {!Object} data Result of content.js.
 */
function render(data) {
  const results = data.results || [];
  const ai = data.ai?.sources || [];
  const highlights = data.highlights || [];
  const sections = data.sections || [];
  const aiRanks = new Set(ai.map((s) => s.rank).filter(Boolean));
  const signals = data.query.length + data.places.length + highlights.length +
      sections.length;
  byId('query-text').textContent =
      data.q ? `“${data.q}” · ${results.length} results` : '';
  byId('tab-results').querySelector('i').textContent = results.length || '';
  byId('tab-ai').querySelector('i').textContent = ai.length || '';
  byId('tab-signals').querySelector('i').textContent = signals || '';

  const topic = data.query[0];
  const aiCard = ai.length ? `${aiRanks.size} / ${ai.length}` :
      data.ai?.found ? 'Hidden' :
                       '—';
  const aiCardLabel = ai.length ? 'AI sources on page 1' :
      data.ai?.found            ? 'AI overview sources' :
                                  'No AI overview';
  byId('overview-panel')
      .replaceChildren(
          el('div', {className: 'summary'},
             el('div', {className: 'card'},
                el('b', {textContent: results.length}),
                el('small', {textContent: 'Organic results'})),
             el('div', {className: 'card'}, el('b', {textContent: aiCard}),
                el('small', {textContent: aiCardLabel})),
             el('div', {className: 'card wide'},
                el('small', {textContent: 'Search topic'}), el('b', {
                  textContent: topic ?
                      `${topic.name || topic.id} · ${topic.id}` :
                      'No entity on this page',
                })),
             data.places.length ?
                 el('div', {className: 'card wide'},
                    el('small', {textContent: 'Places'}), el('b', {
                      textContent: `${data.places.length} local businesses`,
                    })) :
                 null),
          ...(highlights.length ? group(
                                      'What Google highlights',
                                      chips(highlights.slice(0, 14).map(
                                          (h) => [h.text, h.n]))) :
                                  []),
          ...(sections.length ?
                  group('Page sections', chips(sections.map((s) => [s, 1]))) :
                  []));

  const resultRow = (r) => {
    const row = item(
        el('span', {className: 'rank', textContent: r.rank}), r.site || r.title,
        [
          el('code', {textContent: r.id}),
          ` · ${r.url ? r.url.replace(/^https?:\/\//, '') : r.title}`,
        ],
        aiRanks.has(r.rank) ? pill('AI', 'ok') : null,
        r.form ? pill(r.form[0].toUpperCase() + r.form.slice(1), 'warn') : null,
        copyButton(r.id, `Copy page ID of ${r.site || r.title}`));
    row.title = r.url ? `${r.title}\n${r.url}` : r.title;
    return row;
  };
  byId('results-panel')
      .replaceChildren(...(
          results.length ?
              group(
                  'Organic results', list(results.map(resultRow)),
                  'Page ID: Google’s ID for one exact URL. An orange label ' +
                      'shows how the URL Google stores differs from the link ' +
                      'it shows.') :
              [el('p', {
                className: 'hint',
                textContent: 'No organic results found.'
              })]));

  const aiRow = (s) => {
    const row = item(
        null, s.name, s.note || null,
        s.rank ? pill(`#${s.rank}`, 'ok') : pill('Not on page 1', 'warn'));
    row.classList.add('wrap');
    return row;
  };
  const aiEmpty = data.ai?.found ?
      'This page has an AI overview, but its sources are not loaded yet. ' +
          'Open the AI overview on the page (Show more), then open this ' +
          'again.' :
      'This page has no AI overview.';
  byId('ai-panel')
      .replaceChildren(
          ...(ai.length ?
                  group(
                      'AI overview sources', list(ai.map(aiRow)),
                      ai.some((s) => s.note) ?
                          '' :
                          'Open the AI overview and its source list on the ' +
                              'page to see Google’s note for each source.') :
                  [el('p', {className: 'hint', textContent: aiEmpty})]));

  const topicRow = (e) => item(
      null, e.name || e.id,
      [el('code', {textContent: e.id}), e.section ? ` · ${e.section}` : ''],
      copyButton(e.id, `Copy ID of ${e.name}`), el('a', {
        className: 'icon-button',
        href: kgUrl(e.id),
        target: '_blank',
        rel: 'noopener',
        textContent: '↗',
        title: 'Open in Google',
        ariaLabel: `Open ${e.name} in Google`,
      }));
  const placeRow = (p) => item(
      null, p.name, [el('code', {textContent: p.id}), ` · ${p.rating}/5`],
      copyButton(p.id, `Copy ID of ${p.name}`));
  const highlightRow = (h) => {
    const row = item(null, h.text, h.n > 1 ? `×${h.n}` : null);
    row.classList.add('wrap');
    return row;
  };
  byId('signals-panel')
      .replaceChildren(
          ...group(
              'Search topic',
              data.query.length ? list(data.query.map(topicRow)) : el('p', {
                className: 'hint',
                textContent: 'No entity on this page.'
              })),
          ...(data.places.length ?
                  group('Places', list(data.places.map(placeRow))) :
                  []),
          ...(highlights.length ? group(
                                      'What Google highlights',
                                      list(highlights.map(highlightRow))) :
                                  []),
          ...(sections.length ?
                  group('Page sections', chips(sections.map((s) => [s, 1]))) :
                  []));

  byId('copy-all').hidden = false;
  byId('copy-all').addEventListener('click', () => {
    const lines = [
      tsvLine(
          'type', 'name', 'id', 'rank_or_rating', 'lat', 'lng_or_note', 'url',
          'url_form'),
      ...data.query.map((e) => tsvLine('topic', e.name, e.id)),
      ...data.places.map(
          (p) => tsvLine('place', p.name, p.id, p.rating, p.lat, p.lng)),
      ...results.map(
          (r) => tsvLine(
              'result', r.site || r.title, `webresult_${r.id}`, r.rank, '',
              r.title, r.url || '', r.url ? r.form || 'as shown' : '')),
      ...ai.map((s) => tsvLine('ai_source', s.name, '', s.rank, '', s.note)),
      ...highlights.map((h) => tsvLine('highlight', h.text, '', h.n)),
      ...sections.map((section) => tsvLine('section', section)),
    ];
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      byId('copy-all').textContent = 'Copied';
    });
  });

  byId('view-tabs').hidden = false;
  let start = 'overview';
  try {
    const saved = localStorage.getItem('tab');
    start = TABS.includes(saved) ? saved : 'overview';
  } catch {
    // Storage can be off; open on the first view.
  }
  select(start);
}

byId('view-tabs').addEventListener('click', (e) => {
  const button = e.target.closest('[role=tab]');
  if (button) select(button.id.slice(4));
});

byId('view-tabs').addEventListener('keydown', (e) => {
  const i = TABS.findIndex((t) => byId(`tab-${t}`) === document.activeElement);
  if (i < 0 || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const step = e.key === 'ArrowRight' ? 1 : TABS.length - 1;
  const next = TABS[(i + step) % TABS.length];
  select(next);
  byId(`tab-${next}`).focus();
});

(async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  let data;
  try {
    const url = new URL(tab.url);
    if (GOOGLE_HOST.test(url.hostname) && url.pathname === '/search') {
      const [injection] = await chrome.scripting.executeScript(
          {target: {tabId: tab.id}, files: ['content.js']});
      data = injection?.result;
    }
  } catch (e) {
    byId('status-message').textContent =
        `Could not read this page (${e.message}).`;
    return;
  }
  if (!data) {
    byId('status-message').textContent =
        'Open a Google results page, then open this again.';
    return;
  }
  byId('status-message').textContent = 'Reading result URLs…';
  // Without resolved URLs the results still show, only without addresses.
  await resolve(data.results || [], data.links || []).catch(() => {});
  byId('status-message').textContent = '';
  render(data);
})();
