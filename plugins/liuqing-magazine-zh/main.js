'use strict';
// Liuqing Magazine 中文稿: magazines and books (EPUB) from Apple Books, Downloads or anywhere → Chinese table of
// contents → pick articles/chapters → Chinese notes. The local Magazine-ZH tool does the work; this plugin shows
// the library, starts the tool, follows its progress, and auto-generates the Chinese TOC for newly added EPUBs.
const { Plugin, Modal, Notice, Setting, FileSystemAdapter, TFile, MarkdownRenderChild, setIcon } = require('obsidian');

// ---------- ChatGPT account (shared by both 中文稿 plugins; keep the two copies identical) ----------
// The tools use the ChatGPT login stored by the PhyrexNi translator (its CODEX_HOME). This block shows that
// login and can start the official `codex login` browser flow. It never reads or shows tokens, only the email.

function accountHome() {
  return require('path').join(require('os').homedir(), 'Applications/Fed-English-Translator/user-data/account');
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

let newestCodexPath = null;
/** Newest Codex CLI on this Mac (new models need new CLI versions); the Codex app keeps its copy current. */
function newestCodex() {
  if (newestCodexPath) return newestCodexPath;
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const home = require('os').homedir();
  const candidates = [path.join(home, '.codex/plugins/.plugin-appserver/codex-cli/bin/codex'), '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex', path.join(home, 'Applications/Fed-English-Translator/.runtime/codex/codex')];
  let best = null;
  let bestVersion = [-1];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const m = execFileSync(candidate, ['--version'], { timeout: 10000 }).toString().match(/(\d+)\.(\d+)\.(\d+)/);
      const version = m ? m.slice(1).map(Number) : [0];
      if (compareVersions(version, bestVersion) > 0) { best = candidate; bestVersion = version; }
    } catch (e) { /* not runnable */ }
  }
  newestCodexPath = best;
  return best;
}

function codexEnv() {
  const env = { ...process.env, CODEX_HOME: accountHome() };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.OPENAI_BASE_URL;
  return env;
}

/** Email from the id_token claims, for display only. */
function accountEmail() {
  try {
    const fs = require('fs');
    const auth = JSON.parse(fs.readFileSync(require('path').join(accountHome(), 'auth.json'), 'utf8'));
    const part = auth.tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8')).email || '';
  } catch (e) {
    return '';
  }
}

function loginStatus() {
  return new Promise(resolve => {
    const codex = newestCodex();
    if (!codex) return resolve({ ok: false, email: '', note: '找不到 Codex：请确认 PhyrexNi 翻译工具或 Codex App 已安装。' });
    require('child_process').execFile(codex, ['login', 'status'], { env: codexEnv(), timeout: 20000 }, (err, out, errOut) => {
      resolve({ ok: /logged in using/i.test(`${out}${errOut}`), email: accountEmail(), note: '' });
    });
  });
}

/** One login attempt: official `codex login` (opens the OpenAI page in the browser), then re-check. */
class LoginFlow {
  constructor(onChange) {
    this.onChange = onChange;
    this.child = null;
    this.state = { phase: 'idle', url: '' };
  }

  set(state) {
    this.state = { ...this.state, ...state };
    this.onChange(this.state);
  }

