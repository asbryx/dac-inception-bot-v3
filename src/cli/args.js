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
    else if (arg === '--accounts') parsed.accounts = (args[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
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
    else if (arg === '--strategy') parsed.strategyFlag = true;
    else if (arg === '--no-human') parsed.humanMode = false;
    else if (arg === '--help' || arg === '-h') parsed.command = 'help';
    else if (!arg.startsWith('--')) positional.push(arg);
  }

  if (positional.length) parsed.command = positional[0];
  parsed.interval = sanitizePositiveNumber(parsed.interval, 360, { minimum: 1, maximum: 1440, integer: true });
  parsed.txCount = sanitizePositiveNumber(parsed.txCount, 3, { minimum: 1, maximum: 100, integer: true });
  parsed.durationHours = sanitizePositiveNumber(parsed.durationHours, 24, { minimum: 1, maximum: 168, integer: false });
  return parsed;
}

function printHelp() {
  console.log(`DAC Inception Bot

Usage:
  node src/cli/main.js <command> [options]

Commands:
  run             Full automation cycle (default)
  run-all         Automation across all accounts
  status          Show account status
  status-all      Status for all accounts
  setup           Save account credentials
  menu            Interactive launcher
  manual          One task at a time
  strategy        Smart strategy mode
  loop            Continuous loop mode
  tx-grind        Send transactions
  receive         Receive quest
  receive-all     Receive across all accounts
  tx-mesh         Send + receive mesh
  tx-mesh-all     Mesh across all accounts
  burn            Burn DACC for QE
  stake           Stake DACC
  mint-scan       Scan mintable ranks
  mint-rank       Mint a specific rank
  mint-all-ranks  Mint all eligible ranks
  mint-all-ranks-all  Mint across all accounts
  track           Snapshot tracking
  track-all       Track across all accounts
  campaign        Campaign cycle
  campaign-all    Campaign across all accounts
  faucet-loop     24h faucet loop
  faucet-loop-all Faucet loop all accounts
  wallet-login    Auth via wallet
  wallet-login-all Auth all accounts
  child-wallets   Generate child wallets
  human-status    Show human mode status
  clear-safety    Reset safety state

Options:
  --account <name>      Named account
  --accounts <a,b>      Comma-separated account list for multi-account commands
  --private-key <key>   Private key
  --cookies <str>       Session cookies
  --csrf <token>        CSRF token
  --interval <min>      Loop interval (minutes)
  --tx-count <n>        Transaction count
  --tx-amount <amt>     Amount per tx
  --burn <amt>          Burn amount
  --stake <amt>         Stake amount
  --profile <name>      Strategy: safe | balanced | aggressive
  --rank-key <key>      Rank key for mint
  --duration-hours <h>  Faucet loop duration
  --quiet               Less output
  --fast                Shorter delays
  --json                JSON output
`);
}

module.exports = { parseArgs, printHelp };
