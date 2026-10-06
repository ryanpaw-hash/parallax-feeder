# parallax-feeder

Pushes DexScreener pool data to the PARALLAX worker every 10 minutes (GitHub Actions).
The worker cannot fetch DexScreener itself: both DexScreener and GeckoTerminal answer 429 to
Cloudflare Workers' shared egress IPs. If this stops, the worker falls back to fetching on its own
after 30 minutes of silence (slower and less reliable).

Setup: add one repository secret, `FEED_SECRET`, with the same value as the worker's
`wrangler secret put FEED_SECRET`. Nothing else is stored here.
