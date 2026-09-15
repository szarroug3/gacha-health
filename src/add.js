const { addPoints } = require('./weeklyJob');
const { makeResponder } = require('./interactionRespond');

const channel = process.env.ADD_CHANNEL;
const amount = Number(process.env.ADD_AMOUNT);
const note = process.env.ADD_NOTE || undefined;
const { respond, isInteraction } = makeResponder();

async function main() {
  if (!channel) {
    throw new Error('ADD_CHANNEL is required');
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`ADD_AMOUNT must be a positive whole number, got "${process.env.ADD_AMOUNT}"`);
  }

  const result = await addPoints(channel, amount, note, { skipChannelMessage: isInteraction });
  console.log('Added:', result);
  await respond(
    `Added **${amount}** point${amount === 1 ? '' : 's'} to **${result.channel}**. New total: **${result.total}**.`
  );
}

main().catch(async (err) => {
  console.error('Add failed:', err.message);
  await respond(`Failed: ${err.message}`);
  process.exit(1);
});
