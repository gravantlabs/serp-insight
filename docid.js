/**
 * @fileoverview Google's docid for a URL: the 64-bit `Fingerprint()` of the
 * exact URL text. It is Bob Jenkins' lookup2 hash run with seeds 0 and
 * 102072. Source: https://github.com/OliSeg/google-docid-research
 */

const docid = (() => {
  /** Seed of the low 32 bits. */
  const SEED_LOW = 102072;

  /** Golden ratio constant that lookup2 starts `a` and `b` with. */
  const GOLDEN_RATIO = 0x9e3779b9;

  /**
   * The lookup2 mix step on three unsigned 32-bit values.
   * @param {number} a
   * @param {number} b
   * @param {number} c
   * @return {!Array<number>} The mixed `[a, b, c]`.
   */
  function mix(a, b, c) {
    a = (a - b - c) >>> 0;
    a = (a ^ (c >>> 13)) >>> 0;
    b = (b - c - a) >>> 0;
    b = (b ^ (a << 8)) >>> 0;
    c = (c - a - b) >>> 0;
    c = (c ^ (b >>> 13)) >>> 0;
    a = (a - b - c) >>> 0;
    a = (a ^ (c >>> 12)) >>> 0;
    b = (b - c - a) >>> 0;
    b = (b ^ (a << 16)) >>> 0;
    c = (c - a - b) >>> 0;
    c = (c ^ (b >>> 5)) >>> 0;
    a = (a - b - c) >>> 0;
    a = (a ^ (c >>> 3)) >>> 0;
    b = (b - c - a) >>> 0;
    b = (b ^ (a << 10)) >>> 0;
    c = (c - a - b) >>> 0;
    c = (c ^ (b >>> 15)) >>> 0;
    return [a, b, c];
  }

  /**
   * Reads four bytes as one little-endian word. Google's variant reads the
   * bytes as signed chars, which subtracts 0x100 from every byte >= 0x80.
   * @param {!Uint8Array} s
   * @param {number} i Offset.
   * @return {number}
   */
  function word(s, i) {
    const t = (s[i] | s[i + 1] << 8 | s[i + 2] << 16 | s[i + 3] << 24) >>> 0;
    const high = (t & 0x80808080) >>> 0;
    return (t - high - high) >>> 0;
  }

  /**
   * Google's 32-bit lookup2 hash. Whole words are read signed; the trailing
   * bytes are read unsigned. Variable names follow Jenkins' reference code.
   * @param {!Uint8Array} s
   * @param {number} seed
   * @return {number}
   */
  function jenkins32(s, seed) {
    let a = GOLDEN_RATIO;
    let b = a;
    let c = seed;
    let i = 0;
    let k = s.length;
    for (; k >= 12; i += 12, k -= 12) {
      a = (a + word(s, i)) >>> 0;
      b = (b + word(s, i + 4)) >>> 0;
      c = (c + word(s, i + 8)) >>> 0;
      [a, b, c] = mix(a, b, c);
    }
    c = (c + s.length) >>> 0;
    const t = s.subarray(i);
    const add = (x, v) => (x + v) >>> 0;
    if (k >= 8) {
      if (k >= 11) c = add(c, t[10] << 24 >>> 0);
      if (k >= 10) c = add(c, t[9] << 16);
      if (k >= 9) c = add(c, t[8] << 8);
      b = add(b, word(t, 4));
      a = add(a, word(t, 0));
    } else if (k >= 4) {
      if (k >= 7) b = add(b, t[6] << 16);
      if (k >= 6) b = add(b, t[5] << 8);
      if (k >= 5) b = add(b, t[4]);
      a = add(a, word(t, 0));
    } else {
      if (k >= 3) a = add(a, t[2] << 16);
      if (k >= 2) a = add(a, t[1] << 8);
      if (k >= 1) a = add(a, t[0]);
    }
    return mix(a, b, c)[2];
  }

  /**
   * @param {number} n
   * @return {string} `n` as 8 hex digits.
   */
  const hex = (n) => n.toString(16).padStart(8, '0');

  /**
   * Returns the docid of a URL as 16 hex digits.
   * @param {string} url Exact URL text; no normalization is applied.
   * @return {string}
   */
  function of(url) {
    const s = new TextEncoder().encode(url);
    return hex(jenkins32(s, 0)) + hex(jenkins32(s, SEED_LOW));
  }

  /**
   * Returns the docid inside a SERP page ID (`webresult_` suffix): the first
   * 8 bytes, little-endian.
   * @param {string} id 12 characters of base64url.
   * @return {string} 16 hex digits.
   */
  function fromId(id) {
    const bytes = Uint8Array.from(
        atob(id.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    return [...bytes.subarray(0, 8)]
        .reverse()
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
  }

  /**
   * Returns the URL as given, then every combination of other forms:
   * scheme, `www`, trailing slash, query and fragment.
   * @param {string} url
   * @return {!Array<!Array<string>>} Pairs of URL and a label that describes
   *     how it differs; the label is empty for the URL as given.
   */
  function variants(url) {
    const u = new URL(url);
    const out = [];
    const host = u.host;
    const path = u.pathname;
    const query = u.search;
    const https = u.protocol === 'https:';
    const schemes = [[u.protocol, ''], [https ? 'http:' : 'https:',
      https ? 'http' : 'https']];
    const hosts = [[host, ''], host.startsWith('www.') ?
        [host.slice(4), 'no www'] : ['www.' + host, 'www']];
    const paths = [[path, ''], path.endsWith('/') ?
        [path.slice(0, -1), 'no trailing slash'] :
        [path + '/', 'trailing slash']];
    const queries = query ? [[query, ''], ['', 'no query']] : [['', '']];
    const fragments =
        u.hash ? [[u.hash, ''], ['', 'no fragment']] : [['', '']];
    for (const [sc, l1] of schemes) {
      for (const [h, l2] of hosts) {
        for (const [p, l3] of paths) {
          for (const [s, l4] of queries) {
            for (const [f, l5] of fragments) {
              out.push([
                `${sc}//${h}${p}${s}${f}`,
                [l1, l2, l3, l4, l5].filter(Boolean).join(', '),
              ]);
            }
          }
        }
      }
    }
    return [[url, ''], ...out];
  }

  /**
   * Finds the form of a URL whose docid matches a SERP page ID.
   * @param {string} id SERP page ID.
   * @param {string} url
   * @return {?Array<string>} The matching URL and its label, or null.
   */
  function match(id, url) {
    const d = fromId(id);
    return variants(url).find(([v]) => of(v) === d) || null;
  }

  return {of, fromId, match};
})();
