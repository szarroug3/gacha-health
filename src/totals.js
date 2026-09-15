const { getAllTotals, buildTotalsEmbed } = require('./weeklyJob');
const { respondEmbed, respond, isInteraction } = require('./interactionRespond').makeResponder();

async function main() {
  const rows = await getAllTotals({ skipChannelMessage: isInteraction });
  console.log('Totals:', rows);
  await respondEmbed(buildTotalsEmbed(rows));
}

main().catch(async (err) => {
  console.error('Totals lookup failed:', err.message);
  await respond(`Failed: ${err.message}`);
  process.exit(1);
});
