// Liuqing Podcast 中文稿: run the local Podcast-ZH tool from inside Obsidian.
// The tool (~/Applications/Podcast-ZH) does the work and writes the note; this plugin only starts it,
// shows its progress, lets you cancel, and opens the finished note.
const { Plugin, Modal, Notice, Setting, FileSystemAdapter, TFile, MarkdownRenderChild, setIcon } = require('obsidian');

const WORKBENCH = '中文稿工作台.md';

const MODELS = {
  auto: '最好质量 · 自动（Astra 起，额度用完依次换次好的，最低 GPT-5.5，再不够就停）',
  'gpt-6-astra': '只用 GPT-6-Astra（最强）',
  'gpt-6.1-sol': '只用 GPT-6.1-Sol（最新主力）',
};
const DEFAULT_MODEL = 'auto';
const STEP = /^[①②③④⑤✅]/;
const NOTE = /^\s*文稿：(.+\.md)\s*$/;

function paths() {
  const path = require('path');
  const home = require('os').homedir();
  return {
    tool: path.join(home, 'Applications/Podcast-ZH'),
    python: path.join(home, 'Applications/Fed-English-Translator/.runtime/python/bin/python3'),
  };
}

function looksLikeEpisode(text) {
  return /^https?:\/\/podcasts\.apple\.com\/\S*[?&]i=\d+/.test((text || '').trim());
}

/** Fold one line of the tool's stdout into the progress state (pure; covered by tests). */
function applyLine(state, raw) {
  const line = raw.replace(/\s+$/, '');
  if (!line.trim()) return state;
  const steps = state.steps.map(s => ({ ...s }));
  const note = line.match(NOTE);
  if (note) return { ...state, notePath: note[1].trim() };
  if (STEP.test(line)) {
    steps.push({ title: line.trim(), detail: '' });
  } else if (steps.length) {
    steps[steps.length - 1].detail = line.trim().replace(/^·\s*/, '');
  }
  return { ...state, steps };
}

