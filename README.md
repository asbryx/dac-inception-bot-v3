<p align="center">
  <h1 align="center">DAC Inception Bot v3</h1>
  <p align="center">
    <strong>A modular CLI & TUI automation bot for the DAC Inception testnet</strong>
  </p>
  <p align="center">
    <a href="#-quick-start">Quick Start</a> &nbsp;&bull;&nbsp;
    <a href="#-features">Features</a> &nbsp;&bull;&nbsp;
    <a href="#-commands">Commands</a> &nbsp;&bull;&nbsp;
    <a href="#-configuration">Configuration</a> &nbsp;&bull;&nbsp;
    <a href="#-docs">Docs</a>
  </p>
</p>

---

## About

DAC Inception Bot v3 is a ground-up rebuild of the original DAC bot, designed for **clean architecture**, **multi-account orchestration**, and a **compact terminal interface**. Whether you're managing a single testnet wallet or running an entire fleet, the bot provides a streamlined workflow through both direct CLI commands and an interactive TUI launcher.

### Why v3?

| Improvement | Details |
|---|---|
| **Modular codebase** | Split into focused modules (`api`, `auth`, `chain`, `domain`, `tui`, etc.) instead of one monolithic script |
| **Fully independent** | No external legacy dependencies — all logic is self-contained in the repo |
| **Multi-account first** | Built from the ground up for fleet management with per-account proxy rotation |
| **Resilient orchestration** | Multi-account runs continue through individual failures and report a summary at the end |
| **Interactive TUI** | Visual launcher with themed panels, **toggle menus**, **live dashboards**, and **step tracking** |
| **Strategy profiles** | Choose `safe`, `balanced`, or `aggressive` automation profiles |
| **Fast mode** | Strip all human-like delays with `--fast` for maximum throughput |
| **Concurrent workers** | Run up to 10 accounts in parallel with `--concurrency` |

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/asbryx/dac-inception-bot-v3.git
cd dac-inception-bot-v3

# Install dependencies
npm install

# Create your configs
cp dac.config.example.json dac.config.json
cp proxies.config.example.json proxies.config.json   # optional

