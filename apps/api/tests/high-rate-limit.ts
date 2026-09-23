// Integration files that drive the full request flow hit one venue+IP many
// times inside a single 60s window. OTP-required adds an otp/request +
// otp/verify to every confirm (spec section 1), roughly tripling the count
// past the real per-IP limit of 30. Raise the ceiling for THIS process
// only, and do it here so it lands before app.js (hence rate-limit.ts,
// which reads the env once at import time) is evaluated: a test file that
// needs it imports this FIRST, above any app-touching import. Never set in
// production or the pure rate-limit tests, which derive their expectations
// from the constant, so both still enforce 30.
process.env.RATE_LIMIT_MAX_REQUESTS ??= "2000";
