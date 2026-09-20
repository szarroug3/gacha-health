# Discord Goals Bot

Runs as a scheduled [GitHub Actions](https://github.com/features/actions) workflow — no server to host, no
credit card, and it only needs to run for a few seconds once a week. Every
Sunday (around 12:00 AM Central), it:

1. Adopts any text channel under **Personal Goals** that isn't tracked
   yet - a brand-new channel someone already posted a dated message in
   before the bot noticed it, or one that fell through the cracks
   earlier - so a new member doesn't need anyone to run a manual step for
   them to get picked up. If anyone joined, returned, or left since the
   last run, posts a one-line summary to `#bot`, e.g.:
   ```
   Welcomed this week: carey, heather
   Returned this week: drew
   Left this week: pat
   ```
   Only the lines that apply show up, and nothing posts at all on a
   normal week where membership didn't change.
2. Scores the message currently tracked in every text channel under the
   category, based on reactions:
   - `:1sunday:` `:2monday:` `:3tuesday:` `:4wednesday:` `:5thursday:`
     `:6friday:` `:7saturday:` = 1 point each
   - `:Biggoal:` = 5 points
   - `:Weekly:` = 3 points
   - Each tracked emoji counts once per message regardless of how many
     people reacted with it - it marks that day/goal as done, not a vote.
   - Credits those points to that channel's running total (once per
     message - re-scoring the same message never double-credits it), and
     posts a results table to `#bot` with one row per channel showing
     **Last Week** and **Total** (running balance).
3. Posts a new message in each of those channels with the new week's date
   range (e.g. `9/13 - 9/19`), and starts tracking it for next week.

If someone leaves (their channel gets deleted or moved out of the
category), their point history isn't deleted - it just stops being
touched, and they show up in that week's "Left" line. If a channel with
the same name later reappears (e.g. they come back and the owner
recreates it), the bot recognizes the name match, automatically restores
their old total to the new channel, and lists them under "Returned"
instead of "Welcomed".

It also posts a one-off `@everyone` reminder to `#general` every Saturday
around 6:00 PM Central: "Make sure to add your points to your weekly
message before midnight!"

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
- **Manual - transfer points** — moves points from one channel to
  another. Fails instead of going negative if the source doesn't have
  enough, and instead of a no-op if the two channels are the same.
- **Manual - check total** — looks up a channel's current running total
  without changing anything.
- **Manual - check all totals** — posts a leaderboard of every goal
  channel's current running total.
- **Manual - check lifetime totals** — looks up a channel's lifetime
  points gained and lifetime points spent (separate from the current
  balance, which is gained minus spent).

Spend/add/transfer/total/lifetime take a channel name (transfer takes a
from/to pair instead) plus an amount where relevant, and an optional
note; all six post a confirmation to `#bot`.

They can also be run as real Discord slash commands (`/spend`, `/add`,
`/transfer`, `/total`, `/totals`, `/lifetime`) instead of from the
Actions tab — see
[Setting up slash commands](#setting-up-slash-commands) below. That part's
optional; everything above works without it.

## Setup

### 1. Create the bot application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Under **Bot**, click "Add Bot".
3. Copy the bot token (Bot → Reset Token) — you'll need it below. No
   privileged intents are needed; everything runs over the REST API.

### 2. Invite the bot to a server

Under **OAuth2 → URL Generator**:

- Scopes: `bot`
- Bot permissions: `View Channels`, `Send Messages`, `Read Message History`,
  `Mention @everyone, @here, and All Roles` (needed for the Saturday
  reminder's `@everyone` ping to actually notify people)

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
- A text channel named `general` (configurable, can be anywhere) — that's
  where the Saturday `@everyone` reminder gets posted.

### 5. Add repo secrets/variables

In this repo: **Settings → Secrets and variables → Actions**.

Required, under **Secrets**:

- `DISCORD_TOKEN` — the bot token from step 1
- `GUILD_ID` — the server's ID (enable Developer Mode in Discord settings,
  then right-click the server icon → Copy Server ID)

Optional, under **Variables** (only add if you want non-default values):

- `CATEGORY_NAME` — defaults to `Personal Goals`
- `RESULTS_CHANNEL_NAME` — defaults to `bot`
- `REMINDER_CHANNEL_NAME` — defaults to `general`
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

Go to this repo's **Actions** tab. These workflows are runnable on
demand via **Run workflow**:

- **Manual - post weekly messages** — posts this week's dated message to
  every goal channel that doesn't already have one for this week, and
  starts tracking it. Check the **force** input to reprint anyway (e.g. to
  replace a deleted message) — every channel gets a fresh post regardless
  of what's already tracked for this week.
- **Manual - score tracked messages** — scores whatever message is
  currently tracked in each goal channel right now, and posts the results
  table to `#bot` (skipped if no channel scored any points).
- **Manual - adopt existing dated messages** — for channels the bot
  hasn't credited a message for yet (e.g. a human posted this week's
  `9/13 - 9/19` message before the bot ever ran there, or it got a blank
  first post from **post** before ever being seeded), searches the
  channel's full history (ignoring the bot's own posts) for the most
  recent human-posted message matching that date-range format (hyphen or
  dash, spaces optional) and adopts it, so scoring picks up reactions
  already on it. Leaves a channel alone once it's been credited at least
  once. Also runs automatically as the first step of the weekly job. Only
  posts to `#bot` when membership actually changed (see the
  Welcomed/Returned/Left summary above) - otherwise silent.
