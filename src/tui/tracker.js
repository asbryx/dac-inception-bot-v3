const { color, C, ANSI, theme } = require('./theme');
const { box, clampWidth, padAnsi, stripAnsi } = require('./renderer');
const { shortHash, shortAddress } = require('../utils/format');

const S = theme.symbols;

// ─── Step Status ────────────────────────────────────────

const STATUS = {
  PENDING:  'pending',
  RUNNING:  'running',
  DONE:     'done',
  ERROR:    'error',
  SKIPPED:  'skipped',
};

const STATUS_META = {
  [STATUS.PENDING]: { icon: '○', tone: C.muted },
  [STATUS.RUNNING]: { icon: '◐', tone: C.primary },
  [STATUS.DONE]:    { icon: '✓', tone: C.success },
  [STATUS.ERROR]:   { icon: '✗', tone: C.error },
  [STATUS.SKIPPED]: { icon: '⊘', tone: C.warn },
};

// ─── Step Tracker ───────────────────────────────────────
// Tracks a hierarchical list of execution steps with rich
// metadata, timing, and visual rendering.

class StepTracker {
  constructor({ title = 'Process', width = 96 } = {}) {
    this.title = title;
    this.width = width;
    this.steps = [];
    this.startedAt = Date.now();
    this.finishedAt = null;
    this._idCounter = 0;
  }

  _nextId() { return `step_${++this._idCounter}`; }

  add(label, { id = null, detail = null, type = 'step' } = {}) {
    const step = {
      id: id || this._nextId(),
      label,
      type,
      status: STATUS.PENDING,
      detail,
      startedAt: null,
      finishedAt: null,
      error: null,
      txHash: null,
      explorerUrl: null,
      amount: null,
      meta: {},
    };
    this.steps.push(step);
    return step;
  }

  start(stepId) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return null;
    step.status = STATUS.RUNNING;
    step.startedAt = Date.now();
    return step;
  }

  startByLabel(label) {
    const step = this.steps.find((s) => s.label === label && s.status === STATUS.PENDING);
    if (!step) return null;
    return this.start(step.id);
  }

  finish(stepId, { detail = null, txHash = null, explorerUrl = null, amount = null, meta = {} } = {}) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return null;
    step.status = STATUS.DONE;
    step.finishedAt = Date.now();
    if (detail !== null) step.detail = detail;
    if (txHash !== null) step.txHash = txHash;
    if (explorerUrl !== null) step.explorerUrl = explorerUrl;
    if (amount !== null) step.amount = amount;
    Object.assign(step.meta, meta);
    return step;
  }

  fail(stepId, error) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return null;
    step.status = STATUS.ERROR;
    step.finishedAt = Date.now();
    step.error = error?.message || String(error);
    return step;
  }

  skip(stepId, reason = null) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return null;
    step.status = STATUS.SKIPPED;
    step.finishedAt = Date.now();
    step.detail = reason || 'skipped';
    return step;
  }

  skipByLabel(label, reason = null) {
    const step = this.steps.find((s) => s.label === label && s.status === STATUS.PENDING);
    if (!step) return null;
    return this.skip(step.id, reason);
  }

  setDetail(stepId, detail) {
    const step = this.steps.find((s) => s.id === stepId);
    if (step) step.detail = detail;
  }

  setTx(stepId, { txHash, explorerUrl, amount } = {}) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return;
    if (txHash) step.txHash = txHash;
    if (explorerUrl) step.explorerUrl = explorerUrl;
    if (amount) step.amount = amount;
  }

  isComplete() {
    return this.steps.every((s) => s.status !== STATUS.PENDING && s.status !== STATUS.RUNNING);
  }

  summary() {
    const total = this.steps.length;
    const done = this.steps.filter((s) => s.status === STATUS.DONE).length;
    const errors = this.steps.filter((s) => s.status === STATUS.ERROR).length;
    const skipped = this.steps.filter((s) => s.status === STATUS.SKIPPED).length;
    const running = this.steps.filter((s) => s.status === STATUS.RUNNING).length;
    const pending = this.steps.filter((s) => s.status === STATUS.PENDING).length;
    return { total, done, errors, skipped, running, pending };
  }

  durationMs() {
    const end = this.finishedAt || Date.now();
    return end - this.startedAt;
  }

  // ─── Rendering ────────────────────────────────────────

  render({ compact = false } = {}) {
    const w = clampWidth(this.width);
    const inner = w - 2;
    const lines = [];

    // Header with live progress
    const sum = this.summary();
    const pct = sum.total ? Math.round((sum.done + sum.errors + sum.skipped) / sum.total * 100) : 0;
    const elapsed = this._fmtDuration(this.durationMs());
    lines.push(
      `  ${color('Progress:', C.label)} ${color(`${pct}%`, C.primary)}  ${color(`${sum.done} done`, C.success)}  ${color(`${sum.errors} err`, C.error)}  ${color(`${sum.skipped} skip`, C.warn)}  ${color(elapsed, C.muted)}`,
      '',
    );

    // Steps
    const visible = compact ? this.steps.slice(-12) : this.steps;
    if (compact && this.steps.length > 12) {
      lines.push(`  ${color(`... ${this.steps.length - 12} earlier steps`, C.muted)}`);
    }

    for (const step of visible) {
      lines.push(...this._renderStep(step, inner - 2));
    }

    if (this.isComplete()) {
      lines.push('');
      const finalTone = sum.errors > 0 ? C.error : C.success;
      lines.push(`  ${color('Completed', `${ANSI.bold}${finalTone}`)} in ${color(elapsed, C.muted)}`);
    }

    return box(`${S.diamond} ${this.title}`, lines, w);
  }

  _renderStep(step, innerWidth) {
    const meta = STATUS_META[step.status];
    const icon = color(meta.icon, meta.tone);
    const label = color(step.label, step.status === STATUS.RUNNING ? C.value : C.label);
    const dur = step.startedAt ? color(this._fmtDuration((step.finishedAt || Date.now()) - step.startedAt), C.muted) : '';

    const main = `  ${icon} ${label}${dur ? ` ${dur}` : ''}`;
    const out = [main];

    // Detail line
    if (step.detail || step.amount) {
      const parts = [];
      if (step.amount) parts.push(color(step.amount, C.primary));
      if (step.detail) parts.push(color(step.detail, C.muted));
      out.push(`      ${color(S.pipe, C.muted)} ${parts.join(` ${color(S.pipe, C.muted)} `)}`);
    }

    // TX line
    if (step.txHash || step.explorerUrl) {
      const hash = step.txHash ? shortHash(step.txHash) : '';
      const url = step.explorerUrl || '';
      if (hash) {
        out.push(`      ${color(S.arrow, C.primary)} ${color('Tx', C.label)} ${color(hash, C.primary)}`);
      }
      if (url) {
        out.push(`      ${color(S.arrow, C.muted)} ${color(url, C.muted)}`);
      }
    }

    // Error line
    if (step.error) {
      const errText = step.error.length > innerWidth - 8 ? step.error.slice(0, innerWidth - 11) + '...' : step.error;
      out.push(`      ${color(S.fail, C.error)} ${color(errText, C.errorText)}`);
    }

    return out;
  }

  _fmtDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(0);
    return `${m}m${s.padStart(2, '0')}s`;
  }
}

