/**
 * @fileoverview Injected into a Google results page by the popup. Reads what
 * the page says about the search and returns it as the script's result.
 */

(async () => {
  /**
   * A result row read from the page.
   * @typedef {{title: string, site: string, host: string}}
   */
  let OrganicLink;

  /** Matches Google host names on any country domain. */
  const GOOGLE_HOST = /(^|\.)google\.[a-z.]+$/;

  /**
   * Heading text of the AI overview by Google interface language: AI (en and
   * most others), KI (de), IA (fr, es, it, pt), ИИ (ru), ШІ (uk), Yapay zekâ
   * (tr).
   */
  const AI_HEADING = /\bAI\b|\bKI\b|\bIA\b|(^|\s)(ИИ|ШІ)(\s|$)|Yapay zek/i;

  /**
   * @param {!Uint8Array} bytes
   * @return {string}
   */
  const text = (bytes) => new TextDecoder().decode(bytes);

  /**
   * Collapses whitespace.
   * @param {string} s
   * @return {string}
   */
  const clean = (s) => s.replace(/\s+/g, ' ').trim();

  /**
   * Returns the results area of the page.
   * @return {!Element}
   */
  const main = () => document.querySelector('[role="main"]') ||
      document.getElementById('search') || document.body;

  /**
   * Checks whether a link leads to a result: an encrypted `/goto` link, or
   * a direct link off Google. Which one Google sends depends on the browser.
   * @param {!Element} link
   * @return {boolean}
   */
  function isResultLink(link) {
    let url;
    try {
      url = new URL(link.href);
    } catch {
      // No or invalid href: not a result link.
      return false;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return GOOGLE_HOST.test(url.hostname) ? url.pathname === '/goto' : true;
  }

  /**
   * Returns the result links inside an element.
   * @param {!Element} root
   * @return {!Array<!Element>}
   */
  const resultLinksIn = (root) =>
      [...root.querySelectorAll('a[href]')].filter(isResultLink);

  /**
   * Returns the text of all inline scripts, where Google keeps page data.
   * @return {string}
   */
  const scriptText = () =>
      [...document.scripts].map((s) => s.textContent).join('\n');

  /**
   * Decodes a base64url string and gunzips it.
   * @param {string} b64 Base64url text, with or without padding.
   * @return {!Promise<!Uint8Array>}
   */
  async function gunzip(b64) {
    const s = b64.replace(/-/g, '+').replace(/_/g, '/');
    const padded = s + '='.repeat((4 - s.length % 4) % 4);
    const bin = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(
        new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Reads the length-delimited fields of a protobuf message. Other wire
   * types are skipped.
   * @param {!Uint8Array} bytes
   * @return {!Array<!Array<number|!Uint8Array>>} Pairs of field number and
   *     value bytes.
   */
  function fields(bytes) {
    const out = [];
    let i = 0;
    const varint = () => {
      let n = 0;
      let shift = 0;
      let c;
      do {
        c = bytes[i++];
        n += (c & 127) * 2 ** shift;
        shift += 7;
      } while (c & 128);
      return n;
    };
    while (i < bytes.length) {
      const tag = varint();
      const field = Math.floor(tag / 8);
      const wire = tag % 8;
      if (wire === 0) {
        varint();
      } else if (wire === 2) {
        const length = varint();
        out.push([field, bytes.slice(i, i + length)]);
        i += length;
      } else if (wire === 5) {
        i += 4;
      } else if (wire === 1) {
        i += 8;
      } else {
        break;
      }
    }
    return out;
  }

  /**
   * Reads the entities the search is tied to from `stick` link parameters.
   * @return {!Promise<!Array<{id: string, name: string, section: string}>>}
   */
  async function queryEntities() {
    const found = new Map();
    for (const link of document.querySelectorAll('a[href*="stick="]')) {
      const stick = new URL(link.href, location.href).searchParams.get('stick');
      if (!stick) continue;
      try {
        const parts = fields(await gunzip(stick));
        const get = (n) => {
          const part = parts.find(([k]) => k === n);
          return part ? text(part[1]) : '';
        };
        const id = get(2);
        if (/^\/[mg]\//.test(id)) {
          found.set(id, {id, name: get(84), section: get(31)});
        }
      } catch {
        // Not every `stick` value is a gzipped entity; skip the ones that
        // are not.
      }
    }
    return [...found.values()];
  }

  /**
   * Reads local pack places (rating, coordinates, name, `/g/` ID) from page
   * data.
   * @return {!Array<{id: string, name: string, rating: string, lat: number,
   *     lng: number}>}
   */
  function places() {
    const src = scriptText();
    const record =
        /\["(\d[,.]\d)\/5",\[(-?\d+\.\d+),(-?\d+\.\d+)\],"((?:[^"\\]|\\.)+)"/g;
    const found = new Map();
    let m;
    while ((m = record.exec(src))) {
      // The place ID follows its record, before the next record starts.
      const rest = src.slice(record.lastIndex, record.lastIndex + 20000);
      const id = rest.match(/"(\/g\/[0-9a-z_]+)"/);
      const next = rest.search(/\["\d[,.]\d\/5",\[/);
      if (!id || (next >= 0 && next < id.index)) continue;
      if (!found.has(id[1])) {
        found.set(id[1], {
          id: id[1],
          name: JSON.parse(`"${m[4]}"`),
          rating: m[1],
          lat: +m[2],
          lng: +m[3],
        });
      }
    }
    return [...found.values()];
  }

  /**
   * Counts the text Google marks in the results area.
   * @return {!Array<{text: string, n: number}>} Most frequent first.
   */
  function highlights() {
    const count = new Map();
    for (const mark of main().querySelectorAll('em, b, strong, mark')) {
      const t = clean(mark.textContent);
      if (t.length > 1 && t.length < 160) count.set(t, (count.get(t) || 0) + 1);
    }
    return [...count]
        .sort((a, b) => b[1] - a[1])
        .map(([text, n]) => ({text, n}));
  }

  /**
   * Returns the level-2 headings in the results area.
   * @return {!Array<string>}
   */
  function sections() {
    const seen = new Set();
    const selector = 'h2, [role="heading"][aria-level="2"]';
    for (const heading of main().querySelectorAll(selector)) {
      const t = clean(heading.textContent);
      if (t && t.length < 80) seen.add(t);
    }
    return [...seen];
  }

  /**
   * Returns the organic result links in page order.
   * @return {!Array<!OrganicLink>}
   */
  function organic() {
    const out = [];
    for (const title of main().querySelectorAll('a h3')) {
      const link = title.closest('a');
      if (!isResultLink(link)) continue;
      const site = clean(link.textContent.slice(title.textContent.length))
                       .replace(/\s*https?:\/\/.*$/, '');
      const url = link.textContent.match(/https?:\/\/([^\s›]+)/);
      const host = url ? url[1] : '';
      out.push({
        title: clean(title.textContent),
        site,
        host: host.replace(/^www\./, ''),
      });
    }
    return out;
  }

  /**
   * Parses a JSON string body, or returns it as it is when it is not valid.
   * @param {string} s
   * @return {string}
   */
  function unescapeJson(s) {
    try {
      return JSON.parse(`"${s}"`);
    } catch {
      // Cut-off escapes at a match boundary; the raw text is good enough.
      return s;
    }
  }

  /**
   * Reads organic results with their page IDs from page data.
   * @return {!Array<{rank: number, title: string, site: string, id: string}>}
   */
  function results() {
    const src = scriptText();
    // Detailed records: link, title, ..., site name, then the page ID.
    const rich = new Map();
    const strict = new RegExp(
        String.raw`\["\/goto\?url\\u003d[A-Za-z0-9_\-]+","((?:[^"\\]|\\.)*)",` +
            String.raw`"(?:[^"\\]|\\.)*",[\s\S]{0,300}?,"((?:[^"\\]|\\.)*)"\]` +
            String.raw`[\s\S]{0,600}?"webresult_([A-Za-z0-9_\-]+)"`,
        'g');
    let m;
    while ((m = strict.exec(src))) {
      if (!rich.has(m[3])) {
        rich.set(m[3], {title: unescapeJson(m[1]), site: unescapeJson(m[2])});
      }
    }
    // Every result has a short "title - site" record; it sets the order.
    const out = new Map();
    const loose =
        /\[null,null,"((?:[^"\\]|\\.)*)","webresult_([A-Za-z0-9_\-]+)"/g;
    while ((m = loose.exec(src))) {
      if (out.has(m[2])) continue;
      const label = unescapeJson(m[1]);
      const cut = label.lastIndexOf(' - ');
      const record = rich.get(m[2]) || {
        title: cut > 0 ? label.slice(0, cut) : label,
        site: cut > 0 ? label.slice(cut + 3) : '',
      };
      out.set(m[2], {
        rank: out.size + 1,
        title: record.title,
        site: record.site,
        id: m[2],
      });
    }
    return [...out.values()];
  }

  /**
   * Walks up from a heading, at most 8 levels, until `found` is true for
   * the box.
   * @param {!Element} heading
   * @param {function(!Element): boolean} found
   * @return {!Element}
   */
  function boxAround(heading, found) {
    let box = heading;
    let depth = 0;
    while (box.parentElement && depth++ < 8 && !found(box)) {
      box = box.parentElement;
    }
    return box;
  }

  /**
   * Returns the accessible name of a link.
   * @param {!Element} link
   * @return {string}
   */
  function linkLabel(link) {
    return link.getAttribute('aria-label') ||
        (link.getAttribute('aria-labelledby') || '')
            .split(' ')
            .map((id) => document.getElementById(id)?.textContent || '')
            .join(' ');
  }

  /**
   * Returns the text nodes of a list item outside links and buttons.
   * @param {!Element} item
   * @return {!Array<string>}
   */
  function plainTexts(item) {
    const texts = [];
    const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.parentElement.closest('a, button')) continue;
      const t = clean(walker.currentNode.textContent);
      if (t) texts.push(t);
    }
    return texts;
  }

  /**
   * Reads the AI overview sources, with Google's note per source and the
   * organic rank of the same site.
   * @param {!Array<!OrganicLink>} organicLinks
   * @return {?{found: boolean, sources: !Array<{name: string, note: string,
   *     rank: ?number}>}} Null when the page has no AI overview.
   */
  function aiSources(organicLinks) {
    const headings =
        [...document.querySelectorAll('h2, [role="heading"][aria-level="2"]')]
            .filter((h) => AI_HEADING.test(h.textContent));
    if (!headings.length) return null;
    const found = new Map();
    // Source links: the name is the link text, or the first text of its list
    // item; the rest of that item is Google's note.
    for (const heading of headings) {
      const box = boxAround(heading, (b) => resultLinksIn(b).length > 0);
      for (const link of resultLinksIn(box)) {
        if (link.querySelector('h3')) continue;
        const token = link.getAttribute('href');
        let site =
            clean(link.textContent) || clean(linkLabel(link)).slice(0, 80);
        let note = '';
        const item = link.closest('li');
        if (item && box.contains(item) &&
            (item.firstElementChild === link ||
             item.firstElementChild?.contains(link))) {
          const texts = plainTexts(item);
          if (texts.length) {
            site = texts[0];
            note = clean(texts.slice(1).join(' ')).slice(0, 220);
          }
        }
        if (!site) continue;
        const previous = found.get(token) || {name: site, note: ''};
        found.set(token, {
          name: note ? site : previous.name,
          note: note.length > previous.note.length ? note : previous.note,
        });
      }
    }
    // Citation buttons ("Site +2") name sources whose links are not loaded.
    const names = new Set([...found.values()].map((s) => s.name.toLowerCase()));
    for (const heading of headings) {
      const box = boxAround(
          heading, (b) => !!b.querySelector('[role="button"], button'));
      for (const button of box.querySelectorAll('[role="button"], button')) {
        const label =
            clean(button.getAttribute('aria-label') || button.textContent);
        const m = label.match(/^(.{2,60}?)\s*\(?\+\d+\)?(\s|$)/);
        if (m && !names.has(m[1].toLowerCase())) {
          names.add(m[1].toLowerCase());
          found.set(`btn:${m[1]}`, {name: m[1], note: ''});
        }
      }
    }
    for (const source of found.values()) {
      const name = source.name.toLowerCase().replace(/^www\./, '');
      const i = organicLinks.findIndex(
          (o) => o.site.toLowerCase().includes(name) ||
              name.includes(o.site.toLowerCase()) ||
              (o.host && name.includes(o.host.split('.')[0])));
      source.rank = i >= 0 ? i + 1 : null;
    }
    const unique = new Map();
    for (const source of found.values()) {
      const previous = unique.get(source.name);
      if (!previous || source.note.length > previous.note.length) {
        unique.set(source.name, source);
      }
    }
    return {found: true, sources: [...unique.values()]};
  }

  const resultLinks = [...document.querySelectorAll('a:has(h3)')]
      .map((a) => a.href)
      .filter((h) => /^https?:/.test(h));
  return {
    query: await queryEntities(),
    places: places(),
    highlights: highlights(),
    sections: sections(),
    ai: aiSources(organic()),
    results: results(),
    links: [...new Set(resultLinks)],
    q: new URL(location.href).searchParams.get('q') || '',
  };
})();
