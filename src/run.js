const { runWeeklyJob } = require('./weeklyJob');

runWeeklyJob()
  .then(() => console.log('Weekly goals job complete.'))
  .catch((err) => {
    console.error('Weekly job failed:', err);
    process.exit(1);
  });
