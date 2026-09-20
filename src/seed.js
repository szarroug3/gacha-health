const { seedTrackedMessages } = require('./weeklyJob');

seedTrackedMessages()
  .then(({ seeded, alreadyTracked, noMatch }) => {
    if (seeded.length > 0) console.log('Seeded:', seeded);
    if (alreadyTracked.length > 0) console.log('Already tracked, left alone:', alreadyTracked);
    if (noMatch.length > 0) {
      console.log('No message matching "M/D-M/D" found in the channel\'s recent history, skipped:', noMatch);
    }
    if (seeded.length === 0 && alreadyTracked.length === 0 && noMatch.length === 0) {
      console.log('No goal channels found.');
    }
  })
  .catch((err) => {
    console.error('Seed job failed:', err);
    process.exit(1);
  });