/** Fold a chunk of the tool's stderr: curl's progress bar becomes download detail, the rest are messages. */
function applyError(state, chunk) {
  let next = state;
  for (const part of chunk.split(/[\r\n]+/)) {
    const text = part.trim();
    if (!text) continue;
    const pct = text.match(/^#*\s*(\d{1,3}(?:\.\d)?)%$/);
    if (pct || /^#+$/.test(text)) {
      if (pct && next.steps.length) {
        const steps = next.steps.map(s => ({ ...s }));
        steps[steps.length - 1].detail = `下载 ${Math.round(Number(pct[1]))}%`;
        next = { ...next, steps };
      }
      continue;
    }
    next = { ...next, messages: [...next.messages, text].slice(-20) };
  }
  return next;
}

/** The last human-readable error line (skips Python traceback noise). */
function errorText(state) {
  const lines = state.messages.filter(l => !/^(Traceback|File "|\^+$|~+$)/.test(l));
  return lines[lines.length - 1] || '处理失败，请稍后再试。';
}

class Job {
  constructor(plugin, source, model) {
    this.plugin = plugin;
    this.source = source;
    this.model = model;
    this.state = { status: 'running', steps: [], notePath: '', messages: [] };
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
    if (!fs.existsSync(p.python) || !fs.existsSync(require('path').join(p.tool, 'podcast_zh.py'))) {
      this.set({ ...this.state, status: 'error',
        messages: ['找不到本机工具：需要 ~/Applications/Podcast-ZH 和 ~/Applications/Fed-English-Translator。'] });
      return;
    }
    // detached: the tool starts curl/codex children; cancelling kills the whole process group.
    this.child = spawn(p.python, ['-B', '-E', '-s', '-X', 'utf8', 'podcast_zh.py', this.source, '--model', this.model],
      { cwd: p.tool, env: { ...process.env, PZH_VAULT: vaultPath }, detached: true });
    let buffer = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      let next = this.state;
      for (const line of lines) next = applyLine(next, line);
      this.set(next);
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => this.set(applyError(this.state, chunk)));
    this.child.on('error', err => this.set({ ...this.state, status: 'error', messages: [...this.state.messages, `无法启动：${err.message}`] }));
    this.child.on('close', code => {
      let next = buffer ? applyLine(this.state, buffer) : this.state;
      buffer = '';
      if (this.state.status === 'cancelled') return;
      if (code === 0 && next.notePath) next = { ...next, status: 'done' };
      else next = { ...next, status: 'error' };
      this.child = null;
      this.set(next);
    });
  }

  cancel() {
    if (this.state.status !== 'running') return;
    this.set({ ...this.state, status: 'cancelled' });
    if (this.child) {
      try { process.kill(-this.child.pid, 'SIGTERM'); } catch (e) { try { this.child.kill('SIGTERM'); } catch (e2) { /* already gone */ } }
      this.child = null;
    }
  }
}

class PodcastModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.unsubscribe = null;
  }

  onOpen() {
    this.modalEl.addClass('lpz-modal');
    this.titleEl.setText('播客转中文稿');
    this.plugin.modals.add(this);
    this.render();
  }

  /** After a login attempt: redraw unless a link is being typed into the form. */
  refreshLight() {
    const typing = this.contentEl.querySelector('input.lpz-input');
    if (!(typing && typing.value)) this.render();
  }

  onClose() {
    this.plugin.modals.delete(this);
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.contentEl.empty();
  }

  render() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.contentEl.empty();
    const job = this.plugin.job;
    if (!job) return this.renderForm();
    const listener = () => this.renderJob(job);
    job.listeners.add(listener);
    this.unsubscribe = () => job.listeners.delete(listener);
    this.renderJob(job);
  }

  renderForm(prefill) {
    const el = this.contentEl;
    let source = prefill || '';
    let model = this.plugin.settings.model;
    let input;
    new Setting(el).setName('单集链接').setDesc('Apple 播客里某一集 → 分享 → 拷贝链接').addText(text => {
      input = text;
      text.setPlaceholder('https://podcasts.apple.com/…?i=…').setValue(source).onChange(v => { source = v; });
      text.inputEl.addClass('lpz-input');
      text.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
    });
    new Setting(el).setName('翻译').addDropdown(dd => {
      for (const [id, label] of Object.entries(MODELS)) dd.addOption(id, label);
      dd.setValue(model).onChange(v => { model = v; });
    });
    const start = () => {
      if (!source.trim()) { input.inputEl.focus(); return; }
      this.plugin.settings.model = model;
      this.plugin.saveData(this.plugin.settings);
      this.plugin.startJob(source.trim(), model);
      this.render();
    };
    new Setting(el).addButton(b => b.setButtonText('开始').setCta().onClick(start));
    renderAccount(el, this.plugin, 'lpz-account');
    if (!source) {
      navigator.clipboard.readText().then(text => {
        if (looksLikeEpisode(text) && input && !input.getValue()) { input.setValue(text.trim()); source = text.trim(); }
      }).catch(() => {});
    }
    window.setTimeout(() => input && input.inputEl.focus(), 0);
  }

  renderJob(job) {
    const el = this.contentEl;
    el.empty();
    const { status, steps } = job.state;
    const list = el.createDiv({ cls: 'lpz-steps' });
    if (!steps.length && status === 'running') list.createDiv({ cls: 'lpz-step', text: '正在启动…' });
    for (const step of steps) {
      const row = list.createDiv({ cls: 'lpz-step' });
      row.createDiv({ cls: 'lpz-step-title', text: step.title });
      if (step.detail) row.createDiv({ cls: 'lpz-step-detail', text: step.detail });
    }
    if (status === 'error') {
      el.createDiv({ cls: 'lpz-error', text: errorText(job.state) });
      if (/登录/.test(errorText(job.state))) renderAccount(el, this.plugin, 'lpz-account');
    }
    if (status === 'cancelled') el.createDiv({ cls: 'lpz-muted', text: '已取消。已完成的部分已保存，再转同一集会接着做。' });
    const actions = new Setting(el);
    if (status === 'running') {
      el.createDiv({ cls: 'lpz-muted', text: '可以关掉这个窗口，处理会在后台继续；底部状态栏显示进度。' });
      actions.addButton(b => b.setButtonText('取消').onClick(() => job.cancel()));
      actions.addButton(b => b.setButtonText('后台运行').setCta().onClick(() => this.close()));
    } else {
      if (status === 'done') el.createDiv({ cls: 'lpz-muted', text: '文稿已在新标签页打开，位于「播客中文稿」文件夹。' });
      if (status !== 'done') actions.addButton(b => b.setButtonText('重试').onClick(() => { this.plugin.startJob(job.source, job.model); this.render(); }));
      actions.addButton(b => b.setButtonText('再转一集').onClick(() => { this.plugin.clearJob(); this.render(); }));
      if (status === 'done') actions.addButton(b => b.setButtonText('完成').setCta().onClick(() => { this.plugin.clearJob(); this.close(); }));
    }
  }
}

