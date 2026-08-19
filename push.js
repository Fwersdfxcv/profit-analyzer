// GitHub Git Database API force-push
// Usage: GITHUB_TOKEN=xxx node push.js <rootDir>
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('Missing GITHUB_TOKEN env'); process.exit(2); }
const OWNER = process.env.GH_OWNER || 'Fwersdfxcv';
const REPO = process.env.GH_REPO || 'profit-analyzer';
const BRANCH = 'main';
const ROOT = process.argv[2] || '.';
const ALLOW = (process.env.GH_EXT || 'html,css,js,json,md').split(',').map(s=>'.'+s);

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      hostname: 'api.github.com', port: 443, path: urlPath, method,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'push-script'
      }
    };
    if (data) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = data.length; }
    const req = https.request(opts, res => {
      let chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(text ? JSON.parse(text) : null); } catch (e) { resolve(text); }
        } else reject(new Error('HTTP ' + res.statusCode + ': ' + text.slice(0, 400)));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listFiles(root) {
  const out = [];
  const skip = new Set(['.git', 'node_modules']);
  const allowExt = new Set(ALLOW);
  function walk(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(ent.name)) continue;
      if (ent.name.startsWith('_') && ent.name.endsWith('.js')) continue;
      const full = path.join(dir, ent.name);
      const r = rel ? path.posix.join(rel, ent.name) : ent.name;
      if (ent.isDirectory()) walk(full, r);
      else if (ent.isFile() && allowExt.has(path.extname(ent.name).toLowerCase())) out.push(r);
    }
  }
  walk(root, '');
  return out;
}

(async () => {
  console.log('Root:', ROOT);
  const files = await listFiles(ROOT);
  console.log('Files:', files.length);
  const refRes = await api('GET', `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const parentSha = refRes.object.sha;
  console.log('HEAD:', parentSha);
  const commitRes = await api('GET', `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);
  const baseTreeSha = commitRes.tree.sha;
  console.log('Base tree:', baseTreeSha);
  const treeEntries = [];
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const buf = fs.readFileSync(abs);
    const blob = await api('POST', `/repos/${OWNER}/${REPO}/git/blobs`, { content: buf.toString('base64'), encoding: 'base64' });
    treeEntries.push({ path: rel.replace(/\\/g, '/'), mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write('.');
  }
  console.log('\nBlobs:', treeEntries.length);
  const newTree = await api('POST', `/repos/${OWNER}/${REPO}/git/trees`, { tree: treeEntries, base_tree: baseTreeSha });
  console.log('Tree:', newTree.sha);
  const newCommit = await api('POST', `/repos/${OWNER}/${REPO}/git/commits`, {
    message: 'fix: 必须先设置保存路径才能上传；修复提示横幅；上传成功醒目反馈',
    tree: newTree.sha, parents: [parentSha]
  });
  console.log('Commit:', newCommit.sha);
  await api('PATCH', `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { sha: newCommit.sha, force: true });
  console.log('DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });