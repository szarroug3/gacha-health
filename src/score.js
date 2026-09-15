const { scoreLastWeek } = require('./weeklyJob');

scoreLastWeek()
  .then((rows) => console.log('Scored:', rows))
  .catch((err) => {
    console.error('Score job failed:', err);
    process.exit(1);
  });
