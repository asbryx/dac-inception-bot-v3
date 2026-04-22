const { sanitizePositiveNumber } = require('../utils/validation');

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    command: 'run',
    account: null,
    privateKey: null,
    cookies: null,
    csrf: null,
    interval: 360,
    txCount: 3,
    txAmount: '0.0001',
    burnAmount: null,
    stakeAmount: null,
    profile: 'balanced',
    rankKey: null,
    durationHours: 24,
    quiet: false,
    json: false,
    fast: false,
  };

  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--account') parsed.account = args[++i];
    else if (arg === '--private-key') parsed.privateKey = args[++i];
    else if (arg === '--cookies') parsed.cookies = args[++i];
    else if (arg === '--csrf') parsed.csrf = args[++i];
    else if (arg === '--interval') parsed.interval = Number(args[++i]);
    else if (arg === '--tx-count') parsed.txCount = Number(args[++i]);
    else if (arg === '--tx-amount') parsed.txAmount = args[++i];
    else if (arg === '--burn') parsed.burnAmount = args[++i];
    else if (arg === '--stake') parsed.stakeAmount = args[++i];
    else if (arg === '--profile') parsed.profile = args[++i];
    else if (arg === '--rank-key') parsed.rankKey = args[++i];
    else if (arg === '--duration-hours') parsed.durationHours = Number(args[++i]);
    else if (arg === '--quiet') parsed.quiet = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--fast') parsed.fast = true;
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length) parsed.command = positional[0];
  parsed.interval = sanitizePositiveNumber(parsed.interval, 360, { minimum: 1, maximum: 1440, integer: true });
  parsed.txCount = sanitizePositiveNumber(parsed.txCount, 3, { minimum: 1, maximum: 100, integer: true });
  parsed.durationHours = sanitizePositiveNumber(parsed.durationHours, 24, { minimum: 1, maximum: 168, integer: false });
  return parsed;
}

module.exports = { parseArgs };
