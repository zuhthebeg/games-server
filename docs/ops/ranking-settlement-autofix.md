# relay.cocy.io ranking settlement autofix note

## Finding
Daily ranking settlement is not automatic right now. `rank_configs.next_reset_at` becomes overdue and heartbeat has to call:

```bash
curl -s https://relay.cocy.io/api/admin/rankings/settle -X POST -H "X-Admin-Secret: cocy-admin-2026"
```

## Current implementation
- Hosting: Cloudflare Pages project `games-relay`
- Manual endpoint: `functions/api/admin/rankings/settle.ts`
- Settlement logic: `functions/api/rankings/_rank_utils.ts::settleIfDue`
- `wrangler.toml` currently has D1/R2 bindings but no scheduled/cron trigger config.
- No `scheduled` handler was found in `functions/`.

## Likely fix
Add a real scheduled execution path that invokes `settleIfDue(DB)` daily after KST midnight (UTC 15:00), then deploy and verify with production D1.

Possible approaches:
1. Cloudflare Worker cron trigger dedicated to rankings settlement, bound to the same D1 DB.
2. If staying inside Pages, confirm current Cloudflare Pages scheduled-functions support and add the supported scheduled entrypoint/config.
3. Short-term fallback: external cron hitting the existing admin endpoint, but this keeps the admin secret in another scheduler and is less clean.

## Verification after fix
1. Force one test config overdue in production D1 or wait for next due time.
2. Confirm scheduled run creates `rank_reward_log` rows.
3. Confirm `rank_configs.last_reset_at` updates and `next_reset_at` advances to next UTC 15:00.
4. Confirm heartbeat no longer sees `overdue=hunt,pvp,weapon` after due time.
