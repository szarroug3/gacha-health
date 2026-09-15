const { transferPoints } = require('./weeklyJob');
const { makeResponder } = require('./interactionRespond');

const from = process.env.TRANSFER_FROM;
const to = process.env.TRANSFER_TO;
const amount = Number(process.env.TRANSFER_AMOUNT);
const note = process.env.TRANSFER_NOTE || undefined;
const { respond, isInteraction } = makeResponder();

async function main() {
  if (!from) {
    throw new Error('TRANSFER_FROM is required');
  }
  if (!to) {
    throw new Error('TRANSFER_TO is required');
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`TRANSFER_AMOUNT must be a positive whole number, got "${process.env.TRANSFER_AMOUNT}"`);
  }

  const result = await transferPoints(from, to, amount, note, { skipChannelMessage: isInteraction });
  console.log('Transferred:', result);
  await respond(
    `Transferred **${amount}** point${amount === 1 ? '' : 's'} from **${result.from}** to **${result.to}**. ` +
      `${result.from}: **${result.fromRemaining}**, ${result.to}: **${result.toTotal}**.`
  );
}

main().catch(async (err) => {
  console.error('Transfer failed:', err.message);
  await respond(`Failed: ${err.message}`);
  process.exit(1);
});