  start() {
    const codex = newestCodex();
    if (!codex) return this.set({ phase: 'failed', message: '找不到 Codex。' });
    this.set({ phase: 'waiting', url: '' });
    this.child = require('child_process').spawn(codex, ['login'], { env: codexEnv() });
    const scan = chunk => {
      const m = String(chunk).match(/https:\/\/auth\.openai\.com\/[^\s"'<>]+/);
      if (m && !this.state.url) this.set({ url: m[0] });
    };
    this.child.stdout.on('data', scan);
    this.child.stderr.on('data', scan);
    this.child.on('error', () => this.set({ phase: 'failed', message: '无法启动登录。' }));
    this.child.on('close', async () => {
      this.child = null;
      if (this.state.phase !== 'waiting') return;
      const status = await loginStatus();
      this.set(status.ok ? { phase: 'done' } : { phase: 'failed', message: '没有完成登录，可以再试一次。' });
    });
    // `codex login` gives up after a while; 5 minutes is plenty for the browser step.
    window.setTimeout(() => this.cancel(), 5 * 60 * 1000);
  }

  cancel() {
    if (this.child) {
      this.set({ phase: 'idle' });
      try { this.child.kill('SIGTERM'); } catch (e) { /* gone */ }
      this.child = null;
    }
  }
}

/** Render the account line into el; the plugin keeps one LoginFlow so re-renders show the same attempt. */
function renderAccount(el, plugin, cls) {
  const box = el.createDiv({ cls });
  const line = box.createDiv({ cls: `${cls}-line` });
  const actions = box.createDiv({ cls: `${cls}-actions` });
  const flow = plugin.loginFlow;
  if (flow && flow.state.phase === 'waiting') {
    line.setText('正在登录：请在浏览器打开的 OpenAI 官方页面登录你的 ChatGPT…');
    if (flow.state.url) {
      const link = actions.createEl('a', { text: '浏览器没打开？点这里', href: flow.state.url });
      link.addEventListener('click', e => { e.preventDefault(); window.open(flow.state.url); });
    }
    actions.createEl('button', { text: '取消' }).addEventListener('click', () => flow.cancel());
    return box;
  }
  line.setText('ChatGPT 账号：检查中…');
  loginStatus().then(status => {
    line.empty();
    if (status.ok) {
      line.setText(`ChatGPT 账号：已登录 ✓${status.email ? ` ${status.email}` : ''}`);
      actions.createEl('button', { text: '重新登录' }).addEventListener('click', () => plugin.startLogin());
    } else {
      line.setText(status.note || 'ChatGPT 账号：未登录。翻译需要登录你自己的 ChatGPT。');
      actions.createEl('button', { cls: 'mod-cta', text: '登录 ChatGPT' }).addEventListener('click', () => plugin.startLogin());
    }
    if (flow && flow.state.phase === 'failed') box.createDiv({ cls: `${cls}-error`, text: flow.state.message || '登录没有完成。' });
  });
  return box;
}
// ---------- end of ChatGPT account ----------


const MODELS = {
  auto: '日常 · 省额度（GPT-5.6-Sol；数据/金融文章高一级；没把握的段落逐级升级到最好的模型校对）',
  'gpt-6.1-sol': '全程 GPT-6.1-Sol',
  'gpt-6-astra': '全程 GPT-6-Astra（最费额度）',
};
const DEFAULT_MODEL = 'auto';
const AUTO_EVERY_MS = 10 * 60 * 1000;
const FIRST_RUN_LOOKBACK_MS = 0; // only EPUBs added after the plugin is first enabled

function paths() {
  const path = require('path');
  const home = require('os').homedir();
  return {
    tool: path.join(home, 'Applications/Magazine-ZH'),
    python: path.join(home, 'Applications/Fed-English-Translator/.runtime/python/bin/python3'),
  };
}

/** Rough number of ChatGPT requests for translating these articles (one per ~900 words). */
function requestEstimate(articles) {
  return articles.reduce((n, a) => n + Math.max(1, Math.ceil((a.words || 0) / 900)), 0);
}

/** Fold one stdout line of the tool into the run state (pure; covered by tests). */
function applyOutput(state, raw) {
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) return state;
  if (line.startsWith('@@ ')) {
    let ev;
    try { ev = JSON.parse(line.slice(3)); } catch (e) { return state; }
    const articles = { ...state.articles };
    if (ev.event === 'issue') return { ...state, issue: ev.issue };
    if (ev.event === 'books') return { ...state, books: ev.items };
    if (ev.event === 'article_start') articles[ev.id] = { status: 'running' };
    if (ev.event === 'article_done') articles[ev.id] = { status: 'done', note: ev.note };
    if (ev.event === 'article_failed') articles[ev.id] = { status: 'failed', error: ev.error };
    return { ...state, articles };
  }
  return { ...state, log: [...state.log, line.trim().replace(/^·\s*/, '')].slice(-6) };
}

/** Library items worth auto-importing: new since `since`, not imported, readable, not tried at this version. */
/** New EPUBs (added after auto-translation was switched on) that still need work: no Chinese TOC yet, or not every
 *  article/chapter translated. Ones given up on (repeated failures) are skipped. Oldest first. */
function autoCandidates(items, since, records) {
  return items.filter(x => !x.drm && x.mtime * 1000 > since && !(records[x.path] && records[x.path].gaveUp)
    && (!x.imported || (x.total && x.translated < x.total)))
    .sort((a, b) => a.mtime - b.mtime);
}

/** "…用量已到上限，Oct 1st, 2026 2:08 AM 恢复…" or "…，3:57 AM 恢复…" → epoch ms + 5 min; otherwise now + 5 h. */
function resumeTime(text, now) {
  now = now || Date.now();
  const fallback = now + 5 * 3600 * 1000;
  const m = /用量已到上限，(.+?) 恢复/.exec(text || '');
  if (!m) return fallback;
  const when = m[1].replace(/(\d)(st|nd|rd|th)\b/, '$1').trim();
  let t = Date.parse(when);
  const clock = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(when);
  if (Number.isNaN(t) && clock) {
    const d = new Date(now);
    let hour = Number(clock[1]) % 12 + (clock[3].toUpperCase() === 'PM' ? 12 : 0);
    d.setHours(hour, Number(clock[2]), 0, 0);
    t = d.getTime() <= now ? d.getTime() + 24 * 3600 * 1000 : d.getTime();
  }
  if (Number.isNaN(t) || t <= now || t > fallback) return fallback;
  return t + 5 * 60 * 1000;
}

function displayName(item) {
  return [item.name, item.date].filter(Boolean).join(' ');
}

/** A dropped/chosen File → { path, name }. Electron ≥ 32 removed File.path; webUtils replaces it. */
function fileToEpub(file) {
  let path = '';
  try { path = require('electron').webUtils.getPathForFile(file); } catch (e) { /* older Electron */ }
  path = path || file.path || '';
  return { path, name: file.name.replace(/\.epub$/i, '') };
}

/** Drop zone + file chooser for EPUBs that are not in Apple Books or Downloads. */
function renderDropZone(el, onEpub) {
  const drop = el.createDiv({ cls: 'lmz-drop' });
  drop.createDiv({ cls: 'lmz-drop-title', text: '或者把 EPUB 拖到这里' });
  const picker = drop.createEl('input', { type: 'file', attr: { accept: '.epub,application/epub+zip' } });
  picker.addClass('lmz-hidden');
  drop.createEl('button', { text: '选择文件…' }).addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => { if (picker.files[0]) onEpub(fileToEpub(picker.files[0])); picker.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.addClass('is-over'); });
  drop.addEventListener('dragleave', () => drop.removeClass('is-over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.removeClass('is-over');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) onEpub(fileToEpub(file));
  });
  return drop;
}