- **Weekly goals job** — the real scheduled workflow; also runnable
  manually (seed, then score, then post, back to back), with the same
  **force** input as **post**.

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
- Scoring is safe to run more than once and never double-credits a
  message - a channel that's already been scored just gets its last
  credited message re-tallied for display, so reprinting the results
  table (e.g. after deleting the old message) always shows everyone's
  real last score, not 0 for channels that happen to be mid-cycle. Only
  posting advances the tracked message, and posting is itself safe to run
  more than once - a channel that already has this week's message is
  skipped unless **force** is set.
- GitHub Actions' `schedule` trigger only guarantees the workflow won't
  run *before* the scheduled time — during high load it can be delayed by
  several minutes. Not an issue for a weekly personal-goals bot.
- `data/state.json`'s channels are always kept sorted to match the goal
  channels' order in Discord, so the file stays predictable to read and
  diff instead of drifting into whatever order channels happened to get
  touched in.

## Setting up slash commands

Optional. This makes `/spend`, `/add`, `/transfer`, `/total`, `/totals`,
and `/lifetime` work as real Discord slash commands instead of only from
the Actions tab. It needs one small
extra piece: a [Cloudflare Worker](https://developers.cloudflare.com/workers/)
(free, no card required, in [webhook/](webhook)) that receives the command
from Discord and triggers the matching GitHub Actions workflow.

How it works: you type `/spend` in Discord → Discord sends it to the
Worker → the Worker tells GitHub to run `spend.yml` with the values you
typed → the workflow runs (same as a manual Actions run) → it edits your
Discord message with the result once done (usually a few seconds).

### 1. Get the Discord app's public key and application ID

Developer Portal → your application → **General Information**. Copy the
**Public Key** and the **Application ID** — you'll need both below.

### 2. Deploy the Cloudflare Worker

```bash
cd webhook
npm install
npx wrangler login          # opens a browser to sign into (or create) a free Cloudflare account
npx wrangler deploy
```

The deploy output prints the Worker's URL (`https://gacha-health-webhook.<your-subdomain>.workers.dev`) — save it, you'll need it in step 4.

### 3. Set the Worker's secrets

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
# paste the Public Key from step 1

npx wrangler secret put GITHUB_TOKEN
# paste a GitHub token (see below) that can trigger workflow runs on this repo
```

For `GITHUB_TOKEN`: create a
[fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
scoped to just this repository, with **Actions: Read and write** and
**Contents: Read and write** permissions (Contents write is needed because
triggering a dispatch also lets the workflow push its state commit). Treat
this token like a password — it only lives in Cloudflare's secret store,
never in this repo.

If `webhook/wrangler.toml`'s `GITHUB_OWNER`/`GITHUB_REPO` don't match your
repo (e.g. you forked it), edit those two lines before deploying.

### 4. Point Discord at the Worker

Developer Portal → your application → **General Information** →
**Interactions Endpoint URL** → paste the Worker's URL from step 2 → Save.
Discord immediately sends a test request to verify it; if steps 2–3 are
done correctly this succeeds right away. If it fails, double check the
`DISCORD_PUBLIC_KEY` secret matches exactly and redeploy/retry.

### 5. Register the commands

```bash
cp .env.example .env   # if you haven't already; fill in DISCORD_TOKEN, GUILD_ID, DISCORD_APPLICATION_ID
npm install
npm run register-commands
```

This registers `/spend`, `/add`, `/transfer`, `/total`, `/totals`,
`/lifetime` as guild commands (instant, rather than the up-to-an-hour
delay for global commands) — they'll show up in the server right away.

### Troubleshooting

- **Discord rejects the Interactions Endpoint URL**: usually a mismatched
  `DISCORD_PUBLIC_KEY` secret, or the Worker not deployed yet. Re-run
  `npx wrangler secret put DISCORD_PUBLIC_KEY` and try saving the URL again.
- **The command responds "The application did not respond" in Discord**:
  the Worker's initial response (deferred "thinking...") didn't reach
  Discord in time, or the GitHub dispatch call failed silently. Check the
  Worker's logs with `npx wrangler tail` from `webhook/` while running the
  command again.
- **Command runs but never updates with a result**: check the
  corresponding workflow's run in the Actions tab for errors, and confirm
  `GITHUB_TOKEN`'s fine-grained permissions include both Actions and
  Contents write access on this repo.
