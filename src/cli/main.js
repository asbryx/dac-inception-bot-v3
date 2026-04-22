#!/usr/bin/env node

const { parseArgs } = require('./args');
const { runCommand } = require('./commands');
const { formatBotError } = require('../utils/errors');

async function main() {
  const args = parseArgs(process.argv);
  await runCommand(args);
}

main().catch((error) => {
  console.error(formatBotError(error));
  process.exit(1);
});
