const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const dist = path.resolve(projectRoot, 'dist');
if (path.dirname(dist) !== projectRoot || path.basename(dist) !== 'dist') {
  throw new Error('Refusing to clean an unexpected path.');
}
fs.rmSync(dist, { recursive: true, force: true });
