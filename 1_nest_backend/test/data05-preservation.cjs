// Read-only streaming comparison; hashes file bytes without printing contents.
const fs = require('node:fs');
const p = require('node:path');
const crypto = require('node:crypto');
const backend = p.resolve(__dirname, '..');
if (!/Tiktok_Automation_data05[\\/]1_nest_backend$/.test(backend))
  throw Error('Dedicated worktree required');
const reports = p.join(backend, '.studio-data/reports/data05');
const beforeFile = p.join(reports, 'production-before.json');
const before = JSON.parse(fs.readFileSync(beforeFile));
const expected = p.resolve(
  backend,
  '../../Tiktok_Automation/1_nest_backend/.studio-data',
);
if (p.resolve(before.root) !== expected)
  throw Error('Production baseline path mismatch');
const digest = (file) =>
  new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => h.update(chunk));
    stream.on('end', () => resolve(h.digest('hex')));
    stream.on('error', reject);
  });
async function walk(dir, out = []) {
  for (const item of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = p.join(dir, item.name);
    if (item.isSymbolicLink()) throw Error('Unexpected production symlink');
    if (item.isDirectory()) await walk(file, out);
    else if (item.isFile()) out.push(p.relative(before.root, file));
  }
  return out;
}
(async () => {
  const present = new Set(await walk(before.root));
  const files = [],
    changes = [];
  for (const original of before.files) {
    present.delete(original.file);
    let row;
    try {
      row = {
        file: original.file,
        sha256: await digest(p.join(before.root, original.file)),
      };
    } catch (e) {
      row = {
        file: original.file,
        status: e.code === 'ENOENT' ? 'MISSING' : 'UNREADABLE',
      };
    }
    files.push(row);
    if (row.sha256 !== original.sha256 || row.status)
      changes.push({ file: row.file, status: row.status || 'CHANGED' });
  }
  for (const file of [...present].sort()) {
    files.push({ file, sha256: await digest(p.join(before.root, file)) });
    changes.push({ file, status: 'ADDED' });
  }
  const afterFile = p.join(reports, 'production-after-' + Date.now() + '.json');
  fs.writeFileSync(
    afterFile,
    JSON.stringify({ root: before.root, files }, null, 2),
  );
  const result = {
    compared: before.files.length,
    changes,
    beforeManifestSha256: await digest(beforeFile),
    afterManifestSha256: await digest(afterFile),
    mode: 'READ_ONLY_STREAMING',
    status: changes.length ? 'DIFFERENCES' : 'UNCHANGED',
  };
  fs.writeFileSync(
    p.join(reports, 'preservation-result.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  if (changes.length) process.exitCode = 1;
})().catch((e) => {
  console.error('DATA05_PRESERVATION_FAILED', e.code || e.message);
  process.exitCode = 1;
});
