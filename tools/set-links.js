// Fills in the GitHub and Ko-fi usernames everywhere they appear.
// Usage: node tools/set-links.js <github-user> <kofi-user>
const fs = require('fs');
const path = require('path');
const [gh, kofi] = process.argv.slice(2);
if (!gh || !kofi) {
  console.error('Uso: node tools/set-links.js <usuario-github> <usuario-kofi>');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const files = [
  'extension/config.js', 'extension/manifest.json', 'docs/index.html', 'docs/install.sh',
  'README.md', '.github/FUNDING.yml', '.github/release-notes.md',
];
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replaceAll('__GH_USER__', gh).replaceAll('__KOFI_USER__', kofi);
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log('actualizado', f);
  }
}