/** The ```podcast-zh``` block in a note: a large, always-visible input for an episode link plus live progress. */
class PodcastPanel extends MarkdownRenderChild {
  constructor(el, plugin) {
    super(el);
    this.plugin = plugin;
    this.draft = '';
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
    el.addClass('lpz-panel');
    const head = el.createDiv({ cls: 'lpz-panel-head' });
    setIcon(head.createSpan({ cls: 'lpz-panel-icon' }), 'podcast');
    head.createSpan({ text: '播客 → 中文稿' });
    const job = this.plugin.job;
    const st = job && job.state;
    if (st && st.status === 'running') {
      const cur = st.steps[st.steps.length - 1];
      el.createDiv({ cls: 'lpz-panel-line', text: cur ? cur.title : '正在启动…' });
      if (cur && cur.detail) el.createDiv({ cls: 'lpz-step-detail', text: cur.detail });
      const row = el.createDiv({ cls: 'lpz-panel-row' });
      row.createEl('button', { text: '查看进度' }).addEventListener('click', () => this.plugin.openModal());
      row.createEl('button', { text: '取消' }).addEventListener('click', () => job.cancel());
      return;
    }
    const row = el.createDiv({ cls: 'lpz-panel-row' });
    const input = row.createEl('input', { type: 'text', cls: 'lpz-panel-input', attr: { placeholder: '粘贴 Apple 播客单集链接（播客 App → 分享 → 拷贝链接）' } });
    input.value = this.draft;
    input.addEventListener('input', () => { this.draft = input.value; });
    input.addEventListener('focus', () => {
      if (input.value) return;
      navigator.clipboard.readText().then(t => { if (looksLikeEpisode(t) && !input.value) { input.value = t.trim(); this.draft = input.value; } }).catch(() => {});
    });
    const model = row.createEl('select', { cls: 'dropdown' });
    for (const [id, label] of Object.entries(MODELS)) model.createEl('option', { value: id, text: label.split(' · ')[0] });
    model.value = this.plugin.settings.model;
    model.addEventListener('change', () => { this.plugin.settings.model = model.value; this.plugin.saveData(this.plugin.settings); });
    const go = row.createEl('button', { cls: 'mod-cta', text: '开始' });
    const start = () => {
      const source = input.value.trim();
      if (!source) { input.focus(); return; }
      this.draft = '';
      this.plugin.startJob(source, model.value);
    };
    go.addEventListener('click', start);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
    if (st && st.status === 'done') {
      const done = el.createDiv({ cls: 'lpz-panel-line' });
      done.createSpan({ text: '上一集已完成 · ' });
      done.createEl('a', { text: '打开文稿', href: '#' }).addEventListener('click', e => { e.preventDefault(); this.plugin.openNote(st.notePath); });
    } else if (st && st.status === 'error') {
      el.createDiv({ cls: 'lpz-error', text: errorText(st) });
    }
  }
}

/** The ```zh-account``` block: which ChatGPT account the 中文稿 tools use, with one-click (re)login. */
class AccountPanel extends MarkdownRenderChild {
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
    el.addClass('lpz-panel', 'lpz-account-panel');
    const head = el.createDiv({ cls: 'lpz-panel-head' });
    setIcon(head.createSpan({ cls: 'lpz-panel-icon' }), 'user-round-check');
    head.createSpan({ text: 'ChatGPT 账号' });
    renderAccount(el, this.plugin, 'lpz-account');
    el.createDiv({ cls: 'lpz-step-detail', text: '播客和杂志翻译都用这个账号。登录会自动续期，一般不用管；显示未登录时点一下按钮，在浏览器里登录即可。' });
  }
}

