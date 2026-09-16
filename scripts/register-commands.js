// One-time (re-runnable) script that registers the /spend, /add,
// /transfer, /total, /totals, /lifetime slash commands with Discord for
// this server. Run locally:
//   node scripts/register-commands.js
// Needs DISCORD_TOKEN, DISCORD_APPLICATION_ID, and GUILD_ID in .env.
const config = require('../src/config');

const STRING = 3;
const INTEGER = 4;

const commands = [
  {
    name: 'spend',
    description: 'Spend points from a goal channel',
    options: [
      { name: 'channel', description: 'Goal channel name', type: STRING, required: true },
      { name: 'amount', description: 'Points to deduct', type: INTEGER, required: true },
      { name: 'note', description: 'Optional note', type: STRING, required: false },
    ],
  },
  {
    name: 'add',
    description: 'Add points to a goal channel',
    options: [
      { name: 'channel', description: 'Goal channel name', type: STRING, required: true },
      { name: 'amount', description: 'Points to add', type: INTEGER, required: true },
      { name: 'note', description: 'Optional note', type: STRING, required: false },
    ],
  },
  {
    name: 'transfer',
    description: 'Move points from one goal channel to another',
    options: [
      { name: 'from', description: 'Goal channel to take points from', type: STRING, required: true },
      { name: 'to', description: 'Goal channel to give points to', type: STRING, required: true },
      { name: 'amount', description: 'Points to move', type: INTEGER, required: true },
      { name: 'note', description: 'Optional note', type: STRING, required: false },
    ],
  },
  {
    name: 'total',
    description: "Check a goal channel's current point total",
    options: [{ name: 'channel', description: 'Goal channel name', type: STRING, required: true }],
  },
  {
    name: 'totals',
    description: 'Show a leaderboard of every goal channel\'s current point total',
    options: [],
  },
  {
    name: 'lifetime',
    description: "Show a goal channel's lifetime points gained and spent",
    options: [{ name: 'channel', description: 'Goal channel name', type: STRING, required: true }],
  },
];

async function main() {
  if (!config.applicationId || !config.guildId || !config.token) {
    console.error('DISCORD_APPLICATION_ID, GUILD_ID, and DISCORD_TOKEN must be set in .env');
    process.exit(1);
  }

  // Guild-scoped commands (vs. global) show up instantly instead of
  // taking up to an hour to propagate - fine since this is a single-server bot.
  const res = await fetch(
    `https://discord.com/api/v10/applications/${config.applicationId}/guilds/${config.guildId}/commands`,
    {
      method: 'PUT',
      headers: { Authorization: `Bot ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    }
  );

  if (!res.ok) {
    console.error('Failed to register commands:', res.status, await res.text());
    process.exit(1);
  }

  const registered = await res.json();
  console.log(
    'Registered commands:',
    registered.map((c) => c.name).join(', ')
  );
}

main();
