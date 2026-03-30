import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredPaths = [
  'README.md',
  'package.json',
  'pnpm-workspace.yaml',
  'docs/plans/2026-03-30-bananas31-operator-cockpit-design.md',
  'docs/plans/2026-03-30-bananas31-operator-cockpit-implementation.md',
  'apps/web/README.md',
  'services/api/README.md',
  'services/collectors/README.md',
  'packages/contracts/README.md',
  'packages/ui/README.md'
];

const missing = requiredPaths.filter(relPath => !fs.existsSync(path.join(root, relPath)));

if (missing.length) {
  console.error('Missing bootstrap files:');
  for (const relPath of missing) console.error(`- ${relPath}`);
  process.exit(1);
}

console.log('Bootstrap check passed.');

