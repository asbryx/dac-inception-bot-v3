# Verification Guide

- run `npm test`
- run `node src/cli/main.js status --json` with a configured account
- run `node src/cli/main.js status-all --json` to verify multi-account summary data
- open `node src/cli/main.js menu` in a TTY and confirm launcher warmup + summary rendering
- run `node src/cli/main.js strategy --profile safe` and verify the strategy plan prints once
- verify `dac.config.json` has `0600` permissions after `setup`
