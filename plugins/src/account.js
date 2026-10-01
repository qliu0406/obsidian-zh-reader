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
