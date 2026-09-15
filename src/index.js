const { Client, GatewayIntentBits, Partials } = require('discord.js');
const cron = require('node-cron');
const config = require('./config');
const { runWeeklyJob, postWeeklyMessages, scoreLastWeek } = require('./weeklyJob');

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
    config.scoreCron,
    () => {
      console.log('Running scheduled score job...');
      scoreLastWeek(client).catch((err) => console.error('Score job failed:', err));
    },
    { timezone: config.timezone }
  );

  cron.schedule(
    config.postCron,
    () => {
      console.log('Running scheduled post job...');
      postWeeklyMessages(client).catch((err) => console.error('Post job failed:', err));
    },
    { timezone: config.timezone }
  );

  console.log(
    `Scheduled (${config.timezone}): score "${config.scoreCron}", post "${config.postCron}".`
  );
});

// Manual triggers for testing, so you don't have to wait for the schedule:
//   !goals post   - post this week's dated message to every goal channel
//   !goals score  - score whatever message is currently tracked, post table
//   !goals run    - score, then post (what the full weekly schedule does)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  if (!content.startsWith('!goals')) return;

  if (!message.member?.permissions.has('Administrator')) {
    await message.reply('You need Administrator permission to run this.');
    return;
  }

  const sub = content.split(/\s+/)[1];

  try {
    if (sub === 'post') {
      await message.reply("Posting this week's messages...");
      await postWeeklyMessages(client);
      await message.channel.send('Posted.');
    } else if (sub === 'score') {
      await message.reply('Scoring the tracked message and posting results...');
      await scoreLastWeek(client);
      await message.channel.send('Scored.');
    } else if (sub === 'run') {
      await message.reply('Running full weekly job (score, then post)...');
      await runWeeklyJob(client);
      await message.channel.send('Weekly goals job complete.');
    } else {
      await message.reply('Usage: `!goals post` | `!goals score` | `!goals run`');
    }
  } catch (err) {
    console.error(err);
    await message.channel.send(`Job failed: ${err.message}`);
  }
});

client.login(config.token);
