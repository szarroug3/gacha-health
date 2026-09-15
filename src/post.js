const { postWeeklyMessages } = require('./weeklyJob');

postWeeklyMessages()
  .then((label) => console.log(`Posted messages for week ${label}.`))
  .catch((err) => {
    console.error('Post job failed:', err);
    process.exit(1);
  });
