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
// renders a combined live dashboard with per-account state.

class AccountProgressMap {
  constructor({ title = 'Multi-Account Progress', width = 96, accountNames = [], proxyRotation = null } = {}) {
    this.title = title;
    this.width = width;
    this.accountNames = accountNames;
    this.trackers = new Map(); // accountName -> StepTracker
    this.proxies = new Map(); // accountName -> { label, source, healthy }
    this.states = new Map(); // accountName -> { label, index, total, done, error, failedStep, startTime, elapsedMs }
    this.currentAccount = null;
    // Pre-seed empty trackers so queued accounts appear immediately
    for (const name of accountNames) {
      if (!this.trackers.has(name)) {
        const t = new StepTracker({ title: `Automation — ${name}`, width: this.width });
        t.add('Queued');
        this.trackers.set(name, t);
      }
      // Pre-assign proxies so queued accounts show proxy info immediately
      if (proxyRotation?.enabled) {
        const proxy = proxyRotation.assign(name);
        if (proxy) {
          this.setProxy(name, { label: proxy.label, source: 'rotation', healthy: true });
        }
      }
    }
  }

  createTracker(accountName, title) {
    const existing = this.trackers.get(accountName);
    if (existing) {
      // Preserve pre-seeded tracker; mark Queued as done, add Starting
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

  // ─── Lightweight dashboard state ──────────────────────

  setState(accountName, { label, index, total } = {}) {
    const s = this.states.get(accountName) || {};
    if (!s.startTime) s.startTime = Date.now();
    if (label !== undefined) s.label = label;
    if (index !== undefined) s.index = index;
    if (total !== undefined) s.total = total;
    this.states.set(accountName, s);
  }

  setDone(accountName) {
    const s = this.states.get(accountName) || {};
    s.done = true;
    s.elapsedMs = Date.now() - (s.startTime || Date.now());
    this.states.set(accountName, s);
  }

  setError(accountName, { failedStep, error } = {}) {
    const s = this.states.get(accountName) || {};
    s.error = error;
    s.failedStep = failedStep;
    s.elapsedMs = Date.now() - (s.startTime || Date.now());
    this.states.set(accountName, s);
  }

  // ─── Rendering ────────────────────────────────────────

  render() {
    const w = clampWidth(this.width);
    const inner = w - 2;
    const lines = [];

    const entries = Array.from(this.trackers.entries());
    const total = this.accountNames.length || entries.length;

    // Categorize accounts using state first, tracker fallback
    let doneCount = 0;
    let errCount = 0;
    let runningCount = 0;
    for (const [name] of entries) {
      const state = this.states.get(name);
      if (state?.done) { doneCount++; }
      else if (state?.error) { errCount++; }
      else if (state?.label || this.getTracker(name)?.summary().running > 0) { runningCount++; }
    }
    const queuedCount = total - doneCount - errCount - runningCount;

    // Header stats
    const overallPct = total ? Math.round(((doneCount + errCount) / total) * 100) : 0;
    const bar = this._miniBar(overallPct, 18);
    lines.push(
      `  ${color('Accounts:', C.label)} ${color(`${doneCount + errCount + runningCount}/${total}`, C.primary)}  ${bar}  ${color(`${overallPct}%`, C.primary)}`,
      `  ${color('Done:', C.label)} ${color(String(doneCount), C.success)}  ${color('Run:', C.label)} ${color(String(runningCount), C.primary)}  ${color('Fail:', C.label)} ${color(String(errCount), C.error)}  ${color('Queue:', C.label)} ${color(String(queuedCount), C.muted)}`,
      '',
    );

    // Show every single account — no truncation
    const visible = entries;

    for (const [name, tracker] of visible) {
      if (name === null) {
        lines.push(`  ${color(tracker.label, C.muted)}`);
        continue;
      }
      const isCurrent = name === this.currentAccount;
      const state = this.states.get(name) || {};
      const sum = tracker.summary();

      // Status symbol
      let sym;
      if (state.done) sym = color('✓', C.success);
      else if (state.error) sym = color('✗', C.error);
      else if (isCurrent) sym = color('▶', C.primary);
      else if (state.label) sym = color('◐', C.primary);
      else sym = color('○', C.muted);

      const nameCol = color(name, isCurrent ? `${ANSI.bold}${C.value}` : C.value);

      // Build step description
      let stepText = '';
      let pct = 0;
      if (state.done) {
        const elapsed = state.elapsedMs ? this._fmtTime(state.elapsedMs) : '';
        stepText = `${color('Done', C.success)} ${color(`(${state.total || sum.total || '?'} steps)`, C.muted)}${elapsed ? ` ${color(elapsed, C.muted)}` : ''}`;
        pct = 100;
      } else if (state.error) {
        const failedLabel = state.failedStep || state.label || '?';
        let errDisplay = state.error;
        if (errDisplay.length > 28) errDisplay = errDisplay.slice(0, 25) + '...';
        stepText = `${color(`Failed at: ${failedLabel}`, C.error)} ${color(`— ${errDisplay}`, C.errorText)}`;
        pct = Math.round(((state.index || 0) / (state.total || 1)) * 100);
      } else if (state.label) {
        const idx = state.index ?? '?';
        const tot = state.total ?? '?';
        stepText = `${color(`Step ${idx}/${tot}:`, C.label)} ${color(state.label, C.primary)}`;
        pct = Math.round(((state.index || 0) / (state.total || 1)) * 100);
      } else if (sum.running > 0 || sum.done > 0) {
        const finished = sum.done + sum.errors + sum.skipped;
        stepText = `${color(`${finished}/${sum.total} steps`, C.primary)}`;
        pct = sum.total ? Math.round((finished / sum.total) * 100) : 0;
      } else {
        stepText = color('queued', C.muted);
        pct = 0;
      }

      // Proxy badge
      const proxyInfo = this.proxies.get(name);
      const proxyBadge = proxyInfo
        ? proxyInfo.healthy
          ? color(`[${proxyInfo.label}]`, C.success)
          : color(`[${proxyInfo.label}]`, C.error)
        : color('[no proxy]', C.muted);

      const barMini = this._miniBar(pct, 10);
      const pctStr = color(String(pct).padStart(3), pct >= 80 ? C.success : pct >= 40 ? C.warn : C.primary);

      // Compose row with dynamic truncation for step text
      const fixedPartsWidth = stripAnsi(`  ${sym} ${name}  ${barMini}  ${pctStr}%  ${proxyBadge}`).length;
      const maxStepWidth = Math.max(12, inner - fixedPartsWidth - 4);
      let cleanStep = stripAnsi(stepText);
      if (cleanStep.length > maxStepWidth) {
        // Truncate the colored stepText intelligently
        let truncated = '';
        let plainLen = 0;
        const ansiRegex = /\x1b\[[0-9;]*m/g;
        const parts = stepText.split(ansiRegex);
        const codes = stepText.match(ansiRegex) || [];
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          const code = codes[i] || '';
          const remaining = maxStepWidth - plainLen - 3;
          if (remaining <= 0) break;
          if (part.length <= remaining) {
            truncated += code + part;
            plainLen += part.length;
          } else {
            truncated += code + part.slice(0, remaining) + '...';
            plainLen += remaining + 3;
            break;
          }
        }
        // Close any open ANSI codes
        truncated += '\x1b[0m';
        stepText = truncated;
      }

      lines.push(`  ${sym} ${nameCol}  ${stepText}  ${barMini}  ${pctStr}%  ${proxyBadge}`);
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

  _fmtTime(ms) {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = ((ms % 60000) / 1000).toFixed(0);
    return `${m}m${s.padStart(2, '0')}s`;
  }
}

module.exports = {
  StepTracker,
  LiveTracker,
  AccountProgressMap,
  STATUS,
  STATUS_META,
};
