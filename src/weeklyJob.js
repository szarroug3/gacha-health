const { getWeekLabel } = require('./dateUtils');
const { loadState, saveState } = require('./storage');
const config = require('./config');
const discord = require('./discordApi');

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

// Matches the plain "9/13-9/19" date-range messages the bot (or a human
// filling in for it) posts. Tolerates hyphen/en dash/em dash and optional
// spacing around it (e.g. "9/13 – 9/19"), since a human typing this by
// hand may not use a plain hyphen.
const WEEK_LABEL_RE = /^\d{1,2}\/\d{1,2}\s*[-–—]\s*\d{1,2}\/\d{1,2}$/;

async function getChannels() {
  const channels = await discord.getGuildChannels(config.guildId);

  const category = channels.find(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && c.name.toLowerCase() === config.categoryName.toLowerCase()
  );
  if (!category) {
    throw new Error(`Category "${config.categoryName}" not found in guild`);
  }

  const resultsChannel = channels.find(
    (c) => c.type === CHANNEL_TYPE_TEXT && c.name.toLowerCase() === config.resultsChannelName.toLowerCase()
  );
  if (!resultsChannel) {
    throw new Error(`Results channel "#${config.resultsChannelName}" not found in guild`);
  }

  // Exclude the results channel even if it happens to live under the goals
  // category, so it never gets a dated weekly post by mistake.
  const goalChannels = channels
    .filter((c) => c.parent_id === category.id && c.type === CHANNEL_TYPE_TEXT && c.id !== resultsChannel.id)
    .sort((a, b) => a.position - b.position);

  return { goalChannels, resultsChannel };
}

// Posts the new dated message (e.g. "9/13-9/19") to every goal channel and
// starts tracking it as the message scoreLastWeek() should score next time.
async function postWeeklyMessages() {
  const { goalChannels } = await getChannels();

  const state = loadState();
  const newWeekLabel = getWeekLabel(config.timezone);

  for (const channel of goalChannels) {
    const newMessage = await discord.sendMessage(channel.id, newWeekLabel);
    // Merge rather than replace - preserves totalPoints/creditedMessageId
    // that scoreLastWeek() may have already set for this channel.
    state.channels[channel.id] = {
      ...(state.channels[channel.id] || {}),
      lastMessageId: newMessage.id,
      weekLabel: newWeekLabel,
    };
  }

  saveState(state);
  return newWeekLabel;
}

// Scores the currently-tracked message in each goal channel, credits the
// points to that channel's running total (once per message - re-running
// this against the same tracked message re-displays it but doesn't credit
// it twice), and posts a results table to the results channel - skipped
// when no channel scored any points this week.
// postWeeklyMessages() is what advances the tracked message to a new one;
// this never touches lastMessageId/weekLabel.
async function scoreLastWeek() {
  const { goalChannels, resultsChannel } = await getChannels();
  const botUser = await discord.getCurrentUser();

  const state = loadState();
  const resultsRows = [];
  let scoredWeekLabel = null;

  for (const channel of goalChannels) {
    const channelState = state.channels[channel.id] || {};
    let lastWeekPoints = 0;

    if (channelState.lastMessageId) {
      try {
        const message = await discord.getMessage(channel.id, channelState.lastMessageId);
        lastWeekPoints = await tallyPoints(channel.id, message, botUser.id);
        scoredWeekLabel = channelState.weekLabel;

        if (channelState.creditedMessageId !== channelState.lastMessageId) {
          channelState.totalPoints = (channelState.totalPoints || 0) + lastWeekPoints;
          channelState.lifetimeGained = (channelState.lifetimeGained || 0) + lastWeekPoints;
          channelState.creditedMessageId = channelState.lastMessageId;
          state.channels[channel.id] = channelState;
        }
      } catch (err) {
        console.error(`Could not fetch/tally message for #${channel.name}: ${err.message}`);
      }
    }

    resultsRows.push({ channel: channel.name, lastWeek: lastWeekPoints, total: channelState.totalPoints || 0 });
  }

  saveState(state);
  if (resultsRows.some((row) => row.lastWeek > 0)) {
    await discord.sendEmbed(resultsChannel.id, buildResultsEmbed(resultsRows, scoredWeekLabel));
  }
  return resultsRows;
}

