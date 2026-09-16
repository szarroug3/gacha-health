const { postReminder } = require('./weeklyJob');

postReminder()
  .then(() => console.log('Reminder posted.'))
  .catch((err) => {
    console.error('Reminder failed:', err);
    process.exit(1);
  });
