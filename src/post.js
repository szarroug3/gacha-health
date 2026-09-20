const { postWeeklyMessages } = require('./weeklyJob');

const force = process.env.FORCE_REPRINT === 'true';

postWeeklyMessages({ force })
  .then(({ weekLabel, posted, skipped }) => {
    console.log(`Week ${weekLabel}:`);
    if (posted.length > 0) console.log('Posted:', posted);
    if (skipped.length > 0) {
      console.log('Already posted this week, left alone (pass force to reprint):', skipped);
    }
  })
  .catch((err) => {
    console.error('Post job failed:', err);
    process.exit(1);
  });
