require('dotenv').config();

// Point values per emoji name (lowercased). Custom guild emojis must be
// named exactly: 1sunday, 2monday, 3tuesday, 4wednesday, 5thursday,
// 6friday, 7saturday, Biggoal, Weekly
const EMOJI_POINTS = {
  '1sunday': 1,
  '2monday': 1,
  '3tuesday': 1,
  '4wednesday': 1,
  '5thursday': 1,
  '6friday': 1,
  '7saturday': 1,
  biggoal: 5,
  weekly: 3,
};

module.exports = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  applicationId: process.env.DISCORD_APPLICATION_ID,
  categoryName: process.env.CATEGORY_NAME || 'Personal Goals',
  resultsChannelName: process.env.RESULTS_CHANNEL_NAME || 'bot',
  reminderChannelName: process.env.REMINDER_CHANNEL_NAME || 'general',
  timezone: process.env.TIMEZONE || 'America/Chicago',
  EMOJI_POINTS,
};
