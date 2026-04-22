# Architecture

## Layers

- `config`: file paths, atomic json writes, account persistence, secret policy
- `auth`: session lifecycle and wallet-auth refresh
- `api`: fetch wrapper, retries, timeout behavior, TTL cache
- `chain`: provider, wallet, exchange, NFT, transfers
- `domain`: normalized status, tasks, badges, faucet, crates, minting, strategy, summary
- `orchestration`: read and mutation flows across one or many accounts
- `tui`: theme, renderer, panels, menus, screens
- `cli`: args, prompts, command dispatch, top-level errors

## Rules

- UI never performs fetches directly
- chain helpers do not write to stdout
- orchestration emits progress events and returns structured results
- status normalization is the single source of truth for dashboard state