function findGoalChannel(goalChannels, channelName) {
  const channel = goalChannels.find((c) => c.name.toLowerCase() === channelName.toLowerCase());
  if (!channel) {
    throw new Error(`Goal channel "${channelName}" not found`);
  }
  return channel;
}

function pointsSuffix(amount) {
  return `point${amount === 1 ? '' : 's'}`;
}

// Deducts points from a goal channel's running total (e.g. someone redeemed
// a reward). Throws if the channel isn't found or doesn't have enough.
// skipChannelMessage: true when a slash-command interaction response will
// already show the result in-channel, so the #bot post would be redundant.
async function spendPoints(channelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  const currentTotal = channelState.totalPoints || 0;

  if (amount > currentTotal) {
    throw new Error(`#${channel.name} only has ${currentTotal} points, can't spend ${amount}`);
  }

  channelState.totalPoints = currentTotal - amount;
  channelState.lifetimeSpent = (channelState.lifetimeSpent || 0) + amount;
  state.channels[channel.id] = channelState;
  saveState(state);

  if (!skipChannelMessage) {
    const noteText = note ? ` (${note})` : '';
    await discord.sendMessage(
      resultsChannel.id,
      `**${channel.name}** spent **${amount}** ${pointsSuffix(amount)}${noteText}. Remaining: **${channelState.totalPoints}**.`
    );
  }

  return { channel: channel.name, spent: amount, remaining: channelState.totalPoints };
}

// Moves points from one goal channel's running total to another. Throws if
// either channel isn't found, they're the same channel, or the source
// doesn't have enough.
async function transferPoints(fromChannelName, toChannelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const fromChannel = findGoalChannel(goalChannels, fromChannelName);
  const toChannel = findGoalChannel(goalChannels, toChannelName);

  if (fromChannel.id === toChannel.id) {
    throw new Error("Can't transfer points to the same channel");
  }

  const state = loadState();
  const fromState = state.channels[fromChannel.id] || {};
  const toState = state.channels[toChannel.id] || {};
  const fromTotal = fromState.totalPoints || 0;

  if (amount > fromTotal) {
    throw new Error(`#${fromChannel.name} only has ${fromTotal} points, can't transfer ${amount}`);
  }

  fromState.totalPoints = fromTotal - amount;
  fromState.lifetimeSpent = (fromState.lifetimeSpent || 0) + amount;
  toState.totalPoints = (toState.totalPoints || 0) + amount;
  toState.lifetimeGained = (toState.lifetimeGained || 0) + amount;
  state.channels[fromChannel.id] = fromState;
  state.channels[toChannel.id] = toState;
  saveState(state);

  if (!skipChannelMessage) {
    const noteText = note ? ` (${note})` : '';
    await discord.sendMessage(
      resultsChannel.id,
      `**${fromChannel.name}** transferred **${amount}** ${pointsSuffix(amount)} to **${toChannel.name}**${noteText}. ` +
        `${fromChannel.name}: **${fromState.totalPoints}**, ${toChannel.name}: **${toState.totalPoints}**.`
    );
  }

  return {
    from: fromChannel.name,
    to: toChannel.name,
    amount,
    fromRemaining: fromState.totalPoints,
    toTotal: toState.totalPoints,
  };
}

// Adds points to a goal channel's running total directly (e.g. a manual
// bonus award, or a correction). Not subject to the emoji scoring rules.
async function addPoints(channelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  channelState.totalPoints = (channelState.totalPoints || 0) + amount;
  channelState.lifetimeGained = (channelState.lifetimeGained || 0) + amount;
  state.channels[channel.id] = channelState;
  saveState(state);

  if (!skipChannelMessage) {
    const noteText = note ? ` (${note})` : '';
    await discord.sendMessage(
      resultsChannel.id,
      `**${channel.name}** was given **${amount}** ${pointsSuffix(amount)}${noteText}. New total: **${channelState.totalPoints}**.`
    );
  }

  return { channel: channel.name, added: amount, total: channelState.totalPoints };
}

