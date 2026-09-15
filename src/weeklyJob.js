const { getWeekLabel } = require('./dateUtils');
const { loadState, saveState } = require('./storage');
const config = require('./config');
const discord = require('./discordApi');

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

// Matches the plain "9/13-9/19" date-range messages the bot (or a human
// filling in for it) posts.
const WEEK_LABEL_RE = /^\d{1,2}\/\d{1,2}-\d{1,2}\/\d{1,2}$/;

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
// it twice), and posts a results table to the results channel.
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
  await discord.sendEmbed(resultsChannel.id, buildResultsEmbed(resultsRows, scoredWeekLabel));
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

// Adds points to a goal channel's running total directly (e.g. a manual
// bonus award, or a correction). Not subject to the emoji scoring rules.
async function addPoints(channelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  channelState.totalPoints = (channelState.totalPoints || 0) + amount;
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

// Runs both steps in the right order: score the outgoing week, then post
// the new one. Used for the weekly scheduled run.
async function runWeeklyJob() {
  await scoreLastWeek();
  await postWeeklyMessages();
}

// For channels the bot isn't already tracking (e.g. a human posted this
// week's date-range message before the bot ever ran there), find the most
// recent message that looks like "9/13-9/19" and adopt it, so scoring
// picks up reactions already on it. Never overwrites a channel that's
// already tracked.
async function seedTrackedMessages() {
  const { goalChannels } = await getChannels();
  const state = loadState();
  const seeded = [];

  for (const channel of goalChannels) {
    if (state.channels[channel.id]?.lastMessageId) continue;

    const messages = await discord.getRecentMessages(channel.id, 25);
    const match = messages.find((m) => WEEK_LABEL_RE.test((m.content || '').trim()));
    if (!match) continue;

    const weekLabel = match.content.trim();
    state.channels[channel.id] = { lastMessageId: match.id, weekLabel };
    seeded.push({ channel: channel.name, weekLabel });
  }

  saveState(state);
  return seeded;
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

function padRight(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

// Discord only lines up columns in monospace text, so the table itself has
// to be a code block - tied totals just end up adjacent in the sort, which
// is enough to show the tie without needing an explicit rank column.
function buildResultsEmbed(rows, weekLabel) {
  const sorted = sortByTotal(rows);

  const nameWidth = Math.max(4, ...sorted.map((r) => r.channel.length));
  const lastWeekWidth = Math.max(9, ...sorted.map((r) => String(r.lastWeek).length));

  const line = (name, lastWeek, total) => `${padRight(name, nameWidth)}  ${padRight(String(lastWeek), lastWeekWidth)}  ${total}`;

  const lines = [line('Name', 'Last Week', 'Total'), ...sorted.map((r) => line(r.channel, r.lastWeek, r.total))];

  return {
    title: `📊 Results for ${weekLabel || 'last week'}`,
    color: 0x57f287,
    description: '```\n' + lines.join('\n') + '\n```',
  };
}

// Same table style as buildResultsEmbed, but for a totals-only view (no
// "last week" figure to show).
function buildTotalsEmbed(rows) {
  const sorted = sortByTotal(rows);

  const nameWidth = Math.max(4, ...sorted.map((r) => r.channel.length));

  const line = (name, total) => `${padRight(name, nameWidth)}  ${total}`;

  const lines = [line('Name', 'Total'), ...sorted.map((r) => line(r.channel, r.total))];

  return {
    title: '🏆 Current Totals',
    color: 0x57f287,
    description: '```\n' + lines.join('\n') + '\n```',
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
  getTotal,
};
