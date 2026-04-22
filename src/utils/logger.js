const { redactSecrets } = require('../config/secrets');

// Inline ANSI — logger is standalone, doesn't import theme to avoid cycles.
const A = {
  R: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[96m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  red: '\x1b[31m',
  gray: '\x1b[38;5;245m',
  dark: '\x1b[38;5;238m',
};

function ts() {
  return `${A.dark}${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')}${A.R}`;
}

function fmt(message, meta) {
  return meta
    ? `${message} ${A.gray}${JSON.stringify(redactSecrets(meta))}${A.R}`
    : message;
}

function createLogger({ quiet = false } = {}) {
  return {
    quiet,
    info(message, meta = null) {
      if (quiet) return;
      console.log(`${ts()} ${A.cyan}▸${A.R} ${fmt(message, meta)}`);
    },
    success(message, meta = null) {
      if (quiet) return;
      console.log(`${ts()} ${A.green}✓${A.R} ${fmt(message, meta)}`);
    },
    warn(message, meta = null) {
      if (quiet) return;
      console.log(`${ts()} ${A.yellow}!${A.R} ${fmt(message, meta)}`);
    },
    error(message, meta = null) {
      console.error(`${ts()} ${A.red}✗${A.R} ${A.red}${fmt(message, meta)}${A.R}`);
    },
    step(label, message) {
      if (quiet) return;
      console.log(`${ts()} ${A.cyan}◆${A.R} ${A.bold}${label}${A.R} ${A.gray}${message}${A.R}`);
    },
  };
}

module.exports = { createLogger };