/** Apple Books + Downloads library with a search box; `limit` shortens the list (panel view). */
function renderLibrary(el, plugin, onPick, limit) {
  const wrap = el.createDiv({ cls: 'lmz-library' });
  const head = wrap.createDiv({ cls: 'lmz-library-head' });
  head.createSpan({ cls: 'lmz-subheading', text: '📚 Apple 图书和「下载」里的 EPUB' });
  const search = head.createEl('input', { type: 'search', cls: 'lmz-search', attr: { placeholder: '搜索书名或杂志名' } });
  const list = wrap.createDiv({ cls: 'lmz-list' });
  const draw = () => {
    list.empty();
    const items = plugin.library;
    if (!items) { list.createDiv({ cls: 'lmz-muted', text: '正在读取你的图书…' }); return; }
    if (!items.length) { list.createDiv({ cls: 'lmz-muted', text: 'Apple 图书（iCloud）和「下载」里还没有 EPUB。用隔空投送或「图书」添加后，这里会自动出现。' }); return; }
    const q = search.value.trim().toLowerCase();
    let shown = items.filter(x => !q || `${x.name} ${x.author} ${x.date}`.toLowerCase().includes(q));
    const more = limit && !q && shown.length > limit;
    if (more) shown = shown.slice(0, limit);
    for (const item of shown) {
      const row = list.createEl('button', { cls: 'lmz-book' });
      row.createSpan({ cls: `lmz-badge lmz-badge-${item.kind}`, text: item.kind === 'book' ? '书' : '杂志' });
      const text = row.createDiv({ cls: 'lmz-item-text' });
      text.createDiv({ cls: 'lmz-item-title', text: displayName(item) });
      const unit = item.kind === 'book' ? '章' : '篇';
      const state = item.drm ? '受版权保护，无法翻译'
        : item.imported ? `中文目录已生成${item.translated ? ` · 已翻译 ${item.translated} ${unit}` : ''}` : '新';
      text.createDiv({ cls: 'lmz-item-meta', text: [item.author, item.source, state].filter(Boolean).join(' · ') });
      if (item.drm) row.setAttr('disabled', 'true');
      else row.addEventListener('click', () => onPick({ path: item.path, name: displayName(item) }));
    }
    if (more) list.createDiv({ cls: 'lmz-muted', text: `还有 ${items.length - limit} 本，搜索或点「全部图书」查看。` });
  };
  search.addEventListener('input', draw);
  draw();
  plugin.loadLibrary().then(draw);
  return wrap;
}

