# Discord Goals Bot

This bot runs two jobs, on their own schedules:

- **Post** (default: Sunday 12:00 AM Central) — posts a new message in every
  text channel under the **Personal Goals** category with the new week's
  date range (e.g. `9/13-9/19`), and starts tracking that message.
- **Score** (default: Saturday 11:58 PM Central, i.e. just before Post) —
  scores whatever message is currently tracked in each goal channel, based
  on reactions, and posts a results table to `#bot`:
  - `:1sunday:` `:2monday:` `:3tuesday:` `:4wednesday:` `:5thursday:`
    `:6friday:` `:7saturday:` = 1 point each
  - `:Biggoal:` = 5 points

Score always needs to run before Post, since Post overwrites the tracked
message that Score reads. The default times keep a safety gap; if you
change the schedules, keep Score before Post.

State (which message to score next, per channel) is kept in
`data/state.json`, created automatically on first run.

## Setup

### 1. Create the bot application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click "Add Bot".
3. Under **Privileged Gateway Intents**, enable **Message Content Intent**
   (needed for the `!goals ...` manual-test commands).
4. Copy the bot token (Bot → Reset Token) — you'll need it below.

### 2. Invite the bot to a server

Under **OAuth2 → URL Generator**:

- Scopes: `bot`
- Bot permissions: `View Channels`, `Send Messages`, `Read Message History`

Open the generated URL and add the bot to the server. **Use a throwaway
test server first** (see below) before adding it to your real one.

### 3. Create the emojis

Custom emojis are per-server, so whichever server you invite the bot to
needs its own copies. In that server's emoji settings, add custom emojis
named exactly (case matters for `Biggoal`):

```
1sunday 2monday 3tuesday 4wednesday 5thursday 6friday 7saturday Biggoal
```

### 4. Create the channels

- A category named `Personal Goals` (configurable) with at least one text
  channel under it — that's what gets a weekly dated post.
- A text channel named `bot` (configurable, can be anywhere) — that's
  where the weekly results table gets posted.

### 5. Configure

```bash
cp .env.example .env
```

Fill in `.env`:

- `DISCORD_TOKEN` — the bot token from step 1
- `GUILD_ID` — the server's ID (enable Developer Mode in Discord settings,
  then right-click the server icon → Copy Server ID)
- `CATEGORY_NAME` — defaults to `Personal Goals`
- `RESULTS_CHANNEL_NAME` — defaults to `bot`
- `TIMEZONE` — defaults to `America/Chicago`
- `SCORE_CRON` / `POST_CRON` — only needed if you want the bot to
  auto-fire at specific times (see testing options below); otherwise leave
  the defaults

### 6. Install and run

```bash
npm install
npm start
```

Keep it running (e.g. with `pm2`, a systemd service, or a small always-on
box/VPS) so the schedules actually fire.

## Testing in a throwaway server first

1. Create a new Discord server just for testing (Discord → `+` → Create My
   Own → For me and my friends). It's free and instant.
2. Do steps 1–5 above against that server (its own bot token isn't
   needed — same bot application and token work in any server it's
   invited to; you can also just reuse the same bot and swap `GUILD_ID` in
   `.env` when you're ready to point it at the real server).
3. Set up a `Personal Goals` category with one or two test channels, the
   emojis, and a `#bot` channel, same as above.
4. Run the bot (`npm start`) and use the manual commands below to try the
   whole flow in a couple of minutes instead of waiting for Sunday.
5. Once it behaves the way you want, invite it to the real server, update
   `GUILD_ID` (and re-create the emojis there if they don't already exist),
   and restart.

### Manual test commands (works in either server)

As a server admin, type these in any channel the bot can see:

- `!goals post` — posts this week's dated message to every goal channel
  right now, and starts tracking it.
- `!goals score` — scores whatever message is currently tracked in each
  goal channel right now, and posts the results table to `#bot`.
- `!goals run` — runs score, then post (what the full weekly schedule
  does), back to back.

A realistic test: `!goals post`, react to the new message in a test
channel with a few of the tracked emojis, then `!goals score` to see the
results table pick up your reactions.

### Testing via the schedule instead

If you'd rather see the actual cron firing rather than triggering it by
hand, set `SCORE_CRON` / `POST_CRON` in `.env` to a couple of minutes from
now (cron format is `minute hour day month weekday`, evaluated in
`TIMEZONE`), then `npm start` and wait. For example, if it's currently
2:03 PM Central:

```
SCORE_CRON=5 14 * * *
POST_CRON=7 14 * * *
```

Remember to set both back to their weekly defaults (or remove them from
`.env` to fall back to the defaults) before running it for real.

## Notes

- The very first run has nothing to score yet (no prior message is
  tracked), so `!goals score` / the score schedule will report 0 for every
  channel until a post has happened at least once.
- Only reactions from the tracked emoji names count; any other emoji on
  the post is ignored.
- The results table always has exactly one row per goal channel. If no one
  reacted (or there was no previous post to score), that channel shows 0.
- `!goals score` is safe to run more than once — it just re-scores
  whatever message is currently tracked, it doesn't advance anything.
