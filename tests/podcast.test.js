// Tests for the plugin's logic outside Obsidian: pure parsers + the real tool driven through Job.
// Usage: node test.js            (pure tests only)
//        node test.js --real     (also runs the real Podcast-ZH tool; needs ~/Applications access)
'use strict';
const assert = require('assert');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// Minimal stand-in for the 'obsidian' module so main.js can load under Node.
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'obsidian') {
    class Stub {}
    return { Plugin: Stub, Modal: Stub, Notice: Stub, Setting: Stub, FileSystemAdapter: Stub, TFile: Stub, MarkdownRenderChild: Stub, setIcon() {} };
  }
  return realLoad.call(this, request, ...rest);
};
const plugin = require('../plugins/liuqing-podcast-zh/main.js');
const { applyLine, applyError, errorText, looksLikeEpisode, Job } = plugin;

const empty = { status: 'running', steps: [], notePath: '', messages: [] };

// --- pure parsing ---
let s = empty;
for (const line of ['① 查找这一集…', '  《Title》 · Show · 2026-09-28 · 09:25', '② 下载音频…', '③ 本机语音识别（英文）…',
  '  转写 40%', '  识别完成：15 段，约 1843 词，用时 00:08', '④ 生成要点和术语表（ChatGPT）…', '⑤ 翻译全文（ChatGPT gpt-6-luna）…',
  '· 译文已有缓存，直接使用。', '  翻译 2/3 组', '✅ 完成，总用时 01:47。', '   文稿：/Users/x/liu/播客中文稿/2026-09-28 A - 富人.md', '']) {
  s = applyLine(s, line);
}
assert.strictEqual(s.steps.length, 6);
assert.strictEqual(s.steps[0].detail, '《Title》 · Show · 2026-09-28 · 09:25');
assert.strictEqual(s.steps[2].detail, '识别完成：15 段，约 1843 词，用时 00:08');
assert.strictEqual(s.steps[4].detail, '翻译 2/3 组');
assert.strictEqual(s.notePath, '/Users/x/liu/播客中文稿/2026-09-28 A - 富人.md');
assert.strictEqual(empty.steps.length, 0, 'applyLine must not mutate its input');

let e = applyLine(empty, '② 下载音频…');
e = applyError(e, '\r########                 23.4%\r################         51.0%');
assert.strictEqual(e.steps[0].detail, '下载 51%');
assert.strictEqual(e.messages.length, 0);
e = applyError(e, 'Traceback (most recent call last):\n  File "x.py", line 3\nurllib.error.URLError: boom\n');
assert.strictEqual(errorText(e), 'urllib.error.URLError: boom');
assert.strictEqual(errorText(applyError(empty, 'Apple 的公开目录和节目 RSS 里都找不到这一集。\n')), 'Apple 的公开目录和节目 RSS 里都找不到这一集。');

assert(looksLikeEpisode('https://podcasts.apple.com/hk/podcast/x/id1495072403?i=1000791437548'));
assert(!looksLikeEpisode('https://podcasts.apple.com/us/podcast/economist-podcasts/id151230264'));
assert(!looksLikeEpisode('hello'));
console.log('pure tests: ok');

if (!process.argv.includes('--real')) process.exit(0);

// --- real tool through Job ---
const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lpz-qa-vault-'));
const run = (source, onState) => new Promise(resolve => {
  const job = new Job({}, source, 'gpt-6-luna');
  job.listeners.add(state => { if (onState) onState(job, state); if (state.status !== 'running') resolve(job); });
  job.start(vault);
});
const alive = pattern => { try { return execSync(`pgrep -f "${pattern}"`).toString().trim(); } catch { return ''; } };

(async () => {
  // 1. success (episode fully cached → no ChatGPT calls), note lands in the QA vault
  const ok = await run('https://podcasts.apple.com/us/podcast/how-the-rich-make-money-by-losing-money/id1320118593?i=1000791671873');
  assert.strictEqual(ok.state.status, 'done', errorText(ok.state));
  assert(ok.state.notePath.startsWith(vault), ok.state.notePath);
  assert(fs.existsSync(ok.state.notePath));
  assert.deepStrictEqual(ok.state.steps.map(x => x.title[0]), ['①', '②', '③', '④', '⑤', '✅']);
  console.log('real success: ok →', path.basename(ok.state.notePath));

  // 2. paid episode → clear error, no note
  const bad = await run('https://podcasts.apple.com/us/podcast/economist-podcasts/id151230264?i=1000791687016');
  assert.strictEqual(bad.state.status, 'error');
  assert(errorText(bad.state).includes('付费订阅'), errorText(bad.state));
  console.log('real paid-episode error: ok →', errorText(bad.state).slice(0, 40));

  // 3. cancel during download kills the whole process group (python + curl)
  const src = 'https://podcasts.apple.com/us/podcast/is-investing-in-sports-worth-it-for-universities/id1320118593?i=1000792267841';
  const cancelled = await run(src, (job, state) => {
    if (state.status === 'running' && state.steps.some(x => x.title.startsWith('②')) && !job.cancelRequested) {
      job.cancelRequested = true;
      setTimeout(() => job.cancel(), 1500);
    }
  });
  assert.strictEqual(cancelled.state.status, 'cancelled');
  await new Promise(r => setTimeout(r, 1500));
  assert.strictEqual(alive('podcast_zh.py.*1000792267841'), '', 'python still running');
  assert.strictEqual(alive('curl.*npr.simplecastaudio|curl.*podtrac.*510325'), '', 'curl still running');
  console.log('real cancel: ok (no leftover processes)');

  fs.rmSync(vault, { recursive: true, force: true });
  console.log('ALL TESTS PASSED');
})().catch(err => { console.error('TEST FAILED:', err.message); process.exit(1); });
