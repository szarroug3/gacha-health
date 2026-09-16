const { getLifetime } = require('./weeklyJob');
const { makeResponder } = require('./interactionRespond');

const channel = process.env.LIFETIME_CHANNEL;
const { respond, isInteraction } = makeResponder();

async function main() {
  if (!channel) {
    throw new Error('LIFETIME_CHANNEL is required');
  }

  const result = await getLifetime(channel, { skipChannelMessage: isInteraction });
  console.log('Lifetime:', result);
  await respond(
    `**${result.channel}** — Lifetime gained: **${result.gained}**, Lifetime spent: **${result.spent}**, Current total: **${result.net}**.`
  );
}

main().catch(async (err) => {
  console.error('Lifetime lookup failed:', err.message);
  await respond(`Failed: ${err.message}`);
  process.exit(1);
});
