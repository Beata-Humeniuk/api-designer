const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'media', 'designer.css'), 'utf8');
const checks = [];

const ansi = (css.match(/--vscode-terminal-ansi[A-Za-z]+/g) || []);
checks.push([ansi.length === 0,
  'no text colour is taken from the terminal palette' + (ansi.length ? ' (found ' + ansi.join(', ') + ')' : '')]);

checks.push([/\.xbox\.xroot \.xn\{color:var\(--fg-bright\)/.test(css),
  'the schema box title uses the editor foreground, not the button foreground']);

checks.push([/--active-fg:var\(--vscode-list-activeSelectionForeground/.test(css),
  'the selection has a foreground of its own']);
checks.push([/\.trow\.on\{[^}]*color:var\(--active-fg\)/.test(css),
  'a selected tree row uses it']);

checks.push([/body\.vscode-light[^{]*\{/.test(css),
  'light editors carry their own fallback palette']);

let failed = false;
for (const [ok, name] of checks) {
  if (!ok) { console.error('FAIL: ' + name); failed = true; }
  else console.log('OK: ' + name);
}
if (!failed) console.log('PASS: panel colours survive a light theme');
process.exit(failed ? 1 : 0);
