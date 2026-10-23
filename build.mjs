// Builds the extension into dist/: JavaScript and CSS minified by esbuild
// (comments removed), other files copied as they are.
//
// Usage: npm run build

import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, rmSync} from 'node:fs';

const MINIFY = ['docid.js', 'popup.js', 'content.js', 'popup.css'];
const COPY = [
  'manifest.json',
  'popup.html',
  'icons',
  'logo.svg',
  'logo-dark.svg',
];

rmSync('dist', {recursive: true, force: true});
mkdirSync('dist');
execFileSync('node_modules/.bin/esbuild', [
  ...MINIFY,
  '--minify',
  '--legal-comments=none',
  '--outdir=dist',
  '--log-level=warning',
]);
for (const f of COPY) cpSync(f, `dist/${f}`, {recursive: true});
console.log('built dist/');
