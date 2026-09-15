# Discord Goals Bot

Every Sunday at 12:00 AM Central time, this bot:

1. Scores last week's post in every text channel under the **Personal Goals**
   category, based on reactions:
   - `:1sunday:` `:2monday:` `:3tuesday:` `:4wednesday:` `:5thursday:`
     `:6friday:` `:7saturday:` = 1 point each
   - `:Biggoal:` = 5 points
2. Posts a new message in each of those channels with the new week's date
   range (e.g. `9/13-9/19`).
3. Posts a results table to `#bot` with everyone's totals for the week that
   just ended.

State (which message it needs to score next, per channel) is kept in
`data/state.json`, created automatically on first run.

## Setup

### 1. Create the bot application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click "Add Bot".
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
   (needed for the `!goals run` manual-test command).
4. Copy the bot token (Bot → Reset Token) — you'll need it below.

### 2. Invite the bot to your server

Under **OAuth2 → URL Generator**:

- Scopes: `bot`
- Bot permissions: `View Channels`, `Send Messages`, `Read Message History`

Open the generated URL and add the bot to your server.

### 3. Create the emojis

In your server's emoji settings, add custom emojis named exactly (case
matters for `Biggoal`):

```
1sunday 2monday 3tuesday 4wednesday 5thursday 6friday 7saturday Biggoal
```

### 4. Create a #bot channel

Create a text channel named `bot` (anywhere in the server) for the weekly
results table to be posted to.

### 5. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

- `DISCORD_TOKEN` — the bot token from step 1
- `GUILD_ID` — your server's ID (enable Developer Mode in Discord settings,
  then right-click the server icon → Copy Server ID)
- `CATEGORY_NAME` — defaults to `Personal Goals`
- `RESULTS_CHANNEL_NAME` — defaults to `bot`
- `TIMEZONE` — defaults to `America/Chicago`

### 6. Install and run

```bash
npm install
npm start
```

Keep it running (e.g. with `pm2`, a systemd service, or a small always-on
box/VPS) so the Sunday-midnight cron actually fires.

## Testing without waiting for Sunday

As a server admin, type `!goals run` in any channel the bot can see. It
runs the full job immediately — scores last week's post in each goal
channel, posts a new dated message, and posts the results table to `#bot`.

## Notes

- The very first run has nothing to score yet (no prior message is
  tracked), so it will just post the first dated message in each channel
  and note in `#bot` that there's nothing to report.
- Only reactions from the tracked emoji names count; any other emoji on
  the post is ignored.
- The results table always has exactly one row per goal channel. If no one
  reacted (or there was no previous post to score), that channel shows 0.
