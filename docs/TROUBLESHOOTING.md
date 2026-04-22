# Troubleshooting

## Timeouts

Read endpoints fail with explicit messages such as `Timeout: GET /profile/ after 12000ms`. If a warm cache entry exists, the status layer marks the result as stale and continues.

## Auth refresh failures

- verify `privateKey` is correct
- verify `csrf` and `cookies` if using manual session import
- run `setup` again if the account file contains old session data

## Summary looks incomplete

Unknown values render as `?` by design. This means the data is missing or the endpoint timed out, not that the bot guessed a fake default.

## Peer-account signing

`receive` and `tx-mesh` can use other configured accounts. Treat this config as highly sensitive. Keep `DAC_ALLOW_PEER_SIGNING=0` unless you intentionally want that behavior.
