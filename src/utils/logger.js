const { redactSecrets } = require('../config/secrets');

function createLogger({ quiet = false } = {}) {
  return {
    quiet,
    info(message, meta = null) {
      if (quiet) return;
      const text = meta ? `${message} ${JSON.stringify(redactSecrets(meta))}` : message;
      console.log(text);
    },
    error(message, meta = null) {
      const text = meta ? `${message} ${JSON.stringify(redactSecrets(meta))}` : message;
      console.error(text);
    },
  };
}

module.exports = { createLogger };
