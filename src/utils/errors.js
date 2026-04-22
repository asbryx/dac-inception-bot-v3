class BotError extends Error {
  constructor({ accountName = null, action, endpoint = null, message, cause = null }) {
    super(message);
    this.name = 'BotError';
    this.accountName = accountName;
    this.action = action;
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

function toBotError(error, { accountName = null, action = 'operation', endpoint = null } = {}) {
  if (error instanceof BotError) return error;
  return new BotError({
    accountName,
    action,
    endpoint,
    message: error?.message || String(error),
    cause: error,
  });
}

function formatBotError(error, fallbackAction = 'operation') {
  if (error instanceof BotError) {
    return [error.accountName, error.action || fallbackAction, error.endpoint, error.message].filter(Boolean).join(' | ');
  }
  return error?.message || String(error);
}

module.exports = { BotError, toBotError, formatBotError };
