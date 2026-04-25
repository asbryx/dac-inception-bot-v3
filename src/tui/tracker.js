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
  PENDING_TX: 'pending_tx',
};

const STATUS_META = {
  [STATUS.PENDING]: { icon: '○', tone: C.muted },
  [STATUS.RUNNING]: { icon: '◐', tone: C.primary },
  [STATUS.DONE]:    { icon: '✓', tone: C.success },
  [STATUS.ERROR]:   { icon: '✗', tone: C.error },
  [STATUS.SKIPPED]: { icon: '⊘', tone: C.warn },
  [STATUS.PENDING_TX]: { icon: '◌', tone: C.warn },
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

  finish(stepId, { detail = null, txHash = null, explorerUrl = null, amount = null, status = null, meta = {} } = {}) {
    const step = this.steps.find((s) => s.id === stepId);
    if (!step) return null;
    step.status = status === 'pending' ? STATUS.PENDING_TX : STATUS.DONE;
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
    const pendingTx = this.steps.filter((s) => s.status === STATUS.PENDING_TX).length;
    const running = this.steps.filter((s) => s.status === STATUS.RUNNING).length;
    const pending = this.steps.filter((s) => s.status === STATUS.PENDING).length;
    return { total, done, errors, skipped, pendingTx, running, pending };
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
    const pct = sum.total ? Math.round((sum.done + sum.errors + sum.skipped + sum.pendingTx) / sum.total * 100) : 0;
    const elapsed = this._fmtDuration(this.durationMs());
    lines.push(
      `  ${color('Progress:', C.label)} ${color(`${pct}%`, C.primary)}  ${color(`${sum.done} done`, C.success)}  ${color(`${sum.pendingTx} pending`, C.warn)}  ${color(`${sum.errors} err`, C.error)}  ${color(`${sum.skipped} skip`, C.warn)}  ${color(elapsed, C.muted)}`,
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
    this.focusAccount = null;
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
    this.focusAccount = accountName;
  }

  setProxy(accountName, { label, source, healthy } = {}) {
    this.proxies.set(accountName, { label: label || 'none', source: source || 'none', healthy: healthy !== false });
  }

  // ─── Lightweight dashboard state ──────────────────────

  setState(accountName, { label, index, total, detail } = {}) {
    const s = this.states.get(accountName) || {};
    if (!s.startTime) s.startTime = Date.now();
    const labelChanged = label !== undefined && label !== s.label;
    if (label !== undefined) s.label = label;
    if (index !== undefined) s.index = index;
    if (total !== undefined) s.total = total;
    if (detail !== undefined) s.detail = detail;
    else if (labelChanged) s.detail = null;
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
    this.focusAccount = accountName;
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
        stepText = color(`Failed at: ${failedLabel}`, C.error);
        pct = Math.round(((state.index || 0) / (state.total || 1)) * 100);
      } else if (state.label) {
        const idx = state.index ?? '?';
        const tot = state.total ?? '?';
        const liveLabel = state.detail ? `${state.label} -> ${state.detail}` : state.label;
        stepText = `${color(`Step ${idx}/${tot}:`, C.label)} ${color(liveLabel, C.primary)}`;
        pct = Math.round(((state.index || 0) / (state.total || 1)) * 100);
      } else if (sum.running > 0 || sum.done > 0) {
        const finished = sum.done + sum.errors + sum.skipped + sum.pendingTx;
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

      const rowHint = this._rowHint(tracker, state, 18);
      const rowSuffix = rowHint ? `  ${rowHint}` : '';

      // Compose row with dynamic truncation for step text, including short right-side hints.
      const fixedPartsWidth = stripAnsi(`  ${sym} ${name}  ${barMini}  ${pctStr}%  ${proxyBadge}${rowSuffix}`).length;
      const maxStepWidth = Math.max(10, inner - fixedPartsWidth - 4);
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

      lines.push(`  ${sym} ${nameCol}  ${stepText}  ${barMini}  ${pctStr}%  ${proxyBadge}${rowSuffix}`);
    }

    const focus = this._pickFocusAccount(entries);
    if (focus) {
      lines.push('', ...this._renderDetailPanel(focus.name, focus.tracker, this.states.get(focus.name) || {}, inner));
    }

    return box(`${S.diamond} ${this.title}`, lines, w);
  }

  _pickFocusAccount(entries) {
    const named = entries.filter(([name]) => name !== null);
    const explicit = named.find(([name]) => name === this.focusAccount);
    if (explicit) return { name: explicit[0], tracker: explicit[1] };

    const failed = [...named].reverse().find(([name]) => this.states.get(name)?.error);
    if (failed) return { name: failed[0], tracker: failed[1] };

    const current = named.find(([name]) => name === this.currentAccount);
    if (current) return { name: current[0], tracker: current[1] };

    const running = named.find(([name, tracker]) => this.states.get(name)?.label || tracker.summary().running > 0);
    if (running) return { name: running[0], tracker: running[1] };

    const withDetail = [...named].reverse().find(([, tracker]) => tracker.steps.some((step) => step.txHash || step.error || step.detail));
    return withDetail ? { name: withDetail[0], tracker: withDetail[1] } : null;
  }

  _renderDetailPanel(name, tracker, state, inner) {
    const activeStep = this._findStepForState(tracker, state);
    const lastTxStep = [...tracker.steps].reverse().find((step) => step.txHash || step.explorerUrl);
    const lastErrorStep = [...tracker.steps].reverse().find((step) => step.error);
    const proxyInfo = this.proxies.get(name);
    const lines = [];

    lines.push(`  ${color('Details:', C.label)} ${color(name, C.value)}`);
    const statusParts = [];
    if (state.error) statusParts.push(color(`failed at ${state.failedStep || state.label || 'unknown step'}`, C.error));
    else if (state.done) statusParts.push(color('done', C.success));
    else if (state.label) statusParts.push(color(`step ${state.index ?? '?'}/${state.total ?? '?'} ${state.label}`, C.primary));
    else statusParts.push(color('queued', C.muted));
    if (proxyInfo) statusParts.push(color(`proxy ${proxyInfo.label}`, proxyInfo.healthy ? C.success : C.error));
    if (state.elapsedMs) statusParts.push(color(this._fmtTime(state.elapsedMs), C.muted));
    lines.push(`      ${statusParts.join(color(' | ', C.muted))}`);

    if (activeStep?.detail || state.detail) {
      lines.push(`      ${color('Now:', C.label)} ${color(activeStep?.detail || state.detail, C.muted)}`);
    }

    const err = activeStep?.error || lastErrorStep?.error || state.error;
    if (err) {
      const diagnosis = this._explainError(err);
      lines.push(`      ${color('Error:', C.label)} ${color(err, C.errorText)}`);
      lines.push(`      ${color('Diagnosis:', C.label)} ${color(diagnosis.summary, C.warn)}`);
      lines.push(`      ${color('Action:', C.label)} ${color(diagnosis.action, C.muted)}`);
    }

    const txStep = activeStep?.txHash || activeStep?.explorerUrl ? activeStep : lastTxStep;
    if (txStep) {
      const status = txStep.detail ? ` ${color(`(${txStep.detail})`, C.warn)}` : '';
      if (txStep.txHash) lines.push(`      ${color('Tx:', C.label)} ${color(txStep.txHash, C.primary)}${status}`);
      if (txStep.explorerUrl) lines.push(`      ${color('Explorer:', C.label)} ${color(txStep.explorerUrl, C.muted)}`);
    }

    return lines.slice(0, Math.max(5, Math.floor(inner / 12)));
  }

  _rowHint(tracker, state, max = 18) {
    const activeStep = this._findStepForState(tracker, state);
    const lastTxStep = [...tracker.steps].reverse().find((step) => step.txHash || step.explorerUrl);
    const lastErrorStep = [...tracker.steps].reverse().find((step) => step.error);
    const err = activeStep?.error || lastErrorStep?.error || state.error;
    if (err) return color(`err ${this._shortError(err, max)}`, C.errorText);
    const txStep = activeStep?.txHash || activeStep?.explorerUrl ? activeStep : lastTxStep;
    if (txStep?.txHash) {
      const status = txStep.detail ? ` ${txStep.detail}` : '';
      return color(this._truncatePlain(`tx ${shortHash(txStep.txHash)}${status}`, max + 4), C.muted);
    }
    return null;
  }

  _truncatePlain(text, max) {
    const clean = String(text || '');
    return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
  }

  _shortError(error, max = 48) {
    const text = this._explainError(error).summary || String(error || 'unknown error');
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  }

  _explainError(error) {
    const text = String(error || 'unknown error');
    const lower = text.toLowerCase();
    if (lower.includes('not confirmed') || lower.includes('timeout')) {
      return {
        summary: 'Transaction was submitted but not confirmed before timeout.',
        action: 'Check the explorer status before retrying; it may still confirm later.',
      };
    }
    if (lower.includes('replacement fee too low') || lower.includes('underpriced')) {
      return {
        summary: 'Replacement transaction was rejected because the gas bump is too small.',
        action: 'Wait for the pending nonce or retry with a higher max fee / priority fee.',
      };
    }
    if (lower.includes('nonce too low')) {
      return {
        summary: 'Nonce was already used by another confirmed or pending transaction.',
        action: 'Refresh wallet state and avoid running the same account in parallel.',
      };
    }
    if (lower.includes('insufficient funds')) {
      return {
        summary: 'Wallet balance is too low to pay gas or value.',
        action: 'Fund the wallet before retrying this step.',
      };
    }
    if (lower.includes('execution reverted')) {
      return {
        summary: 'Contract rejected the transaction.',
        action: 'Check eligibility, mint state, and contract revert reason before retrying.',
      };
    }
    return {
      summary: text.length > 80 ? `${text.slice(0, 77)}...` : text,
      action: 'Inspect the full error and last transaction before retrying.',
    };
  }

  _findStepForState(tracker, state) {
    if (!tracker?.steps?.length) return null;
    if (state?.error) {
      return [...tracker.steps].reverse().find((step) => step.status === STATUS.ERROR) || null;
    }
    const byLabel = state?.label
      ? [...tracker.steps].reverse().find((step) => step.label === state.label)
      : null;
    if (byLabel) return byLabel;
    return [...tracker.steps].reverse().find((step) => step.status === STATUS.RUNNING)
      || [...tracker.steps].reverse().find((step) => step.txHash || step.error || step.detail)
      || null;
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
