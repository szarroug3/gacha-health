require('dotenv').config();

// Point values per emoji name (lowercased). Custom guild emojis must be
// named exactly: 1sunday, 2monday, 3tuesday, 4wednesday, 5thursday,
// 6friday, 7saturday, Biggoal
const EMOJI_POINTS = {
  '1sunday': 1,
  '2monday': 1,
  '3tuesday': 1,
  '4wednesday': 1,
  '5thursday': 1,
  '6friday': 1,
  '7saturday': 1,
  biggoal: 5,
};

module.exports = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  categoryName: process.env.CATEGORY_NAME || 'Personal Goals',
  resultsChannelName: process.env.RESULTS_CHANNEL_NAME || 'bot',
  timezone: process.env.TIMEZONE || 'America/Chicago',
  // Cron schedules (in the timezone above). Defaults score the outgoing
  // week just before midnight Saturday, then post the new week's messages
  // right at midnight Sunday - score always needs to run before post, since
  // post overwrites the tracked message that score reads.
  scoreCron: process.env.SCORE_CRON || '58 23 * * 6',
  postCron: process.env.POST_CRON || '0 0 * * 0',
  EMOJI_POINTS,
};
