# Kulku booking bot (Telegram + Cloudflare Workers, free)

`/start` → pick space → pick day (shows free-slot count) → tap a slot → booked.
`/my` → upcoming bookings, tap to cancel (with confirm). Only your chat can use it.

## Setup (~10 min)

1. **Create the bot**: in Telegram, message `@BotFather` → `/newbot` → copy the bot token.
2. **Cloudflare**: make a free account at dash.cloudflare.com, then in this folder:
   ```bash
   npx wrangler login
   npx wrangler deploy            # prints your URL: https://kulku-bot.<you>.workers.dev
   ```
3. **Secrets** (each command prompts for the value):
   ```bash
   npx wrangler secret put BOT_TOKEN        # from BotFather
   npx wrangler secret put KULKU_USER       # userId from the browser
   npx wrangler secret put KULKU_TOKEN      # authToken from the browser
   npx wrangler secret put WEBHOOK_SECRET   # any random string, e.g. output of: openssl rand -hex 16
   npx wrangler secret put ALLOWED_CHAT_ID  # put 0 for now, fixed in step 5
   ```
4. **Connect Telegram to the worker**:
   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://kulku-bot.<you>.workers.dev&secret_token=<WEBHOOK_SECRET>"
   ```
5. **Lock it to you**: send `/start` to your bot. It replies "Not authorised. Your chat id: 12345".
   Run `npx wrangler secret put ALLOWED_CHAT_ID` again with that number. Done — `/start` now works.

Optional: set `SITE = "Jämeräntaival 3"` (your building) in `wrangler.toml` and `npx wrangler deploy` to hide other buildings.

## When the Kulku login expires
The bot will say "Kulku login expired". Log in at time.kulku.io, run in the console:
`JSON.stringify({userId:localStorage.kulkuUser, authToken:localStorage.kulkuToken})`
and update with `npx wrangler secret put KULKU_TOKEN` (and KULKU_USER if it changed).
