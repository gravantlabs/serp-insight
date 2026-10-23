# SERP Insight

A Chrome extension that shows what a Google results page says about a search: the topic entity, places, page IDs, AI overview sources, highlighted text and page sections.

## Install

1. Download this repository: **Code** then **Download ZIP** on GitHub. Unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Select **Load unpacked** and choose the unzipped folder.

That is all. The folder works as it is; there is no build step.

## Use

Search on Google, then open the extension. It has four views:

- **Overview:** number of organic results, AI sources that are also on page 1, the search topic, places, highlighted text and page sections.
- **Results:** each organic result with its page ID and URL. An orange label shows how the URL Google stores differs from the link it shows, for example `no www` or `no query`.
- **AI:** the AI overview sources, Google's note for each source and its organic rank. Open the AI overview and its source list on the page first.
- **Signals:** the topic entity (`/m/…` or `/g/…` ID), local places with their `/g/…` ID, rating and coordinates, highlighted text and page sections.

**Copy all** copies everything as tab-separated text.

## How it works

- `content.js` runs in the Google tab when you open the extension. It reads the page: links, inline page data and the `stick` link parameter.
- A page ID (`webresult_…`) holds Google's docid: the 64-bit fingerprint of the exact URL text. `docid.js` computes it (Jenkins lookup2, seeds `0` and `102072`), based on [google-docid-research](https://github.com/OliSeg/google-docid-research).
- The popup tries several forms of each result URL (scheme, `www`, trailing slash, query, fragment) and shows the one whose docid matches the page ID.
- Encrypted result links (`/goto?url=…`) are resolved by requesting them without cookies and reading the redirect.

## Permissions

| Permission | Used for |
|---|---|
| `activeTab`, `scripting` | Reading the Google tab you have open, only when you open the extension |
| `webRequest` | Reading the redirect of encrypted result links |
| `https://www.google.com/*` | Requesting encrypted result links |

## Data

- The extension stores nothing except the last view you opened.
- It sends no data anywhere. The only requests it makes are to `www.google.com`, without cookies, to resolve encrypted result links.

## Code style and build

- JavaScript follows the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html), with JSDoc.
- HTML and CSS follow the [Google HTML/CSS Style Guide](https://google.github.io/styleguide/htmlcssguide.html).
- Optional: `npm install` and `npm run build` write a minified copy to `dist/` (esbuild, no comments). You can load that folder instead.

## Changes

See [CHANGELOG.md](CHANGELOG.md).

## License

GPL-3.0. Copyright (C) 2026 GRAVANT LABS LLC. See [LICENSE](LICENSE).
