# Keepalive worker

Cron-triggered Cloudflare Worker that pings the Render API's `/health` every 5
minutes so the free web service never sleeps (and the Atlas M0 cluster never
auto-pauses). No custom domain or public route needed: a cron Worker runs on
its schedule alone.

## Deploy

```
cd deploy/keepalive
wrangler deploy
```

Uses your existing Cloudflare login (`wrangler login` once if needed). After
the Render API is live, set its URL:

- edit `API_URL` in `wrangler.toml`, or
- keep secrets out of git: `wrangler secret put API_URL` and drop the `[vars]` block.

Check it fired under the Worker's **Logs** / **Cron Triggers** tab in the
Cloudflare dashboard.
