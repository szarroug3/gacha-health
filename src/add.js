const { addPoints } = require('./weeklyJob');

const channel = process.env.ADD_CHANNEL;
const amount = Number(process.env.ADD_AMOUNT);
const note = process.env.ADD_NOTE || undefined;

if (!channel) {
  console.error('ADD_CHANNEL is required');
  process.exit(1);
}
if (!Number.isInteger(amount) || amount <= 0) {
  console.error(`ADD_AMOUNT must be a positive whole number, got "${process.env.ADD_AMOUNT}"`);
  process.exit(1);
}

addPoints(channel, amount, note)
  .then((result) => console.log('Added:', result))
  .catch((err) => {
    console.error('Add failed:', err.message);
    process.exit(1);
  });
