const path = require('path');
const { paths } = require('../config/paths');
const { readJson, writeJson } = require('../config/files');

function classifyFailure(error) {
  const text = String(error?.message || error || '').toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('preflight') || text.includes('config') || text.includes('private key') || text.includes('cookies')) return 'config';
  if (text.includes('abort') || text.includes('timeout') || text.includes('timed out')) return 'timeout';
  if (text.includes('proxy') || text.includes('econn') || text.includes('socket') || text.includes('network') || text.includes('fetch failed')) return 'network';
  if (text.includes('401') || text.includes('403') || text.includes('csrf') || text.includes('auth')) return 'auth';
  if (text.includes('429') || text.includes('rate')) return 'rate-limit';
  if (text.includes('500') || text.includes('502') || text.includes('503') || text.includes('504')) return 'server';
  return 'runtime';
}

function reportPath(task) {
  const safeTask = String(task || 'run').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(paths.reportsDir, `${safeTask}-${stamp}.json`);
}

function writeRunReport(report, file = null) {
  const target = file || reportPath(report.task);
  writeJson(target, report);
  return target;
}

function loadResumeReport(file) {
  const loaded = readJson(file, null);
  return loaded && Array.isArray(loaded.results) ? loaded : null;
}

function successfulAccounts(report) {
  return new Set((report?.results || []).filter((row) => row.ok).map((row) => row.account));
}

module.exports = { classifyFailure, writeRunReport, loadResumeReport, successfulAccounts };