module.exports = class PodcastZhPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({ model: DEFAULT_MODEL }, await this.loadData());
    if (!MODELS[this.settings.model]) this.settings.model = DEFAULT_MODEL;
    this.job = null;
    this.status = this.addStatusBarItem();
    this.status.addClass('lpz-status', 'mod-clickable');
    this.status.hide();
    this.registerDomEvent(this.status, 'click', () => this.openModal());
    this.addRibbonIcon('podcast', '播客转中文稿', () => this.openModal());
    this.addCommand({ id: 'convert-episode', name: '把播客单集转成中文稿', callback: () => this.openModal() });
    this.addCommand({ id: 'open-workbench', name: '打开中文稿工作台', callback: () => this.openWorkbench() });
    this.addCommand({ id: 'login-chatgpt', name: '登录 ChatGPT（中文稿翻译用）', callback: () => this.startLogin() });
    this.panels = new Set();
    this.modals = new Set();
    this.registerMarkdownCodeBlockProcessor('podcast-zh', (source, el, ctx) => ctx.addChild(new PodcastPanel(el, this)));
    this.registerMarkdownCodeBlockProcessor('zh-account', (source, el, ctx) => ctx.addChild(new AccountPanel(el, this)));
    // First run after installation: show the workbench once so the inputs are easy to find.
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.welcomed) return;
      this.settings.welcomed = true;
      this.saveData(this.settings);
      this.openWorkbench();
    });
  }

  openWorkbench() {
    const file = this.app.vault.getAbstractFileByPath(WORKBENCH);
    if (file instanceof TFile) this.openNote(require('path').join(this.app.vault.adapter.getBasePath(), WORKBENCH));
    else new Notice('找不到「中文稿工作台」笔记。');
  }

  refreshPanels() {
    for (const panel of this.panels) panel.render();
  }

  onunload() {
    if (this.job) this.job.cancel();
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

  openModal() {
    new PodcastModal(this.app, this).open();
  }

  clearJob() {
    if (this.job && this.job.state.status === 'running') return;
    this.job = null;
    this.status.hide();
    this.refreshPanels();
  }

  startJob(source, model) {
    if (this.job && this.job.state.status === 'running') return;
    const adapter = this.app.vault.adapter;
    const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
    const job = new Job(this, source, model);
    this.job = job;
    job.listeners.add(state => this.onJobState(job, state));
    job.start(vaultPath);
    this.refreshPanels();
  }

  onJobState(job, state) {
    if (this.job !== job) return;
    this.refreshPanels();
    const current = state.steps[state.steps.length - 1];
    if (state.status === 'running') {
      const label = current ? current.title.replace(/[…。]+$/, '') : '启动中';
      this.status.setText(`播客 · ${current && current.detail ? current.detail : label}`);
      this.status.show();
    } else if (state.status === 'done' && !job.announced) {
      job.announced = true;
      this.status.setText('播客中文稿已完成');
      new Notice('播客中文稿已完成');
      this.openNote(state.notePath);
      window.setTimeout(() => { if (this.job === job) this.status.hide(); }, 8000);
    } else if (state.status === 'error' && !job.announced) {
      job.announced = true;
      this.status.setText('播客转换失败');
      new Notice(`播客转换失败：${errorText(state)}`, 10000);
    } else if (state.status === 'cancelled') {
      this.status.hide();
    }
  }

  async openNote(absolute) {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter) || !absolute) return;
    const base = adapter.getBasePath().replace(/\/+$/, '') + '/';
    if (!absolute.startsWith(base)) return;
    const rel = absolute.slice(base.length);
    // The tool writes the file outside Obsidian; wait briefly for the vault to index it.
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

module.exports.applyLine = applyLine;
module.exports.applyError = applyError;
module.exports.errorText = errorText;
module.exports.looksLikeEpisode = looksLikeEpisode;
module.exports.Job = Job;
