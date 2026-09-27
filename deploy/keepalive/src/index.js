// Cloudflare Worker, cron-triggered only (no public route, no custom domain).
// Render sleeps a free web service after 15 min idle and eats a cold start on
// the next request; a 5-min ping means a real visitor never pays that. The
// /health check also does a shallow Mongo ping, so the same beat keeps the
// Atlas M0 cluster from auto-pausing after 30 idle days.
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(fetch(new URL("/health", env.API_URL)).catch(() => {}));
  },
};
