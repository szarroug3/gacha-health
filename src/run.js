const { runWeeklyJob } = require('./weeklyJob');

const force = process.env.FORCE_REPRINT === 'true';

runWeeklyJob({ force })
  .then(() => console.log('Weekly goals job complete.'))
  .catch((err) => {
    console.error('Weekly job failed:', err);
    process.exit(1);
  });
