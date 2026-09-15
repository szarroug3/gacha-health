const { ChannelType } = require('discord.js');
const { getWeekLabel } = require('./dateUtils');
const { loadState, saveState } = require('./storage');
const config = require('./config');

async function runWeeklyJob(client) {
  const guild = await client.guilds.fetch(config.guildId);
  await guild.channels.fetch();

  const category = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildCategory &&
      c.name.toLowerCase() === config.categoryName.toLowerCase()
  );
  if (!category) {
    throw new Error(`Category "${config.categoryName}" not found in guild`);
  }

  const goalChannels = [...guild.channels.cache.values()]
    .filter((c) => c.parentId === category.id && c.type === ChannelType.GuildText)
    .sort((a, b) => a.position - b.position);

  const resultsChannel = guild.channels.cache.find(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.name.toLowerCase() === config.resultsChannelName.toLowerCase()
  );
  if (!resultsChannel) {
    throw new Error(`Results channel "#${config.resultsChannelName}" not found in guild`);
  }

  const state = loadState();
  const newWeekLabel = getWeekLabel(config.timezone);
  const resultsRows = [];
  let scoredWeekLabel = null;

  for (const channel of goalChannels) {
    const channelState = state.channels[channel.id] || {};
    let points = 0;

    if (channelState.lastMessageId) {
      try {
        const prevMessage = await channel.messages.fetch(channelState.lastMessageId);
        points = await tallyPoints(prevMessage, client.user.id);
        scoredWeekLabel = channelState.weekLabel;
      } catch (err) {
        console.error(`Could not fetch/tally message for #${channel.name}: ${err.message}`);
      }
    }

    resultsRows.push({ channel: channel.name, points });

    const newMessage = await channel.send(newWeekLabel);
    state.channels[channel.id] = { lastMessageId: newMessage.id, weekLabel: newWeekLabel };
  }

  saveState(state);

  await resultsChannel.send(formatResultsTable(resultsRows, scoredWeekLabel));
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

module.exports = { runWeeklyJob };
