const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

// A changed bundle also changes the worker, triggering a complete cache update.
const projectRoot = path.resolve(__dirname, '..');
const html = readFileSync(path.join(projectRoot, 'dist/index.html'), 'utf8');
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
const source = readFileSync(path.join(projectRoot, 'public/sw.js'), 'utf8');
writeFileSync(path.join(projectRoot, 'dist/sw.js'), source.replace("'sumsurge-v1'", `'sumsurge-${version}'`));