# Launch the interactive menu
npm start
```

### Requirements

- **Node.js** >= 20
- **npm**
- One or more **DAC testnet wallets**
- *(Optional)* DAC Inception session cookies for immediate authenticated access

---

## Features

### Interactive TUI Launcher (`npm start`)

The main launcher is a fully interactive terminal UI. No more memorizing commands.

**Main Menu — Arrow-key navigation**
- Choose between single-account, multi-account, or utility modes
- Select any command with ↑↓ arrows and Enter

**Automation Toggle Menu — 10 granular controls**
Before running automation, you get a toggle panel where you choose exactly what to execute:

| # | Feature | Default |
|---|---|---|
| 1 | Daily Tasks | ✓ ON |
| 2 | Badges | ✓ ON |
| 3 | Faucet Claim | ✓ ON |
| 4 | Strategy Mode | ✓ ON |
| 5 | TX Grind | ✗ OFF |
| 6 | Child Wallets | ✗ OFF |
| 7 | Receive Quest | ✗ OFF |
| 8 | TX Mesh | ✗ OFF |
| 9 | Burn & Stake | ✗ OFF |
| 10 | Mint Scan | ✗ OFF |

**Controls:** `Space` to toggle, `Enter` to confirm, `a` to enable all, `n` to disable all.

**Live Progress Dashboard**
During multi-account runs, a real-time dashboard shows:
- Per-account status: `✓` done / `✗` failed / `▶` running / `○` queued
- Current step per account (e.g., `faucet`, `tasks`, `mintScan`)
- Assigned proxy label and health indicator
- Fleet progress: `Completed: 8/10 | Failed: 1 | Running: 1`

The TUI throttles renders to ~300ms to keep CPU usage low even under heavy concurrency.

### Automation & Orchestration
- **Single-account automation** — run tasks for one wallet with `run`
- **Multi-account orchestration** — run all configured wallets concurrently with `run-all` (up to 10 parallel)
- **Campaign & loop modes** — schedule repeating runs at configurable intervals
- **Strategy mode** — `safe` / `balanced` / `aggressive` profiles that decide which actions to take
- **Feature toggles** — interactive toggle menu for granular control per run
- **Fast mode** — strip all human-like delays, retry backoffs, and tx polling sleeps with `--fast`
- **Concurrency control** — tune parallel workers with `--concurrency <1-10>`

### Chain Actions
- **TX grind** — generate transaction volume on the testnet
- **Child wallets** — create helper wallets for transfer flows
- **Receive quest & TX mesh** — coordinate inbound transfers and mesh transaction patterns
- **Burn & Stake DACC** — execute burn and staking operations
- **NFT minting** — scan for eligible ranks and batch-mint across accounts
- **Mint scan with retry** — resilient rank scanning with configurable retries

### Session Management
- **Wallet-auth login** — refresh sessions via wallet signature (no SIWE needed)
- **Cookie/CSRF support** — direct session injection for accounts
- **Fleet-wide refresh** — `wallet-login-all` to refresh every account before a run

### Monitoring & Reporting
- **Account status** — detailed single-account status with optional JSON output
- **Fleet summary** — compact multi-account dashboard via `status-all`
- **Live progress dashboard** — real-time account status icons during multi-account runs
- **Proxy status per account** — live TUI shows assigned proxy label and health next to each account row
- **Tracking snapshots** — record and compare account state over time
- **Faucet loop** — automated faucet claims with configurable duration and interval
- **Step tracking** — visual progress bars and step-by-step execution reports

### Proxy Support
- **Dedicated proxy file** — `proxies.config.json` lives outside `dac.config.json` so auth flows never overwrite it
- **Rotating proxy pool** — assign proxies round-robin across accounts
- **Per-account overrides** — pin specific accounts to fixed proxies via `dac.config.json`
- **Health-check failover** — auto-detect dead proxies and failover to healthy ones

---

## Commands

### Core Commands

| Command | Description |
|---|---|
| `npm start` | Open the interactive TUI launcher with toggle menus |
| `run --account <name>` | Run automation for a single account |
| `run-all` | Run automation for all configured accounts |
| `status --account <name>` | Show account status (add `--json` for JSON) |
| `status-all` | Fleet-wide summary dashboard |
| `wallet-login --account <name>` | Refresh session for one account |
| `wallet-login-all` | Refresh sessions for all accounts |

### Strategy & Loops

| Command | Description |
|---|---|
| `strategy --account <name> --profile <profile>` | Run strategy mode (`safe` / `balanced` / `aggressive`) |
| `campaign --account <name> --interval <min>` | Repeat automation on an interval |
| `campaign-all --interval <min>` | Campaign mode for all accounts |
| `loop --account <name> --interval <min>` | Loop mode for one account |
| `faucet-loop --account <name> --duration-hours <h> --interval <min>` | Automated faucet claims |
| `faucet-loop-all --duration-hours <h> --interval <min>` | Faucet loop for all accounts |

### Chain Actions

| Command | Description |
|---|---|
| `tx-grind --account <name> --tx-count <n> --tx-amount <amt>` | Generate transactions |
| `child-wallets --account <name> --tx-count <n>` | Create child wallets |
| `receive --account <name> --tx-count <n> --tx-amount <amt>` | Receive quest flow |
| `receive-all --tx-count <n> --tx-amount <amt>` | Receive quest for all accounts |
| `tx-mesh --account <name> --tx-count <n> --tx-amount <amt>` | TX mesh flow |
| `tx-mesh-all --tx-count <n> --tx-amount <amt>` | TX mesh for all accounts |
| `burn --account <name> --burn <amt>` | Burn DACC tokens |
| `stake --account <name> --stake <amt>` | Stake DACC tokens |

### Minting

| Command | Description |
|---|---|
| `mint-scan --account <name>` | Scan for mintable NFT ranks |
| `mint-rank --account <name> --rank-key <key>` | Mint a specific rank |
| `mint-all-ranks --account <name>` | Mint all eligible ranks |
| `mint-all-ranks-all` | Mint all eligible ranks for all accounts |

### Tracking & Utility

| Command | Description |
|---|---|
| `track --account <name>` | Track account state |
| `track-all` | Track all accounts |
| `human-status --account <name> --json` | Human-readable status output |
| `manual` | Open the manual command menu |
| `setup --account <name> --private-key <key>` | Create/update account config from CLI |

> **Tip:** All commands are run via `node src/cli/main.js <command>` or through the interactive launcher (`npm start`).

### CLI Flags

| Flag | Description |
|---|---|
| `--account <name>` | Select account |
| `--private-key <hex>` | Wallet private key |
| `--cookies <string>` | Session cookie string |
| `--csrf <token>` | CSRF token |
| `--interval <minutes>` | Loop/campaign interval |
| `--tx-count <n>` | Transaction count |
| `--tx-amount <n>` | Amount per transaction |
| `--burn <n>` | Burn amount |
| `--stake <n>` | Stake amount |
| `--profile <name>` | Strategy profile |
| `--rank-key <key>` | NFT rank target |
| `--duration-hours <n>` | Faucet loop duration |
| `--concurrency <n>` | Parallel workers for multi-account runs (1–10) |
| `--quiet` | Reduce output noise |
| `--json` | Machine-readable JSON output |
| `--fast` | Strip human delays for maximum speed |

---

## Configuration

The bot reads account data from `dac.config.json` and proxy settings from `proxies.config.json`. Keeping them separate prevents auth flows from accidentally wiping your proxy list.

```bash
cp dac.config.example.json dac.config.json
cp proxies.config.example.json proxies.config.json   # if using proxies
```

### Basic Multi-Account Setup

```json
{
  "default": "main01",
  "accounts": {
    "main01": {
      "privateKey": "0xYOUR_PRIVATE_KEY_01"
    },
    "main02": {
      "privateKey": "0xYOUR_PRIVATE_KEY_02"
    },
    "main03": {
      "privateKey": "0xYOUR_PRIVATE_KEY_03"
    }
  }
}
```

### Full Account Entry

```json
{
  "default": "main01",
  "accounts": {
    "main01": {
      "privateKey": "0xYOUR_PRIVATE_KEY",
      "wallet": "0xYOUR_WALLET_ADDRESS",
      "cookies": "ref_code=...; csrftoken=...; sessionid=...",
      "csrf": "YOUR_CSRF_TOKEN",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  }
}
```

### Config Fields

| Field | Required | Description |
|---|---|---|
| `default` | Yes | Default account name used when `--account` is omitted |
| `accounts` | Yes | Named map of account configurations |
| `accounts.<name>.privateKey` | Yes | Wallet private key for chain actions and auth |
| `accounts.<name>.wallet` | No | Wallet address (auto-derived if omitted) |
| `accounts.<name>.cookies` | No | DAC session cookie string |
| `accounts.<name>.csrf` | No | CSRF token |
| `accounts.<name>.proxy` | No | Fixed proxy override for this account |

### Proxy Configuration (`proxies.config.json`)

**Recommended:** Keep proxies in their own file so wallet-auth flows never touch them.

```json
{
  "enabled": true,
  "list": [
    "http://user:pass@proxy-01.example:8000",
    "http://user:pass@proxy-02.example:8000",
    "http://user:pass@proxy-03.example:8000"
  ],
  "failover": {
    "enabled": true,
    "healthCheckPath": "/api/inception/network/",
    "healthCheckTimeoutMs": 8000,
    "cooldownMs": 300000,
    "maxAttemptsPerRequest": 3
  }
}
```

**Fallback:** If `proxies.config.json` doesn't exist, the bot falls back to `addons.proxies` inside `dac.config.json`.

**How proxy rotation works:**

1. Proxies are assigned to accounts round-robin at the start of a multi-account run
2. When the bot switches accounts, it switches to that account's assigned proxy
3. If `accounts.<name>.proxy` is set, that account always uses its own proxy
4. Failed proxies are health-checked and placed on cooldown before being retried

---

## Project Structure

```
dac-inception-bot-v3/
├── src/
│   ├── addons/          # Proxy rotation and add-on modules
│   ├── api/             # HTTP client, endpoints, retry logic
│   ├── auth/            # Session management and wallet-auth
│   ├── chain/           # Provider, wallet
│   ├── cli/             # Command entrypoints, args, prompts
│   ├── config/          # Config paths, account helpers, secret handling
│   ├── domain/          # Status, summary, features
│   ├── orchestration/   # Multi-account runs, campaigns, tracking
│   ├── tui/             # Terminal UI: renderer, panels, menus, themes, tracker
│   ├── utils/           # Shared utilities
│   └── index.js         # Package entry
├── tests/               # Test suite
├── docs/                # Extended documentation
├── dac.config.example.json
├── proxies.config.example.json
└── package.json
```

---

## Recommended Workflows

### Single Account — Quick Check

```bash
node src/cli/main.js status --account main01
node src/cli/main.js wallet-login --account main01
node src/cli/main.js run --account main01
```

### Fleet — Status Dashboard

```bash
node src/cli/main.js status-all
```

### Fleet — Full Refresh & Run

```bash
node src/cli/main.js wallet-login-all
node src/cli/main.js run-all
```

### Fleet — Fast Concurrent Run

```bash
# Run all accounts with max speed and 5 parallel workers
node src/cli/main.js run-all --fast --concurrency 5
```

### Minting Workflow

```bash
node src/cli/main.js mint-scan --account main01
node src/cli/main.js mint-all-ranks --account main01
# Or mint across all accounts:
node src/cli/main.js mint-all-ranks-all
```

### Long-Running Campaign

```bash
# Run all accounts every 6 hours
node src/cli/main.js campaign-all --interval 360

# Faucet claims every 45 min for 12 hours
node src/cli/main.js faucet-loop-all --duration-hours 12 --interval 45
```

---

## Testing

```bash
npm test
```

The test suite covers:

- Endpoint timeout fallback behavior
- Argument validation and parsing
- Session merge behavior
- Status normalization
- Summary rendering and formatting
- TUI renderer wrapping
- Mint scan edge cases
- Strategy no-double-run safety
- Orchestration continuation after account failure
- Secret file permission enforcement
- Fast mode feature toggle
- Concurrency clamping and validation
- Proxy health-check rotation logic

---

## Security

> **Never commit config files containing secrets.**

- `.gitignore` excludes `dac.config.json`, `proxies.config.json`, `session-*.json`, and `.env`
- Use **testnet wallets only** — never use wallets holding real assets
- Treat private keys, cookies, CSRF tokens, and proxy credentials as secrets
- Example config files contain only placeholders
- The bot enforces file permissions on secret storage
- Proxy credentials live in `proxies.config.json`, isolated from auth-driven config updates

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Auth failures | Run `wallet-login --account <name>` to refresh the session |
| Values show `?` | The bot honestly reports unknown/missing data — refresh or re-authenticate |
| One account fails during `run-all` | Expected — the bot continues and reports failures in the summary |
| TUI doesn't render properly | Ensure you're using a real interactive terminal (TTY required) |
| Slow execution | Use `--fast` flag to strip all human delays |
| Too many accounts | Use `--concurrency` to control parallel workers (default: 1, max: 10) |
| Proxies disappearing after auth | Move them to `proxies.config.json` instead of `dac.config.json` |
| Config parse errors on Windows | Save files as UTF-8 without BOM (the bot strips BOMs, but clean files are safer) |

For more details, see [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

---

## Docs

| Document | Description |
|---|---|
| [`docs/COMMANDS.md`](docs/COMMANDS.md) | Full command reference |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Codebase architecture and design |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Common issues and fixes |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Test verification details |

---

## License

This project is private and not licensed for redistribution.
