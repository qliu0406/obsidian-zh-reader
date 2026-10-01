// Tests for the magazine plugin outside Obsidian: pure output parsing + the real Magazine-ZH tool via Run.
// Usage: node test.js            (pure tests)
//        node test.js --real     (real tool + ChatGPT on a synthetic EPUB in a throwaway vault)
'use strict';
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') {
    class Stub {}
    return { Plugin: Stub, Modal: Stub, Notice: Stub, Setting: Stub, FileSystemAdapter: Stub, TFile: Stub, MarkdownRenderChild: Stub, setIcon() {} };
  }
  return realLoad.call(this, request, ...rest);
};
const { applyOutput, errorText, requestEstimate, fileToEpub, autoCandidates, resumeTime, loginStatus, newestCodex, Run } = require('../plugins/liuqing-magazine-zh/main.js');
{
  const now = Date.now() / 1000;
  const items = [
    { path: '/b/old.epub', mtime: now - 10 * 86400, imported: false, drm: false },
    { path: '/b/done.epub', mtime: now - 3600, imported: true, translated: 75, total: 75, drm: false },
    { path: '/b/half.epub', mtime: now - 7200, imported: true, translated: 10, total: 22, drm: false },
    { path: '/b/drm.epub', mtime: now - 3600, imported: false, drm: true },
    { path: '/b/gaveup.epub', mtime: now - 5000, imported: false, drm: false },
    { path: '/b/new2.epub', mtime: now - 60, imported: false, drm: false },
    { path: '/b/new1.epub', mtime: now - 600, imported: false, drm: false },
  ];
  const picked = autoCandidates(items, (now - 3 * 86400) * 1000, { '/b/gaveup.epub': { gaveUp: true } }).map(x => x.path);
  assert.deepStrictEqual(picked, ['/b/half.epub', '/b/new1.epub', '/b/new2.epub'], picked);
  const lib = applyOutput({ status: 'running', log: [], articles: {}, messages: [] }, '@@ {"event":"books","items":[{"path":"/x.epub"}]}');
  assert.strictEqual(lib.books[0].path, '/x.epub');
  // reset times: dated, time-only (later today / tomorrow), missing → 5 h
  const base = new Date(2026, 9, 1, 2, 41).getTime();
  const fmt = t => { const d = new Date(t); return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  assert.strictEqual(fmt(resumeTime('ChatGPT 账号的 Codex 用量已到上限，3:57 AM 恢复。', base)), '10-1 4:02');
  assert.strictEqual(fmt(resumeTime('用量已到上限，Oct 1st, 2026 4:08 AM 恢复。', base)), '10-1 4:13');
  assert.strictEqual(fmt(resumeTime('用量已到上限，1:10 AM 恢复。', base)), '10-1 7:41'); // tomorrow 1:10 is > 5 h away → 5 h cap
  assert.strictEqual(fmt(resumeTime('其他错误', base)), '10-1 7:41');
}
assert.deepStrictEqual(fileToEpub({ name: 'The Economist 2026-09-26.EPUB', path: '/x/y.epub' }), { path: '/x/y.epub', name: 'The Economist 2026-09-26' });

const empty = { status: 'running', log: [], issue: null, articles: {}, messages: [] };
let s = applyOutput(empty, '① 解析 EPUB…');
s = applyOutput(s, '@@ {"event":"article_start","id":3}');
s = applyOutput(s, '@@ {"event":"article_done","id":3,"note":"杂志中文稿/X/03 标题.md"}');
s = applyOutput(s, '@@ {"event":"article_failed","id":4,"error":"boom"}');
s = applyOutput(s, '@@ {"event":"issue","issue":{"magazine":"M","articles":[]}}');
s = applyOutput(s, '@@ not json');
assert.deepStrictEqual(s.log, ['① 解析 EPUB…']);
assert.strictEqual(s.articles[3].note, '杂志中文稿/X/03 标题.md');
assert.strictEqual(s.articles[4].status, 'failed');
assert.strictEqual(s.issue.magazine, 'M');
assert.strictEqual(empty.log.length, 0);
assert.strictEqual(requestEstimate([{ words: 500 }, { words: 2000 }, {}]), 1 + 3 + 1);
assert.strictEqual(errorText({ messages: ['Traceback (most recent call last):', 'SystemExit: 这不是有效的 EPUB 文件。'] }), 'SystemExit: 这不是有效的 EPUB 文件。');
console.log('pure tests: ok');
if (!process.argv.includes('--real')) process.exit(0);

(async () => {
  const codex = newestCodex();
  const status = await loginStatus();
  assert(codex && /\.codex\/plugins/.test(codex), `newest codex should be the Codex app copy, got ${codex}`);
  assert.strictEqual(status.ok, true, 'translator ChatGPT login should be active');
  console.log('account: ok →', codex.replace(os.homedir(), '~'), '| logged in', status.email ? '(email shown)' : '');
})().catch(err => { console.error('ACCOUNT TEST FAILED:', err.message); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmz-qa-'));
const vault = path.join(tmp, 'vault');
fs.mkdirSync(vault);
const epub = path.join(vault, 'Sample Economist.epub');
execFileSync('python3', [path.join(os.homedir(), 'Applications/Magazine-ZH/test_parse.py'), '--make', epub]);
const run = (action, extra, onState) => new Promise(resolve => {
  const r = new Run(action, epub, extra);
  r.listeners.add(st => { if (onState) onState(r, st); if (st.status !== 'running') resolve(r); });
  r.start(vault);
});
const alive = pattern => { try { return execSync(`pgrep -f "${pattern}"`).toString().trim(); } catch { return ''; } };

(async () => {
  let r = await run('status', []);
  assert.strictEqual(r.state.status, 'done');
  assert.strictEqual(r.state.issue, null);
  console.log('status before import: ok (not imported)');

  r = await run('import', []);
  assert.strictEqual(r.state.status, 'done', errorText(r.state));
  const issue = r.state.issue;
  assert.strictEqual(issue.articles.length, 4);
  assert(issue.articles.every(a => /[㐀-鿿]/.test(a.title_zh)), JSON.stringify(issue.articles.map(a => a.title_zh)));
  assert(issue.articles.every(a => a.section_zh), 'section names translated');
  assert(fs.existsSync(path.join(vault, issue.index)));
  console.log('import: ok →', issue.folder, '|', issue.articles.map(a => `${a.section_zh}/${a.title_zh}`).join('；'));

  r = await run('translate', ['--ids', '1,3']);
  assert.strictEqual(r.state.status, 'done', errorText(r.state));
  assert.strictEqual(r.state.articles[1].status, 'done');
  assert.strictEqual(r.state.articles[3].status, 'done');
  const note = fs.readFileSync(path.join(vault, r.state.articles[1].note), 'utf8');
  assert(note.includes('> [!quote]- 原文') && note.includes('### ') && note.includes('← 返回目录'), note.slice(0, 400));
  const index = fs.readFileSync(path.join(vault, r.state.issue.index), 'utf8');
  assert.strictEqual((index.match(/\[\[/g) || []).length, 2, index);
  assert.strictEqual((index.match(/未翻译/g) || []).length, 2, index);
  console.log('translate 2 articles: ok →', path.basename(r.state.articles[1].note), '+', path.basename(r.state.articles[3].note));

  r = await run('status', []);
  assert.strictEqual(r.state.issue.articles.filter(a => a.note).length, 2);
  console.log('status after translate: ok (2 notes remembered)');

  r = await run('translate', ['--ids', '2,4'], (job, st) => {
    if (!job.cancelAsked && Object.values(st.articles).some(a => a.status === 'running')) {
      job.cancelAsked = true;
      setTimeout(() => job.cancel(), 1500);
    }
  });
  assert.strictEqual(r.state.status, 'cancelled');
  await new Promise(res => setTimeout(res, 1500));
  assert.strictEqual(alive('magazine_zh.py translate'), '', 'tool still running');
  assert.strictEqual(alive(`codex exec.*${path.basename(os.homedir())}/Applications/Magazine-ZH/work`), '', 'codex still running');
  console.log('cancel mid-translation: ok (no leftover processes)');

  fs.writeFileSync(path.join(vault, 'broken.epub'), 'not a zip');
  const bad = await new Promise(resolve => {
    const b = new Run('import', path.join(vault, 'broken.epub'), []);
    b.listeners.add(st => { if (st.status !== 'running') resolve(b); });
    b.start(vault);
  });
  assert.strictEqual(bad.state.status, 'error');
  assert(errorText(bad.state).includes('不是有效的 EPUB'), errorText(bad.state));
  console.log('broken file: ok →', errorText(bad.state));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ALL TESTS PASSED');
})().catch(err => { console.error('TEST FAILED:', err.message); process.exit(1); });
