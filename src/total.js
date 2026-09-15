const { getTotal } = require('./weeklyJob');
const { makeResponder } = require('./interactionRespond');

const channel = process.env.TOTAL_CHANNEL;
const respond = makeResponder();

async function main() {
  if (!channel) {
    throw new Error('TOTAL_CHANNEL is required');
  }

  const result = await getTotal(channel);
  console.log('Total:', result);
  await respond(`**${result.channel}** has **${result.total}** point${result.total === 1 ? '' : 's'}.`);
}

main().catch(async (err) => {
  console.error('Total lookup failed:', err.message);
  await respond(`Failed: ${err.message}`);
  process.exit(1);
});
