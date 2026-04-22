const { redactSecrets } = require('../config/secrets');

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  red: '\x1b[31m',
  slate: '\x1b[38;5;245m',
  darkGray: '\x1b[38;5;238m',
  warmGray: '\x1b[38;5;249m',
  coral: '\x1b[38;5;209m',
  teal: '\x1b[38;5;37m',
};

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function createLogger({ quiet = false } = {}) {
  return {
    quiet,
    info(message, meta = null) {
      if (quiet) return;
      const ts = `${ANSI.darkGray}${timestamp()}${ANSI.reset}`;
      const prefix = `${ANSI.teal}▸${ANSI.reset}`;
      const text = meta
        ? `${message} ${ANSI.slate}${JSON.stringify(redactSecrets(meta))}${ANSI.reset}`
        : message;
      console.log(`${ts} ${prefix} ${text}`);
    },
    success(message, meta = null) {
      if (quiet) return;
      const ts = `${ANSI.darkGray}${timestamp()}${ANSI.reset}`;
      const prefix = `${ANSI.brightGreen}✔${ANSI.reset}`;
      const text = meta
        ? `${message} ${ANSI.slate}${JSON.stringify(redactSecrets(meta))}${ANSI.reset}`
        : message;
      console.log(`${ts} ${prefix} ${text}`);
    },
    warn(message, meta = null) {
      if (quiet) return;
      const ts = `${ANSI.darkGray}${timestamp()}${ANSI.reset}`;
      const prefix = `${ANSI.brightYellow}⚠${ANSI.reset}`;
      const text = meta
        ? `${message} ${ANSI.slate}${JSON.stringify(redactSecrets(meta))}${ANSI.reset}`
        : message;
      console.log(`${ts} ${prefix} ${text}`);
    },
    error(message, meta = null) {
      const ts = `${ANSI.darkGray}${timestamp()}${ANSI.reset}`;
      const prefix = `${ANSI.red}✖${ANSI.reset}`;
      const text = meta
        ? `${ANSI.coral}${message}${ANSI.reset} ${ANSI.slate}${JSON.stringify(redactSecrets(meta))}${ANSI.reset}`
        : `${ANSI.coral}${message}${ANSI.reset}`;
      console.error(`${ts} ${prefix} ${text}`);
    },
    step(label, message) {
      if (quiet) return;
      const ts = `${ANSI.darkGray}${timestamp()}${ANSI.reset}`;
      const prefix = `${ANSI.brightCyan}◆${ANSI.reset}`;
      const labelText = `${ANSI.bold}${label}${ANSI.reset}`;
      console.log(`${ts} ${prefix} ${labelText} ${ANSI.warmGray}${message}${ANSI.reset}`);
    },
  };
}

module.exports = { createLogger };
