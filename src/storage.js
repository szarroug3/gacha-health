const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

// State shape: {
//   channels: { [channelId]: { name, lastMessageId, weekLabel, totalPoints,
//     lifetimeGained, lifetimeSpent, creditedMessageId } },
//   liveChannelIds: [channelId, ...] - the goal channel ids seen as of the
//     last seedTrackedMessages() run, used to detect who's left since then
// }
function loadState() {
  if (!fs.existsSync(DATA_FILE)) return { channels: {} };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { channels: {} };
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

module.exports = { loadState, saveState };
