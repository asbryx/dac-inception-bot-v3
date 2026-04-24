const fs = require('fs');
const path = require('path');
const { isSecretFile } = require('./secrets');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }

  try {
    // Strip UTF-8 BOM if present; Windows editors often add it.
    const cleaned = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    return JSON.parse(cleaned);
  } catch (error) {
    error.message = `Invalid JSON in ${file}: ${error.message}`;
    throw error;
  }
}

function writeJson(file, data, { mode } = {}) {
  ensureDir(path.dirname(file));
  const resolvedMode = mode || (isSecretFile(file) ? 0o600 : 0o644);
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, { mode: resolvedMode });
  fs.renameSync(tempFile, file);
  fs.chmodSync(file, resolvedMode);
}

module.exports = { ensureDir, readJson, writeJson };
