# Command Reference

## Core

- `setup` save or update an account
- `status` fetch one normalized status snapshot
- `status-all` fetch normalized status for all accounts with bounded concurrency
- `run` run a single-account automation flow
- `run-all` run multi-account automation sequentially by default
- `menu` open the launcher
- `manual` open the manual action menu
- `strategy` generate and execute strategy actions for one account

## Chain / Minting

- `tx-grind`
- `receive`
- `tx-mesh`
- `burn --burn <amount>`
- `stake --stake <amount>`
- `mint-scan`
- `mint-rank --rank-key <rank_key>`
- `mint-all`

## Tracking

- `track`
- `campaign`
- `clear-safety`

## Common Options

- `--account <name>`
- `--interval <minutes>`
- `--tx-count <count>`
- `--tx-amount <amount>`
- `--profile <safe|balanced|aggressive>`
- `--quiet`
- `--json`
- `--fast`

## Faucet Automation

- `faucet-loop --duration-hours 24 --interval 60` run faucet claims on one account for a timed window
- `faucet-loop-all --duration-hours 24 --interval 60` run faucet claims across all configured accounts
