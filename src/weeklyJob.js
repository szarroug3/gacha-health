const { getWeekLabel } = require('./dateUtils');
const { loadState, saveState } = require('./storage');
const config = require('./config');
const discord = require('./discordApi');

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

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
    state.channels[channel.id] = { lastMessageId: newMessage.id, weekLabel: newWeekLabel };
  }

  saveState(state);
  return newWeekLabel;
}

// Scores the currently-tracked message in each goal channel and posts the
// results table to the results channel. Does not touch state -
// postWeeklyMessages() is what advances the tracked message to a new one.
// Safe to run more than once (e.g. while testing): it just re-scores
// whatever message is currently tracked.
async function scoreLastWeek() {
  const { goalChannels, resultsChannel } = await getChannels();
  const botUser = await discord.getCurrentUser();

  const state = loadState();
  const resultsRows = [];
  let scoredWeekLabel = null;

  for (const channel of goalChannels) {
    const channelState = state.channels[channel.id] || {};
    let points = 0;

    if (channelState.lastMessageId) {
      try {
        const message = await discord.getMessage(channel.id, channelState.lastMessageId);
        points = await tallyPoints(channel.id, message, botUser.id);
        scoredWeekLabel = channelState.weekLabel;
      } catch (err) {
        console.error(`Could not fetch/tally message for #${channel.name}: ${err.message}`);
      }
    }

    resultsRows.push({ channel: channel.name, points });
  }

  await discord.sendMessage(resultsChannel.id, formatResultsTable(resultsRows, scoredWeekLabel));
  return resultsRows;
}

// Runs both steps in the right order: score the outgoing week, then post
// the new one. Used for the weekly scheduled run.
async function runWeeklyJob() {
  await scoreLastWeek();
  await postWeeklyMessages();
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

function formatResultsTable(rows, weekLabel) {
  const header = `Results for ${weekLabel || 'last week'}`;

  const colWidths = {
    channel: Math.max(7, ...rows.map((r) => r.channel.length)),
    points: 6,
  };

  const lines = [
    pad('Channel', colWidths.channel) + '  ' + pad('Points', colWidths.points),
    '-'.repeat(colWidths.channel) + '  ' + '-'.repeat(colWidths.points),
    ...rows.map(
      (row) => pad(row.channel, colWidths.channel) + '  ' + pad(String(row.points), colWidths.points)
    ),
  ];

  return `**${header}**\n\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function pad(str, len) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

module.exports = { runWeeklyJob, postWeeklyMessages, scoreLastWeek };
