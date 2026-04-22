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
| **Multi-account first** | Built from the ground up for fleet management with per-account proxy rotation |
| **Resilient orchestration** | Multi-account runs continue through individual failures and report a summary at the end |
| **Interactive TUI** | Visual launcher with themed panels, menus, and status dashboards |
| **Strategy profiles** | Choose `safe`, `balanced`, or `aggressive` automation profiles |

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/asbryx/dac-inception-bot-v3.git
cd dac-inception-bot-v3

# Install dependencies
npm install

# Create your config
cp dac.config.example.json dac.config.json

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

### Automation & Orchestration
- **Single-account automation** — run tasks for one wallet with `run`
- **Multi-account orchestration** — run all configured wallets sequentially with `run-all`
- **Campaign & loop modes** — schedule repeating runs at configurable intervals
- **Strategy mode** — `safe` / `balanced` / `aggressive` profiles that decide which actions to take

### Chain Actions
- **TX grind** — generate transaction volume on the testnet
- **Child wallets** — create helper wallets for transfer flows
- **Receive quest & TX mesh** — coordinate inbound transfers and mesh transaction patterns
- **Burn & Stake DACC** — execute burn and staking operations
- **NFT minting** — scan for eligible ranks and batch-mint across accounts

### Session Management
- **Wallet-auth login** — refresh sessions via wallet signature
- **Cookie/CSRF support** — direct session injection for accounts
- **Fleet-wide refresh** — `wallet-login-all` to refresh every account before a run

### Monitoring & Reporting
- **Account status** — detailed single-account status with optional JSON output
- **Fleet summary** — compact multi-account dashboard via `status-all`
- **Tracking snapshots** — record and compare account state over time
- **Faucet loop** — automated faucet claims with configurable duration and interval

### Proxy Support
- **Rotating proxy pool** — assign proxies round-robin across accounts
- **Per-account overrides** — pin specific accounts to fixed proxies
- **Health-check failover** — auto-detect dead proxies and failover to healthy ones
- **Cooldown management** — failed proxies are temporarily excluded

---

## Commands

### Core Commands

| Command | Description |
|---|---|
| `npm start` | Open the interactive TUI launcher |
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
| `clear-safety --account <name>` | Clear safety/lock state |
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
| `--quiet` | Reduce output noise |
| `--json` | Machine-readable JSON output |
| `--fast` | Faster execution where supported |

---

## Configuration

The bot reads its config from `dac.config.json` in the project root. Copy the example to get started:

```bash
cp dac.config.example.json dac.config.json
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
| `addons.proxies` | No | Shared rotating proxy pool config |

### Proxy Rotation

Enable proxy rotation for multi-account runs by adding an `addons.proxies` block:

```json
{
  "addons": {
    "proxies": {
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
  }
}
```

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
│   ├── api/             # HTTP client, endpoints, cache, retry logic
│   ├── auth/            # Session management and wallet-auth
│   ├── chain/           # Provider, wallet, exchange, NFT, transfers
│   ├── cli/             # Command entrypoints, args, prompts
│   ├── config/          # Config paths, account helpers, secret handling
│   ├── domain/          # Status, summary, strategy, minting, tasks
│   ├── orchestration/   # Multi-account runs, campaigns, tracking
│   ├── tui/             # Terminal UI: renderer, panels, menus, themes
│   ├── utils/           # Shared utilities
│   ├── legacy/          # Compatibility runtime for unmigrated flows
│   └── index.js         # Package entry
├── tests/               # Test suite
├── docs/                # Extended documentation
├── dac.config.example.json
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
- Cache invalidation logic
- Session merge behavior
- Status normalization
- Summary rendering and formatting
- TUI renderer wrapping
- Mint scan edge cases
- Strategy no-double-run safety
- Orchestration continuation after account failure
- Secret file permission enforcement

---

## Security

> **Never commit `dac.config.json` to version control.**

- `.gitignore` already excludes `dac.config.json` and `.env`
- Use **testnet wallets only** — never use wallets holding real assets
- Treat private keys, cookies, and CSRF tokens as secrets
- Example config files contain only placeholders
- The bot enforces file permissions on secret storage

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Auth failures | Run `wallet-login --account <name>` to refresh the session |
| Values show `?` | The bot honestly reports unknown/missing data — refresh or re-authenticate |
| One account fails during `run-all` | Expected — the bot continues and reports failures in the summary |
| TUI doesn't render properly | Ensure you're using a real interactive terminal (TTY required) |

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
