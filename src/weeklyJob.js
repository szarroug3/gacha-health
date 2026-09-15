const { ChannelType } = require('discord.js');
const { getWeekLabel } = require('./dateUtils');
const { loadState, saveState } = require('./storage');
const config = require('./config');

async function getGoalChannels(guild) {
  await guild.channels.fetch();

  const category = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildCategory &&
      c.name.toLowerCase() === config.categoryName.toLowerCase()
  );
  if (!category) {
    throw new Error(`Category "${config.categoryName}" not found in guild`);
  }

  return [...guild.channels.cache.values()]
    .filter((c) => c.parentId === category.id && c.type === ChannelType.GuildText)
    .sort((a, b) => a.position - b.position);
}

function getResultsChannel(guild) {
  const resultsChannel = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.name.toLowerCase() === config.resultsChannelName.toLowerCase()
  );
  if (!resultsChannel) {
    throw new Error(`Results channel "#${config.resultsChannelName}" not found in guild`);
  }
  return resultsChannel;
}

// Posts the new dated message (e.g. "9/13-9/19") to every goal channel and
// starts tracking it as the message scoreLastWeek() should score next time.
async function postWeeklyMessages(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const goalChannels = await getGoalChannels(guild);

  const state = loadState();
  const newWeekLabel = getWeekLabel(config.timezone);

  for (const channel of goalChannels) {
    const newMessage = await channel.send(newWeekLabel);
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
async function scoreLastWeek(client) {
  const guild = await client.guilds.fetch(config.guildId);
  const goalChannels = await getGoalChannels(guild);
  const resultsChannel = getResultsChannel(guild);

  const state = loadState();
  const resultsRows = [];
  let scoredWeekLabel = null;

  for (const channel of goalChannels) {
    const channelState = state.channels[channel.id] || {};
    let points = 0;

    if (channelState.lastMessageId) {
      try {
        const message = await channel.messages.fetch(channelState.lastMessageId);
        points = await tallyPoints(message, client.user.id);
        scoredWeekLabel = channelState.weekLabel;
      } catch (err) {
        console.error(`Could not fetch/tally message for #${channel.name}: ${err.message}`);
      }
    }

    resultsRows.push({ channel: channel.name, points });
  }

  await resultsChannel.send(formatResultsTable(resultsRows, scoredWeekLabel));
  return resultsRows;
}

// Runs both steps in the right order: score the outgoing week, then post
// the new one. Used by the "!goals run" manual command.
async function runWeeklyJob(client) {
  await scoreLastWeek(client);
  await postWeeklyMessages(client);
}

// Sums points from every tracked-emoji reaction on the message, from any
// non-bot user (a channel's post is scored as a single total, not per-user).
async function tallyPoints(message, botUserId) {
  let total = 0;

  for (const reaction of message.reactions.cache.values()) {
    const emojiName = (reaction.emoji.name || '').toLowerCase();
    const value = config.EMOJI_POINTS[emojiName];
    if (!value) continue;

    const users = await reaction.users.fetch();
    for (const user of users.values()) {
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
