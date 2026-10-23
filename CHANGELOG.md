# Changelog

Format: `component: change`. Versions follow [SemVer](https://semver.org/).

## 0.1.0 - 2026-10-23

### Added
- `content.js`: reads the Google results page: organic results (rank, site, title, page ID `webresult_…`), AI overview sources with Google's note and their organic rank, the search topic entity (`/m/…` or `/g/…`) from `stick` parameters, local pack places (name, rating, coordinates, `/g/…` ID), highlighted text and page sections.
- `docid.js`: Google docid of a URL (Jenkins lookup2 `Fingerprint()`, seeds `0` and `102072`); URL form variants (scheme, `www`, trailing slash, query, fragment).
- `popup.js`: four views (Overview, Results, AI, Signals); resolves `/goto` redirects on `www.google.com` without cookies and matches every page ID to a URL by docid; copy one ID, copy all as TSV, open an ID in Google (`kgmid`).
- `popup.js`: injects `content.js` into the active tab on each open, so every Google domain works.
- `manifest.json`: permissions `activeTab`, `scripting`, `webRequest`; host permission `https://www.google.com/*`.
- `build.mjs`: optional `npm run build` writes a minified copy to `dist/` (esbuild, no comments).
- `LICENSE`: GPL-3.0, copyright GRAVANT LABS LLC.