// Looks up a goal channel's current running total and posts it to the
// results channel. Read-only - doesn't touch state.
async function getTotal(channelName, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const total = state.channels[channel.id]?.totalPoints || 0;

  if (!skipChannelMessage) {
    await discord.sendMessage(resultsChannel.id, `**${channel.name}** has **${total}** ${pointsSuffix(total)}.`);
  }

  return { channel: channel.name, total };
}

// Looks up a goal channel's lifetime gained/spent totals and posts them to
// the results channel. Read-only - doesn't touch state. gained - spent
// should always equal the channel's current totalPoints balance.
async function getLifetime(channelName, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  const gained = channelState.lifetimeGained || 0;
  const spent = channelState.lifetimeSpent || 0;
  const net = channelState.totalPoints || 0;

  if (!skipChannelMessage) {
    await discord.sendMessage(
      resultsChannel.id,
      `**${channel.name}** — Lifetime gained: **${gained}**, Lifetime spent: **${spent}**, Current total: **${net}**.`
    );
  }

  return { channel: channel.name, gained, spent, net };
}

// Looks up every goal channel's current running total and posts a
// leaderboard to the results channel. Read-only - doesn't touch state.
async function getAllTotals({ skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const state = loadState();

  const rows = goalChannels.map((channel) => ({
    channel: channel.name,
    total: state.channels[channel.id]?.totalPoints || 0,
  }));

  if (!skipChannelMessage) {
    await discord.sendEmbed(resultsChannel.id, buildTotalsEmbed(rows));
  }

  return rows;
}

// Posts a single @everyone reminder to the reminder channel (separate from
// the results channel - e.g. #general, where everyone actually hangs out).
// Requires the bot to have the "Mention @everyone, @here, and All Roles"
// permission in that channel, or Discord will silently render it as plain
// text with no ping.
async function postReminder() {
  const channels = await discord.getGuildChannels(config.guildId);
  const reminderChannel = channels.find(
    (c) => c.type === CHANNEL_TYPE_TEXT && c.name.toLowerCase() === config.reminderChannelName.toLowerCase()
  );
  if (!reminderChannel) {
    throw new Error(`Reminder channel "#${config.reminderChannelName}" not found in guild`);
  }

  await discord.sendMessage(
    reminderChannel.id,
    '@everyone Make sure to add your points to your weekly message before midnight!'
  );
}

// Runs both steps in the right order: score the outgoing week, then post
// the new one. Used for the weekly scheduled run.
async function runWeeklyJob() {
  await scoreLastWeek();
  await postWeeklyMessages();
}

// How far back seedTrackedMessages() will page through a channel's history
// looking for a date-range message, in case of a heavily-chatted channel
// where the original human-posted message has scrolled past the most
// recent page.
const SEED_LOOKBACK_LIMIT = 1000;

// Pages backward through a channel's history (newest first, 100 at a time)
// looking for a message matching WEEK_LABEL_RE. Stops at the first match,
// once SEED_LOOKBACK_LIMIT messages have been scanned, or once the start
// of the channel is reached (a page shorter than requested).
async function findWeekLabelMessage(channelId) {
  let before;
  let scanned = 0;

  while (scanned < SEED_LOOKBACK_LIMIT) {
    const messages = await discord.getRecentMessages(channelId, 100, before);
    if (messages.length === 0) return null;

    const match = messages.find((m) => WEEK_LABEL_RE.test((m.content || '').trim()));
    if (match) return match;

    scanned += messages.length;
    if (messages.length < 100) return null;
    before = messages[messages.length - 1].id;
  }

  return null;
}

// For channels the bot isn't already tracking (e.g. a human posted this
// week's date-range message before the bot ever ran there), find the most
// recent message that looks like "9/13-9/19" and adopt it, so scoring
// picks up reactions already on it. Never overwrites a channel that's
// already tracked. Posts a summary to the results channel so a channel
// that couldn't be matched doesn't fail silently.
async function seedTrackedMessages() {
  const { goalChannels, resultsChannel } = await getChannels();
  const state = loadState();
  const seeded = [];
  const alreadyTracked = [];
  const noMatch = [];

  for (const channel of goalChannels) {
    if (state.channels[channel.id]?.lastMessageId) {
      alreadyTracked.push(channel.name);
      continue;
    }

    const match = await findWeekLabelMessage(channel.id);
    if (!match) {
      noMatch.push(channel.name);
      continue;
    }

    const weekLabel = match.content.trim();
    state.channels[channel.id] = { lastMessageId: match.id, weekLabel };
    seeded.push({ channel: channel.name, weekLabel });
  }

  saveState(state);
  await discord.sendMessage(resultsChannel.id, buildSeedSummary(seeded, alreadyTracked, noMatch));
  return { seeded, alreadyTracked, noMatch };
}

function buildSeedSummary(seeded, alreadyTracked, noMatch) {
  if (seeded.length === 0 && alreadyTracked.length === 0 && noMatch.length === 0) {
    return 'Seed: no goal channels found.';
  }

  const lines = ['**Seed results**'];
  if (seeded.length > 0) {
    lines.push(`Seeded: ${seeded.map((s) => `${s.channel} (${s.weekLabel})`).join(', ')}`);
  }
  if (alreadyTracked.length > 0) {
    lines.push(`Already tracked, left alone: ${alreadyTracked.join(', ')}`);
  }
  if (noMatch.length > 0) {
    lines.push(`⚠️ No matching "M/D-M/D" message found: ${noMatch.join(', ')}`);
  }
  return lines.join('\n');
}

// Sums points from every tracked-emoji reaction on the message, from any
// non-bot user (a channel's post is scored as a single total, not per-user).
async function tallyPoints(channelId, message, botUserId) {
  let total = 0;

  for (const reaction of message.reactions || []) {
    const emojiName = (reaction.emoji.name || '').toLowerCase();
    const value = config.EMOJI_POINTS[emojiName];
    if (!value) continue;

    const emojiIdentifier = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
    const users = await discord.getReactionUsers(channelId, message.id, emojiIdentifier);
    for (const user of users) {
      if (user.bot || user.id === botUserId) continue;
      total += value;
    }
  }

  return total;
}

function sortByTotal(rows) {
  return [...rows].sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel));
}

