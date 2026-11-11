# Kulku booking bot (Telegram, free hosting on Cloudflare)

Book laundry/sauna on KulkuTIME from Telegram:
building → room → day → tap a free ✅ slot. `/my` shows and cancels your bookings.
Only you can use your copy; it books with your own Kulku account.

You need: a Telegram account, a free Cloudflare account, Node.js 18+ (`node -v`),
and your KulkuTIME phone number + password.

## Setup (~10 min)

1. **Create a Telegram bot**: message `@BotFather` → `/newbot` → copy the bot token.

2. **Deploy** (in this folder):
   ```bash
   npx wrangler login     # opens browser, sign in / sign up to Cloudflare
   npx wrangler deploy    # prints your URL: https://kulku-bot.<you>.workers.dev
   ```

3. **Add secrets** (each command asks for the value; paste without quotes):
   ```bash
   npx wrangler secret put BOT_TOKEN        # from BotFather
   npx wrangler secret put KULKU_PHONE      # e.g. +358401234567
   npx wrangler secret put KULKU_PASSWORD   # your KulkuTIME password
   npx wrangler secret put WEBHOOK_SECRET   # letters/numbers/_/- only, e.g. kulku_9f3k2x7
   npx wrangler secret put ALLOWED_CHAT_ID  # type 0 for now
   ```

4. **Connect Telegram** — open this in a browser (fill in your values, no < >):
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://kulku-bot.<you>.workers.dev&secret_token=<WEBHOOK_SECRET>
   ```
   You should see `"ok":true`.

5. **Lock it to you**: send `/start` to your bot → it replies "Not authorised. Your chat id: 12345".
   Run `npx wrangler secret put ALLOWED_CHAT_ID` with that number. Send `/start` again — done.

Optional: set `SITE = "Jämeräntaival 1"` (your building) in `wrangler.toml`, then
`npx wrangler deploy`, to skip the building picker.

## Notes
- The bot logs in to Kulku by itself and re-logs in when the session expires.
  Secrets are encrypted in your Cloudflare account; nobody else sees them.
- No Kulku password (SMS-only login)? Instead of KULKU_PHONE/KULKU_PASSWORD, log in at
  time.kulku.io, open DevTools → Console (type `allow pasting` first if needed), run
  `JSON.stringify({userId:localStorage.kulkuUser, authToken:localStorage.kulkuToken})`,
  and set those as `KULKU_USER` and `KULKU_TOKEN`. You'll need to redo this when it expires.
- Not affiliated with Kulku; uses the same API as the web app and may break if they change it.
- Bot not responding? Run `npx wrangler tail` and send a message to see errors.
