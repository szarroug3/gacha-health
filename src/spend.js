const { spendPoints } = require('./weeklyJob');
const { makeResponder } = require('./interactionRespond');

const channel = process.env.SPEND_CHANNEL;
const amount = Number(process.env.SPEND_AMOUNT);
const note = process.env.SPEND_NOTE || undefined;
const respond = makeResponder();

async function main() {
  if (!channel) {
    throw new Error('SPEND_CHANNEL is required');
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`SPEND_AMOUNT must be a positive whole number, got "${process.env.SPEND_AMOUNT}"`);
  }

  const result = await spendPoints(channel, amount, note);
  console.log('Spent:', result);
  await respond(
    `Spent **${amount}** point${amount === 1 ? '' : 's'} from **${result.channel}**. Remaining: **${result.remaining}**.`
  );
}

main().catch(async (err) => {
  console.error('Spend failed:', err.message);
  await respond(`Failed: ${err.message}`);
  process.exit(1);
});