function errorText(state) {
  const lines = state.messages.filter(l => !/^(Traceback|File "|\^+$|~+$)/.test(l));
  return lines[lines.length - 1] || '处理失败，请稍后再试。';
}

class Run {
  constructor(action, epubPath, extra) {
    this.action = action;
    this.epubPath = epubPath;
    this.extra = extra || [];
    this.state = { status: 'running', log: [], issue: null, books: null, articles: {}, messages: [] };
    this.listeners = new Set();
    this.child = null;
  }

  set(state) {
    this.state = state;
    for (const listener of this.listeners) listener(this.state);
  }

  start(vaultPath) {
    const { spawn } = require('child_process');
    const fs = require('fs');
    const p = paths();
    if (!fs.existsSync(p.python) || !fs.existsSync(require('path').join(p.tool, 'magazine_zh.py'))) {
      this.set({ ...this.state, status: 'error', messages: ['找不到本机工具：需要 ~/Applications/Magazine-ZH 和 ~/Applications/Fed-English-Translator。'] });
      return;
    }
    const args = ['-B', '-E', '-s', '-X', 'utf8', 'magazine_zh.py', this.action, ...(this.epubPath ? [this.epubPath] : []), ...this.extra];
    // detached: cancelling kills the tool and the ChatGPT processes it started.
    this.child = spawn(p.python, args, { cwd: p.tool, env: { ...process.env, MZH_VAULT: vaultPath }, detached: true });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      let next = this.state;
      for (const line of lines) next = applyOutput(next, line);
      this.set(next);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => {
      const lines = chunk.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
      if (lines.length) this.set({ ...this.state, messages: [...this.state.messages, ...lines].slice(-20) });
    });
    this.child.on('error', err => this.set({ ...this.state, status: 'error', messages: [...this.state.messages, `无法启动：${err.message}`] }));
    this.child.on('close', code => {
      const next = buffer ? applyOutput(this.state, buffer) : this.state;
      buffer = '';
      this.child = null;
      if (this.state.status === 'cancelled') return;
      this.set({ ...next, status: code === 0 ? 'done' : 'error' });
    });
  }

  cancel() {
    if (this.state.status !== 'running') return;
    this.set({ ...this.state, status: 'cancelled' });
    if (this.child) {
      try { process.kill(-this.child.pid, 'SIGTERM'); } catch (e) { try { this.child.kill('SIGTERM'); } catch (e2) { /* gone */ } }
      this.child = null;
    }
  }
}

class MagazineModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.epub = file || null; // { path: absolute path, name }
    this.issue = null;
    this.selected = new Set();
    this.unsubscribe = null;
  }

  onOpen() {
    this.modalEl.addClass('lmz-modal');
    this.titleEl.setText('杂志 / 书 → 中文稿');
    this.plugin.modals.add(this);
    const run = this.plugin.run;
    if (run && (run.state.status === 'running' || run.action === 'translate') && !(this.epub && this.epub.path !== run.epubPath)) {
      this.epub = run.epub;
      this.issue = run.state.issue || this.plugin.issues.get(run.epubPath) || null;
      return this.follow(run);
    }
    if (this.epub) return this.open(this.epub);
    this.renderPick();
  }

  open(epub) {
    if (!/\.epub\/?$/i.test(epub.path || '')) {
      new Notice('请选择 .epub 格式的文件。');
      return;
    }
    this.epub = epub;
    this.loadIssue();
  }

  onClose() {
    this.plugin.modals.delete(this);
    this.detach();
    this.contentEl.empty();
  }

  detach() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  follow(run) {
    this.detach();
    const listener = () => this.renderRun(run);
    run.listeners.add(listener);
    this.unsubscribe = () => run.listeners.delete(listener);
    this.renderRun(run);
  }

  /** Re-render only the screens that show the account line or library (not a picker with ticked boxes). */
  refreshLight() {
    if (this.screen === 'pick') this.renderPick();
  }

  renderPick() {
    this.detach();
    this.screen = 'pick';
    const el = this.contentEl;
    el.empty();
    renderLibrary(el, this.plugin, epub => this.open(epub));
    renderDropZone(el, epub => this.open(epub));
    renderAccount(el, this.plugin, 'lmz-account');
  }

  /** Ask the tool what it already knows about this EPUB (no network), then show the picker or the import step. */
  loadIssue() {
    this.screen = 'load';
    const el = this.contentEl;
    el.empty();
    el.createDiv({ cls: 'lmz-muted', text: '正在读取…' });
    const run = this.plugin.runTool('status', this.epub, [], { track: false });
    const settle = state => {
      if (state.status === 'running' || run.settled) return;
      run.settled = true;
      if (state.status === 'error') return this.renderError(errorText(state));
      this.issue = state.issue;
      if (this.issue) this.renderPicker();
      else this.renderImport();
    };
    run.listeners.add(settle);
    settle(run.state); // it may already have failed synchronously
  }

  busy() {
    if (this.plugin.run && this.plugin.run.state.status === 'running') {
      new Notice('正在处理另一本，请等它完成（或在状态栏打开后取消）。');
      return true;
    }
    return false;
  }

  renderImport() {
    this.detach();
    this.screen = 'import';
    const el = this.contentEl;
    el.empty();
    el.createDiv({ cls: 'lmz-heading', text: this.epub.name });
    el.createDiv({ cls: 'lmz-muted', text: '第一步：生成中文目录（每篇文章或每一章的中文标题和一句话简介），只用一到三次 ChatGPT 请求。' });
    new Setting(el).addButton(b => b.setButtonText('换一本').onClick(() => this.renderPick()))
      .addButton(b => b.setButtonText('生成中文目录').setCta().onClick(() => {
        if (this.busy()) return;
        const run = this.plugin.runTool('import', this.epub, ['--model', this.plugin.settings.model]);
        this.follow(run);
      }));
  }

  renderPicker() {
    this.detach();
    this.screen = 'picker';
    const el = this.contentEl;
    el.empty();
    const issue = this.issue;
    const unit = issue.kind === 'book' ? '章' : '篇';
    el.createDiv({ cls: 'lmz-heading', text: `${issue.magazine} ${issue.issue}`.trim() });
    const top = new Setting(el).setName(`共 ${issue.articles.length} ${unit}`).setDesc(`勾选要翻译的${unit === '章' ? '章节' : '文章'}，已翻译的可以直接打开。`);
    top.addButton(b => b.setButtonText('换一本').onClick(() => this.renderPick()));
    top.addButton(b => b.setButtonText('打开中文目录').onClick(() => { this.plugin.openPath(issue.index); this.close(); }));

    const list = el.createDiv({ cls: 'lmz-list' });
    const footer = el.createDiv({ cls: 'lmz-footer' });
    const summary = footer.createDiv({ cls: 'lmz-muted' });
    const boxes = new Map();
    const sectionBoxes = new Map();
    let translate;
    const refresh = () => {
      const picked = issue.articles.filter(a => this.selected.has(a.id));
      summary.setText(picked.length ? `已选 ${picked.length} ${unit} · 约 ${requestEstimate(picked)} 次 ChatGPT 请求` : `还没有选择${unit === '章' ? '章节' : '文章'}`);
      if (translate) translate.setDisabled(!picked.length);
      for (const [section, box] of sectionBoxes) {
        const ids = issue.articles.filter(a => (a.section || '') === section).map(a => a.id);
        const n = ids.filter(id => this.selected.has(id)).length;
        box.checked = n === ids.length;
        box.indeterminate = n > 0 && n < ids.length;
      }
    };
    let current = null;
    for (const a of issue.articles) {
      const section = a.section || '';
      if (section !== current) {
        current = section;
        const head = list.createEl('label', { cls: 'lmz-section' });
        const box = head.createEl('input', { type: 'checkbox' });
        head.createSpan({ text: [a.section_zh, section].filter(Boolean).join(' · ') || (unit === '章' ? '章节' : '文章') });
        sectionBoxes.set(section, box);
        box.addEventListener('change', () => {
          for (const b of issue.articles.filter(x => (x.section || '') === section)) {
            if (box.checked) this.selected.add(b.id); else this.selected.delete(b.id);
            boxes.get(b.id).checked = box.checked;
          }
          refresh();
        });
      }
      const row = list.createDiv({ cls: 'lmz-row' });
      const label = row.createEl('label', { cls: 'lmz-item' });
      const box = label.createEl('input', { type: 'checkbox' });
      box.checked = this.selected.has(a.id);
      boxes.set(a.id, box);
      const text = label.createDiv({ cls: 'lmz-item-text' });
      text.createDiv({ cls: 'lmz-item-title', text: a.title_zh || a.title });
      text.createDiv({ cls: 'lmz-item-meta', text: `${a.title} · ${a.words} 词` });
      box.addEventListener('change', () => { if (box.checked) this.selected.add(a.id); else this.selected.delete(a.id); refresh(); });
      if (a.note) {
        const open = row.createEl('button', { cls: 'lmz-open', text: '已翻译 · 打开' });
        open.addEventListener('click', () => { this.plugin.openPath(a.note); this.close(); });
      }
    }
    const actions = new Setting(footer);
    actions.addDropdown(dd => {
      for (const [id, label] of Object.entries(MODELS)) dd.addOption(id, label);
      dd.setValue(this.plugin.settings.model).onChange(v => { this.plugin.settings.model = v; this.plugin.saveData(this.plugin.settings); });
    });
    actions.addButton(b => {
      translate = b;
      b.setButtonText('翻译选中').setCta().onClick(() => {
        const ids = [...this.selected].sort((x, y) => x - y);
        if (!ids.length || this.busy()) return;
        const run = this.plugin.runTool('translate', this.epub, ['--ids', ids.join(','), '--model', this.plugin.settings.model], { picked: ids });
        this.selected.clear();
        this.follow(run);
      });
    });
    refresh();
  }

  renderRun(run) {
    this.screen = 'run';
    const el = this.contentEl;
    el.empty();
    const { status, log, articles } = run.state;
    if (run.state.issue) this.issue = run.state.issue;
    const unit = this.issue && this.issue.kind === 'book' ? '章' : '篇';
    const titles = new Map((this.issue ? this.issue.articles : []).map(a => [a.id, a.title_zh || a.title]));
    if (run.action === 'translate') {
      const ids = run.picked || [];
      const done = ids.filter(id => articles[id] && articles[id].status === 'done').length;
      el.createDiv({ cls: 'lmz-heading', text: `翻译 ${ids.length} ${unit} · 已完成 ${done}` });
      const list = el.createDiv({ cls: 'lmz-list' });
      for (const id of ids) {
        const s = articles[id] ? articles[id].status : 'waiting';
        const row = list.createDiv({ cls: 'lmz-progress-row' });
        row.createDiv({ cls: 'lmz-item-title', text: titles.get(id) || `第 ${id} ${unit}` });
        row.createDiv({ cls: `lmz-state lmz-state-${s}`, text: { waiting: '等待', running: '翻译中', done: '完成', failed: '失败' }[s] });
      }
    } else {
      el.createDiv({ cls: 'lmz-heading', text: run.epub ? run.epub.name : '' });
      const list = el.createDiv({ cls: 'lmz-list' });
      for (const line of log) list.createDiv({ cls: 'lmz-log', text: line });
      if (!log.length && status === 'running') list.createDiv({ cls: 'lmz-log', text: '正在启动…' });
    }
    if (status === 'error') {
      el.createDiv({ cls: 'lmz-error', text: errorText(run.state) });
      if (/登录/.test(errorText(run.state))) renderAccount(el, this.plugin, 'lmz-account');
    }
    if (status === 'cancelled') el.createDiv({ cls: 'lmz-muted', text: '已取消。已完成的部分已保存。' });
    const actions = new Setting(el);
    if (status === 'running') {
      el.createDiv({ cls: 'lmz-muted', text: '可以关掉这个窗口，会在后台继续；底部状态栏显示进度。' });
      actions.addButton(b => b.setButtonText('取消').onClick(() => run.cancel()));
      actions.addButton(b => b.setButtonText('返回书库').onClick(() => this.renderPick()));
      actions.addButton(b => b.setButtonText('后台运行').setCta().onClick(() => this.close()));
      return;
    }
    if (this.issue) {
      actions.addButton(b => b.setButtonText('打开中文目录').onClick(() => { this.plugin.openPath(this.issue.index); this.close(); }));
      actions.addButton(b => b.setButtonText(run.action === 'translate' ? '继续挑选' : `挑选要翻译的${unit === '章' ? '章节' : '文章'}`).setCta().onClick(() => {
        this.plugin.clearRun();
        this.renderPicker();
      }));
    } else {
      actions.addButton(b => b.setButtonText('返回').onClick(() => { this.plugin.clearRun(); this.renderPick(); }));
    }
  }

  renderError(message) {
    this.screen = 'error';
    const el = this.contentEl;
    el.empty();
    el.createDiv({ cls: 'lmz-error', text: message });
    new Setting(el).addButton(b => b.setButtonText('返回').onClick(() => this.renderPick()));
  }
}

