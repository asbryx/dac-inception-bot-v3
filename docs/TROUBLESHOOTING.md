# Troubleshooting

## Timeouts

Read endpoints fail with explicit messages such as `Timeout: GET /profile/ after 12000ms`. If a warm cache entry exists, the status layer marks the result as stale and continues.

If a chain action already produced a tx hash, treat the timeout as an unknown/pending transaction first. Check the explorer link before retrying so you do not accidentally duplicate the action.

## Network resets

`ECONNRESET` and `socket hang up` mean the RPC/API server, gateway, proxy, or network route closed the connection while the bot was waiting for a response. These errors are usually transport failures, not account logic failures.

Recommended handling:

- retry safe reads such as status, balance, block number, and receipt checks
- rotate or replace the proxy if only one account/proxy pair keeps failing
- do not blindly resend a transaction when the report already contains a tx hash
- wait and re-check pending txs if DAC RPC is slow or returning gateway errors

## Auth refresh failures

- verify `privateKey` is correct
- verify `csrf` and `cookies` if using manual session import
- run `setup` again if the account file contains old session data

## Summary looks incomplete

Unknown values render as `?` by design. This means the data is missing or the endpoint timed out, not that the bot guessed a fake default.

## Peer-account signing

`receive` and `tx-mesh` can use other configured accounts. Treat this config as highly sensitive. Keep `DAC_ALLOW_PEER_SIGNING=0` unless you intentionally want that behavior.
