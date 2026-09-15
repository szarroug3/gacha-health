const { Client, GatewayIntentBits, Partials } = require('discord.js');
const cron = require('node-cron');
const config = require('./config');
const { runWeeklyJob } = require('./weeklyJob');

if (!config.token || !config.guildId) {
  console.error('Missing DISCORD_TOKEN or GUILD_ID in .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  cron.schedule(
    '0 0 * * 0',
    () => {
      console.log('Running weekly goals job...');
      runWeeklyJob(client).catch((err) => console.error('Weekly job failed:', err));
    },
    { timezone: config.timezone }
  );

  console.log(`Scheduled weekly job for Sundays at 12:00 AM (${config.timezone}).`);
});

// Manual trigger for testing: an admin can type "!goals run" in any channel
// the bot can see, instead of waiting for Sunday.
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content.trim() !== '!goals run') return;

  if (!message.member?.permissions.has('Administrator')) {
    await message.reply('You need Administrator permission to run this.');
    return;
  }

  await message.reply('Running weekly goals job now...');
  try {
    await runWeeklyJob(client);
    await message.channel.send('Weekly goals job complete.');
  } catch (err) {
    console.error(err);
    await message.channel.send(`Job failed: ${err.message}`);
  }
});

client.login(config.token);
