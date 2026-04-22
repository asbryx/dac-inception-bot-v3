// Legacy shim — re-exports from the modern core/bot module.
// All logic has been migrated to src/core/bot.js and src/orchestration/*.
// This file exists only for backward-compatibility with any external consumers.

const {
  DACBot,
  waitForTxReceipt,
  buildLegacyTransferRequest,
} = require('../core/bot');

module.exports = {
  DACBot,
  waitForTxReceipt,
  buildLegacyTransferRequest,
};
