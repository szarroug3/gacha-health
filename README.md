# Discord Goals Bot

Runs as a scheduled [GitHub Actions](https://github.com/features/actions) workflow — no server to host, no
credit card, and it only needs to run for a few seconds once a week. Every
Sunday (around 12:00 AM Central), it:

1. Scores the message currently tracked in every text channel under the
   **Personal Goals** category, based on reactions:
   - `:1sunday:` `:2monday:` `:3tuesday:` `:4wednesday:` `:5thursday:`
     `:6friday:` `:7saturday:` = 1 point each
   - `:Biggoal:` = 5 points
   - `:Weekly:` = 3 points
   - Credits those points to that channel's running total (once per
     message - re-scoring the same message never double-credits it), and
     posts a results table to `#bot` with one row per channel showing
     **Last Week** and **Total** (running balance).
2. Posts a new message in each of those channels with the new week's date
   range (e.g. `9/13-9/19`), and starts tracking it for next week.

State (which message to score next per channel, and each channel's
running point total) lives in [data/state.json](data/state.json), which
the workflow commits back to this repo after each run.

### Managing points directly

Points accumulate in each channel's running total from weekly scoring, but
you can also adjust or check a total by hand from the **Actions** tab →
**Run workflow**, fill in the inputs, and run:

- **Manual - spend points** — deducts points (e.g. someone redeemed a
  reward). Fails instead of going negative if there aren't enough.
- **Manual - add points** — adds points directly, outside the normal
  emoji scoring (e.g. a manual bonus or correction).
- **Manual - check total** — looks up a channel's current running total
  without changing anything.

All three take a channel name (and spend/add also take an amount and an
optional note), and post a confirmation to `#bot`.

## Setup

### 1. Create the bot application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click "Add Bot".
3. Copy the bot token (Bot → Reset Token) — you'll need it below. No
   privileged intents are needed; everything runs over the REST API.

### 2. Invite the bot to a server

Under **OAuth2 → URL Generator**:

- Scopes: `bot`
- Bot permissions: `View Channels`, `Send Messages`, `Read Message History`

Open the generated URL and add the bot to the server. **Use a throwaway
test server first** (see below) before adding it to your real one.

### 3. Create the emojis

Custom emojis are per-server, so whichever server you invite the bot to
needs its own copies. In that server's emoji settings, add custom emojis
named exactly (case matters for `Biggoal` and `Weekly`):

```
1sunday 2monday 3tuesday 4wednesday 5thursday 6friday 7saturday Biggoal Weekly
```

### 4. Create the channels

- A category named `Personal Goals` (configurable) with at least one text
  channel under it — that's what gets a weekly dated post.
- A text channel named `bot` (configurable, can be anywhere) — that's
  where the weekly results table gets posted.

### 5. Add repo secrets/variables

In this repo: **Settings → Secrets and variables → Actions**.

Required, under **Secrets**:

- `DISCORD_TOKEN` — the bot token from step 1
- `GUILD_ID` — the server's ID (enable Developer Mode in Discord settings,
  then right-click the server icon → Copy Server ID)

Optional, under **Variables** (only add if you want non-default values):

- `CATEGORY_NAME` — defaults to `Personal Goals`
- `RESULTS_CHANNEL_NAME` — defaults to `bot`
- `TIMEZONE` — defaults to `America/Chicago`

### 6. Enable the workflow

Nothing else to install or run — as soon as secrets are set, the
`Weekly goals job` workflow (`.github/workflows/weekly.yml`) will fire on
its schedule. See below for testing before it does.

## Testing in a throwaway server first

1. Create a new Discord server just for testing (Discord → `+` → Create My
   Own → For me and my friends). It's free and instant.
2. Do steps 1–4 above against that server.
3. Do step 5 against this same repo (a second bot token isn't needed if
   you want to reuse one bot application across servers — just point
   `GUILD_ID` at whichever server you're testing against right now).
4. Use the manual workflows below to try the whole flow in a couple of
   minutes instead of waiting for Sunday.
5. Once it behaves the way you want, invite the bot to the real server,
   update the `GUILD_ID` secret, and re-create the emojis there if they
   don't already exist.

### Manual test runs (GitHub Actions tab)

Go to this repo's **Actions** tab. Three workflows are available, each
runnable on demand via **Run workflow**:

- **Manual - post weekly messages** — posts this week's dated message to
  every goal channel right now, and starts tracking it.
- **Manual - score tracked messages** — scores whatever message is
  currently tracked in each goal channel right now, and posts the results
  table to `#bot`.
- **Manual - adopt existing dated messages** — for channels the bot isn't
  tracking yet (e.g. a human posted this week's `9/13-9/19` message before
  the bot ever ran there), finds the most recent message matching that
  date-range format in each untracked goal channel and adopts it, so
  scoring picks up reactions already on it. Never touches a channel
  that's already tracked.
- **Weekly goals job** — the real scheduled workflow; also runnable
  manually (score, then post, back to back).

A realistic test: run **post**, react to the new message in a test channel
with a few of the tracked emojis, then run **score** to see the results
table pick up your reactions.

### Testing locally instead

```bash
cp .env.example .env   # fill in DISCORD_TOKEN and GUILD_ID
npm install
npm run post    # or: npm run score / npm run run
```

This reads/writes the same `data/state.json` used by the workflow, so
commit or discard changes to it afterward as appropriate.

## Notes

- The very first run has nothing to score yet (no prior message is
  tracked), so scoring will report 0 for every channel until a post has
  happened at least once.
- Only reactions from the tracked emoji names count; any other emoji on
  the post is ignored.
- The results table always has exactly one row per goal channel.
- Scoring is safe to run more than once — it just re-scores whatever
  message is currently tracked, it doesn't advance anything. Only posting
  advances the tracked message.
- GitHub Actions' `schedule` trigger only guarantees the workflow won't
  run *before* the scheduled time — during high load it can be delayed by
  several minutes. Not an issue for a weekly personal-goals bot.