function sortByLastWeek(rows) {
  return [...rows].sort((a, b) => b.lastWeek - a.lastWeek || b.total - a.total || a.channel.localeCompare(b.channel));
}

// Bold channel name on its own line, stats below it, blank line between
// entries - reads like a native Discord embed instead of a code block or
// a grid of cards. Tied values just end up adjacent in the sort order.
function buildResultsEmbed(rows, weekLabel) {
  const sorted = sortByLastWeek(rows);

  const description = sorted
    .map((r) => `**${r.channel}**\n**${r.lastWeek}** this week · **${r.total}** total`)
    .join('\n\n');

  return {
    title: `📊 Results for ${weekLabel || 'last week'}`,
    color: 0x57f287,
    description,
  };
}

// Same style as buildResultsEmbed, but for a totals-only view (no "last
// week" figure to show).
function buildTotalsEmbed(rows) {
  const sorted = sortByTotal(rows);

  const description = sorted.map((r) => `**${r.channel}**\n**${r.total}** ${pointsSuffix(r.total)}`).join('\n\n');

  return {
    title: '🏆 Current Totals',
    color: 0x57f287,
    description,
  };
}

module.exports = {
  runWeeklyJob,
  getAllTotals,
  buildTotalsEmbed,
  postWeeklyMessages,
  scoreLastWeek,
  seedTrackedMessages,
  spendPoints,
  addPoints,
  transferPoints,
  getTotal,
  getLifetime,
  postReminder,
};