// ─── Live Tracker Dashboard ─────────────────────────────
// Wraps a StepTracker and renders it continuously to the
// terminal for TTY environments.

class LiveTracker {
  constructor(tracker, { onUpdate = null, fps = 8 } = {}) {
    this.tracker = tracker;
    this.onUpdate = onUpdate;
    this.fps = fps;
    this._interval = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    if (process.stdout.isTTY) {
      this._interval = setInterval(() => this._draw(), 1000 / this.fps);
    }
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    if (this._interval) { clearInterval(this._interval); this._interval = null; }
    if (process.stdout.isTTY) {
      console.clear();
      process.stdout.write(`${this.tracker.render()}\n`);
    }
  }

  _draw() {
    if (!process.stdout.isTTY) return;
    console.clear();
    process.stdout.write(`${this.tracker.render({ compact: true })}\n`);
    if (this.onUpdate) this.onUpdate(this.tracker);
  }

  // Proxy methods
  add(...args) { return this.tracker.add(...args); }
  start(id) { return this.tracker.start(id); }
  finish(...args) { return this.tracker.finish(...args); }
  fail(...args) { return this.tracker.fail(...args); }
  skip(...args) { return this.tracker.skip(...args); }
  setTx(...args) { return this.tracker.setTx(...args); }
  setDetail(...args) { return this.tracker.setDetail(...args); }
  summary() { return this.tracker.summary(); }
  isComplete() { return this.tracker.isComplete(); }
}

// ─── Account Progress Map ───────────────────────────────
// Manages multiple StepTrackers (one per account) and
// renders a combined live dashboard.

class AccountProgressMap {
  constructor({ title = 'Multi-Account Progress', width = 96, accountNames = [] } = {}) {
    this.title = title;
    this.width = width;
    this.accountNames = accountNames;
    this.trackers = new Map(); // accountName -> StepTracker
    this.proxies = new Map(); // accountName -> { label, source, healthy }
    this.currentAccount = null;
    // Pre-seed empty trackers so queued accounts appear immediately
    for (const name of accountNames) {
      if (!this.trackers.has(name)) {
        const t = new StepTracker({ title: `Automation — ${name}`, width: this.width });
        t.add('Queued');
        this.trackers.set(name, t);
      }
    }
  }