/** The ```magazine-zh``` block in a note: the newest EPUBs from Apple Books/Downloads, a drop zone, and progress. */
class MagazinePanel extends MarkdownRenderChild {
  constructor(el, plugin) {
    super(el);
    this.plugin = plugin;
  }

  onload() {
    this.plugin.panels.add(this);
    this.render();
  }

  onunload() {
    this.plugin.panels.delete(this);
  }

  render() {
    const el = this.containerEl;
    el.empty();
    el.addClass('lmz-panel', 'lmz-modal');
    const head = el.createDiv({ cls: 'lmz-panel-head' });
    setIcon(head.createSpan({ cls: 'lmz-panel-icon' }), 'newspaper');
    head.createSpan({ text: '杂志 / 书（EPUB）→ 中文稿' });
    const run = this.plugin.run;
    if (run && run.state.status === 'running') {
      const ids = run.picked || [];
      const done = Object.values(run.state.articles).filter(a => a.status === 'done').length;
      const line = el.createDiv({ cls: 'lmz-panel-line' });
      line.setText(run.action === 'translate' ? `《${run.epub.name}》正在${run.auto ? '自动' : ''}翻译 ${done}/${run.auto ? (run.total || '…') : ids.length}` : `《${run.epub.name}》正在生成中文目录${run.auto ? '（自动）' : ''}`);
      el.createEl('button', { text: '查看进度' }).addEventListener('click', () => this.plugin.openModal());
    }
    renderLibrary(el, this.plugin, epub => this.plugin.openModal(epub), 6);
    const row = el.createDiv({ cls: 'lmz-panel-row' });
    row.createEl('button', { text: '全部图书 / 选择其他文件…' }).addEventListener('click', () => this.plugin.openModal());
    const auto = row.createEl('label', { cls: 'lmz-auto' });
    const box = auto.createEl('input', { type: 'checkbox' });
    box.checked = this.plugin.settings.auto;
    auto.createSpan({ text: '新加入的 EPUB 自动翻译全文' });
    box.addEventListener('change', () => { this.plugin.settings.auto = box.checked; this.plugin.saveData(this.plugin.settings); });
  }
}

