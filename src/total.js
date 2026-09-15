const { getTotal } = require('./weeklyJob');

const channel = process.env.TOTAL_CHANNEL;

if (!channel) {
  console.error('TOTAL_CHANNEL is required');
  process.exit(1);
}

getTotal(channel)
  .then((result) => console.log('Total:', result))
  .catch((err) => {
    console.error('Total lookup failed:', err.message);
    process.exit(1);
  });
