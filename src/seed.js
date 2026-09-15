const { seedTrackedMessages } = require('./weeklyJob');

seedTrackedMessages()
  .then((seeded) => {
    if (seeded.length === 0) {
      console.log('Nothing to seed - every goal channel already has a tracked message.');
    } else {
      console.log('Seeded:', seeded);
    }
  })
  .catch((err) => {
    console.error('Seed job failed:', err);
    process.exit(1);
  });
