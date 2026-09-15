const { spendPoints } = require('./weeklyJob');

const channel = process.env.SPEND_CHANNEL;
const amount = Number(process.env.SPEND_AMOUNT);
const note = process.env.SPEND_NOTE || undefined;

if (!channel) {
  console.error('SPEND_CHANNEL is required');
  process.exit(1);
}
if (!Number.isInteger(amount) || amount <= 0) {
  console.error(`SPEND_AMOUNT must be a positive whole number, got "${process.env.SPEND_AMOUNT}"`);
  process.exit(1);
}

spendPoints(channel, amount, note)
  .then((result) => console.log('Spent:', result))
  .catch((err) => {
    console.error('Spend failed:', err.message);
    process.exit(1);
  });
