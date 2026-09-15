const { DateTime } = require('luxon');

// Returns a "M/D-M/D" label for the Sunday-Saturday week starting "now"
// (assumes "now" falls on a Sunday, e.g. when run by the Sunday cron job).
function getWeekLabel(zone) {
  const sunday = DateTime.now().setZone(zone).startOf('day');
  const saturday = sunday.plus({ days: 6 });
  return `${sunday.month}/${sunday.day}-${saturday.month}/${saturday.day}`;
}

module.exports = { getWeekLabel };