  createTracker(accountName, title) {
    const existing = this.trackers.get(accountName);
    if (existing) {
      // Preserve pre-seeded tracker; transition Queued -> Starting
      const queued = existing.steps.find((s) => s.label === 'Queued');
      if (queued) {
        queued.label = 'Starting...';
        queued.status = STATUS.RUNNING;
        queued.startedAt = Date.now();
      } else {
        existing.add('Starting...');
      }
      existing.title = title;
      return existing;
    }
    const tracker = new StepTracker({ title, width: this.width });
    tracker.add('Starting...');
    this.trackers.set(accountName, tracker);
    return tracker;
  }

  getTracker(accountName) {
    return this.trackers.get(accountName);
  }

  setCurrent(accountName) {
    this.currentAccount = accountName;
  }

  setProxy(accountName, { label, source, healthy } = {}) {
    this.proxies.set(accountName, { label: label || 'none', source: source || 'none', healthy: healthy !== false });
  }

  render() {
    const w = clampWidth(this.width);
    const inner = w - 2;
    const lines = [];

    const entries = Array.from(this.trackers.entries());
    const doneCount = entries.filter(([, t]) => t.isComplete()).length;
    const errCount = entries.filter(([, t]) => {
      const s = t.summary();
      return s.errors > 0;
    }).length;
    const total = this.accountNames.length || entries.length;
    const runningCount = entries.filter(([, t]) => {
      const s = t.summary();
      return s.running > 0;
    }).length;
    const queuedCount = total - doneCount - runningCount;

    // Header stats
    const pct = total ? Math.round((doneCount / total) * 100) : 0;
    const bar = this._miniBar(pct, 18);
    lines.push(
      `  ${color('Accounts:', C.label)} ${color(`${doneCount}/${total}`, C.primary)}  ${bar}  ${color(`${pct}%`, C.primary)}`,
      `  ${color('Done:', C.label)} ${color(String(doneCount), C.success)}  ${color('Run:', C.label)} ${color(String(runningCount), C.primary)}  ${color('Fail:', C.label)} ${color(String(errCount), C.error)}  ${color('Queue:', C.label)} ${color(String(queuedCount), C.muted)}`,
      '',
    );

    // Determine how many we can show (reserve ~8 lines for header + footer)
    const maxVisible = Math.max(12, Math.min(this.accountNames.length, 30));
    let visible = entries.slice(0, maxVisible);
    if (entries.length > maxVisible) {
      visible = entries.slice(0, maxVisible - 1);
      const remaining = entries.length - visible.length;
      visible.push([null, { label: `... and ${remaining} more accounts` }]);
    }

    for (const [name, tracker] of visible) {
      if (name === null) {
        lines.push(`  ${color(tracker.label, C.muted)}`);
        continue;
      }
      const isCurrent = name === this.currentAccount;
      const sum = tracker.summary();
      const prefix = isCurrent ? color('▶', C.primary) : ' ';
      const nameCol = color(name, isCurrent ? C.value : C.muted);
      const accPct = sum.total ? Math.round((sum.done + sum.errors + sum.skipped) / sum.total * 100) : 0;
      const barMini = this._miniBar(accPct, 10);
      const status = sum.errors > 0 ? color(`${sum.errors} err`, C.error)
        : sum.skipped > 0 ? color(`${sum.skipped} skip`, C.warn)
        : tracker.isComplete() ? color('done', C.success)
        : sum.pending === sum.total && sum.total > 0 ? color('queued', C.muted)
        : color(`${accPct}%`, C.primary);

      // Proxy indicator
      const proxyInfo = this.proxies.get(name);
      const proxyBadge = proxyInfo
        ? proxyInfo.healthy
          ? color(`[${proxyInfo.label}]`, C.success)
          : color(`[${proxyInfo.label}]`, C.error)
        : color('[no proxy]', C.muted);

      lines.push(`  ${prefix} ${nameCol}  ${barMini}  ${status}  ${proxyBadge}`);

      // Show current running step (only for current account to save space)
      const running = tracker.steps.find((s) => s.status === STATUS.RUNNING);
      if (running && isCurrent) {
        lines.push(`      ${color(S.pipe, C.muted)} ${color(running.label, C.muted)} ${running.detail ? color(`| ${running.detail}`, C.muted) : ''}`);
      }

      // Show last TX if any (only for current account)
      const lastTx = tracker.steps.slice().reverse().find((s) => s.txHash);
      if (lastTx && isCurrent) {
        lines.push(`      ${color(S.arrow, C.muted)} ${color(shortHash(lastTx.txHash), C.primary)}`);
      }
    }

    return box(`${S.diamond} ${this.title}`, lines, w);
  }

  _miniBar(pct, width) {
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
    const tone = pct >= 80 ? C.success : pct >= 40 ? C.warn : C.primary;
    return color(bar, tone);
  }
}

module.exports = {
  StepTracker,
  LiveTracker,
  AccountProgressMap,
  STATUS,
  STATUS_META,
};