module.exports = class MagazineZhPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({ model: DEFAULT_MODEL, auto: true, since: 0, records: {}, pausedUntil: 0 }, await this.loadData());
    if (!this.settings.records) this.settings.records = {};
    if (!MODELS[this.settings.model]) this.settings.model = DEFAULT_MODEL;
    if (!this.settings.since) {
      // First run: start watching from now on; nothing already in the library is processed automatically.
      this.settings.since = Date.now() - FIRST_RUN_LOOKBACK_MS;
      await this.saveData(this.settings);
    }
    this.run = null;
    this.issues = new Map();
    this.library = null;
    this.panels = new Set();
    this.modals = new Set();
    this.status = this.addStatusBarItem();
    this.status.addClass('lmz-status', 'mod-clickable');
    this.status.hide();
    this.registerDomEvent(this.status, 'click', () => this.openModal());
    this.addRibbonIcon('newspaper', '杂志 / 书转中文稿', () => this.openModal());
    this.addCommand({ id: 'translate-magazine', name: '把杂志或书（EPUB）转成中文稿', callback: () => this.openModal() });
    this.addCommand({ id: 'login-chatgpt', name: '登录 ChatGPT（中文稿翻译用）', callback: () => this.startLogin() });
    this.registerMarkdownCodeBlockProcessor('magazine-zh', (source, el, ctx) => ctx.addChild(new MagazinePanel(el, this)));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'epub') return;
      menu.addItem(item => item.setTitle('翻译这本杂志 / 书（中文稿）').setIcon('newspaper')
        .onClick(() => this.openModal({ path: require('path').join(this.vaultPath(), file.path), name: file.basename })));
    }));
    this.app.workspace.onLayoutReady(() => {
      this.registerInterval(window.setInterval(() => this.autoScan(), AUTO_EVERY_MS));
      window.setTimeout(() => this.autoScan(), 15000);
    });
  }

  onunload() {
    if (this.run) this.run.cancel();
    if (this.loginFlow) this.loginFlow.cancel();
  }

  startLogin() {
    if (this.loginFlow && this.loginFlow.state.phase === 'waiting') return;
    this.loginFlow = new LoginFlow(state => {
      if (state.phase === 'done') new Notice('ChatGPT 已登录，可以继续翻译了。');
      this.refreshPanels();
      for (const modal of this.modals) modal.refreshLight();
    });
    this.loginFlow.start();
  }

  refreshPanels() {
    for (const panel of this.panels) panel.render();
  }

  /** List Apple Books (iCloud) + Downloads EPUBs via the tool; cached briefly so panels redraw cheaply. */
  loadLibrary(force) {
    if (!force && this.libraryAt && Date.now() - this.libraryAt < 60000) return Promise.resolve(this.library);
    if (this.libraryLoading) return this.libraryLoading;
    this.libraryLoading = new Promise(resolve => {
      const run = new Run('books', '', []);
      run.listeners.add(state => {
        if (state.status === 'running') return;
        this.libraryLoading = null;
        if (state.books) { this.library = state.books; this.libraryAt = Date.now(); }
        else if (!this.library) this.library = [];
        resolve(this.library);
      });
      run.start(this.vaultPath());
    });
    return this.libraryLoading;
  }

  /** New EPUB in Apple Books or Downloads → generate its Chinese table of contents in the background. */
  /** New EPUB in Apple Books or Downloads → Chinese table of contents, then the whole text, one book at a time.
   *  Waits out the ChatGPT usage limit; retries other failures on later scans; gives up after repeated failures. */
  async autoScan() {
    if (!this.settings.auto || (this.run && this.run.state.status === 'running')) return;
    if (Date.now() < (this.settings.pausedUntil || 0)) return;
    const items = await this.loadLibrary(true);
    const next = autoCandidates(items, this.settings.since, this.settings.records)[0];
    this.refreshPanels();
    if (!next) return;
    const rec = this.settings.records[next.path] || { attempts: 0 };
    rec.attempts += 1;
    rec.name = displayName(next);
    this.settings.records[next.path] = rec;
    await this.saveData(this.settings);
    const epub = { path: next.path, name: displayName(next) };
    if (!next.imported) this.runTool('import', epub, ['--model', this.settings.model], { auto: true });
    else this.runTool('translate', epub, ['--ids', 'all', '--model', this.settings.model], { auto: true, picked: [], total: next.total });
  }

  /** What an automatic run's outcome means for the next scan. */
  async afterAutoRun(run, state) {
    const rec = this.settings.records[run.epubPath] || { attempts: 0 };
    const text = [...state.messages, ...state.log].join('\n');
    const failed = Object.values(state.articles).filter(a => a.status === 'failed').length;
    let next = 5000;
    if (/用量已到上限/.test(text)) {
      rec.attempts = Math.max(0, rec.attempts - 1); // not this book's fault
      this.settings.pausedUntil = resumeTime(text);
      const at = new Date(this.settings.pausedUntil);
      new Notice(`ChatGPT 额度用完了，${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')} 后自动接着翻《${run.epub.name}》。`, 10000);
      next = null;
    } else if (/登录已失效/.test(text)) {
      this.settings.pausedUntil = Date.now() + 30 * 60 * 1000;
      new Notice('ChatGPT 需要重新登录：打开「中文稿工作台」的 ChatGPT 账号面板。', 15000);
      next = null;
    } else if (/为保证质量已停止/.test(text) || rec.attempts >= 6) {
      rec.gaveUp = true;
      new Notice(`《${run.epub.name}》有内容多次没翻好，已停止自动翻译它；可以在杂志窗口里手动重试。`, 15000);
    } else if (state.status === 'done' && run.action === 'translate' && !failed) {
      rec.done = true;
      new Notice(`📖《${run.epub.name}》已全部翻译完成，可以阅读了。`, 15000);
    } else if (state.status !== 'done' || failed) {
      next = 10 * 60 * 1000; // e.g. requests cut off while the Mac slept: fill in what is missing later
    }
    this.settings.records[run.epubPath] = rec;
    await this.saveData(this.settings);
    window.setTimeout(() => {
      if (this.run === run) { this.run = null; this.status.hide(); this.refreshPanels(); }
      if (next !== null) window.setTimeout(() => this.autoScan(), next);
    }, 5000);
  }

  openModal(file) {
    new MagazineModal(this.app, this, file).open();
  }

  vaultPath() {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
  }

  /** Start the tool. Tracked runs (import/translate) are the single background job shown in the status bar. */
  runTool(action, epub, extra, options) {
    const track = !options || options.track !== false;
    if (track && this.run && this.run.state.status === 'running') return this.run;
    const run = new Run(action, epub.path, extra);
    run.epub = epub;
    run.picked = (options && options.picked) || [];
    run.auto = Boolean(options && options.auto);
    run.total = (options && options.total) || 0;
    run.listeners.add(state => { if (state.issue) this.issues.set(run.epubPath, state.issue); });
    if (track) {
      this.run = run;
      run.listeners.add(state => this.onRunState(run, state));
    }
    run.start(this.vaultPath());
    return run;
  }

  clearRun() {
    if (this.run && this.run.state.status === 'running') return;
    this.run = null;
    this.status.hide();
    this.refreshPanels();
  }

  onRunState(run, state) {
    if (this.run !== run) return;
    if (state.status === 'running') {
      if (run.action === 'translate') {
        const done = Object.values(state.articles).filter(a => a.status === 'done').length;
        const total = run.auto ? run.total : (run.picked || []).length;
        this.status.setText(`中文稿 · ${run.auto ? `自动翻译《${run.epub.name}》` : '翻译'} ${done}/${total || '…'}`);
      } else {
        this.status.setText(`中文稿 · 生成目录：${run.epub.name}`);
      }
      this.status.show();
      if (!run.shown) { run.shown = true; this.refreshPanels(); }
      return;
    }
    if (run.announced) return;
    run.announced = true;
    this.libraryAt = 0; // library status changed
    if (run.auto) {
      this.status.setText(state.status === 'done' ? '中文稿 · 自动翻译进行中' : '中文稿 · 自动翻译暂停');
      this.afterAutoRun(run, state);
      this.refreshPanels();
      return;
    }
    if (state.status === 'done') {
      const failed = Object.values(state.articles).filter(a => a.status === 'failed').length;
      if (run.action === 'translate') new Notice(`翻译完成${failed ? `，${failed} 个失败（再翻一次会补上）` : ''}`);
      else new Notice('中文目录已生成');
      this.status.setText(run.action === 'translate' ? '翻译完成' : '中文目录已生成');
      if (state.issue && run.action === 'import') this.openPath(state.issue.index);
      window.setTimeout(() => { if (this.run === run) this.status.hide(); }, 8000);
    } else if (state.status === 'error') {
      this.status.setText('中文稿处理失败');
      new Notice(`处理失败：${errorText(state)}`, 10000);
    } else {
      this.status.hide();
    }
    this.refreshPanels();
  }

  async openPath(rel) {
    let file = null;
    for (let i = 0; i < 40 && !(file instanceof TFile); i++) {
      file = this.app.vault.getAbstractFileByPath(rel);
      if (!(file instanceof TFile)) await new Promise(r => window.setTimeout(r, 150));
    }
    const open = this.app.workspace.getLeavesOfType('markdown').find(leaf => leaf.view.file && leaf.view.file.path === rel);
    if (open) this.app.workspace.setActiveLeaf(open, { focus: true });
    else if (file instanceof TFile) await this.app.workspace.getLeaf('tab').openFile(file);
    else await this.app.workspace.openLinkText(rel, '', 'tab');
  }
};

module.exports.applyOutput = applyOutput;
module.exports.errorText = errorText;
module.exports.requestEstimate = requestEstimate;
module.exports.fileToEpub = fileToEpub;
module.exports.autoCandidates = autoCandidates;
module.exports.resumeTime = resumeTime;
module.exports.Run = Run;
module.exports.loginStatus = loginStatus;
module.exports.newestCodex = newestCodex;
