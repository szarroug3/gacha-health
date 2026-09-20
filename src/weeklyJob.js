const { getWeekLabel } = require('./dateUtils');
const { loadState, saveState } = require('./storage');
const config = require('./config');
const discord = require('./discordApi');

const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;

// Matches the plain "9/13-9/19" date-range messages the bot (or a human
// filling in for it) posts. Tolerates hyphen/en dash/em dash and optional
// spacing around it (e.g. "9/13 – 9/19"), since a human typing this by
// hand may not use a plain hyphen.
const WEEK_LABEL_RE = /^\d{1,2}\/\d{1,2}\s*[-–—]\s*\d{1,2}\/\d{1,2}$/;

async function getChannels() {
  const channels = await discord.getGuildChannels(config.guildId);

  const category = channels.find(
    (c) => c.type === CHANNEL_TYPE_CATEGORY && c.name.toLowerCase() === config.categoryName.toLowerCase()
  );
  if (!category) {
    throw new Error(`Category "${config.categoryName}" not found in guild`);
  }

  const resultsChannel = channels.find(
    (c) => c.type === CHANNEL_TYPE_TEXT && c.name.toLowerCase() === config.resultsChannelName.toLowerCase()
  );
  if (!resultsChannel) {
    throw new Error(`Results channel "#${config.resultsChannelName}" not found in guild`);
  }

  // Exclude the results channel even if it happens to live under the goals
  // category, so it never gets a dated weekly post by mistake.
  const goalChannels = channels
    .filter((c) => c.parent_id === category.id && c.type === CHANNEL_TYPE_TEXT && c.id !== resultsChannel.id)
    .sort((a, b) => a.position - b.position);

  return { goalChannels, resultsChannel };
}

// Reorders state.channels to match goalChannels' Discord position order
// (falling back to whatever order any other entries were already in, e.g.
// a channel that's been deleted or renamed out of the category), so
// data/state.json reads in a stable, predictable order instead of
// whatever order channels happened to get touched in over time.
function sortChannelsByPosition(state, goalChannels) {
  const sorted = {};
  for (const channel of goalChannels) {
    if (channel.id in state.channels) sorted[channel.id] = state.channels[channel.id];
  }
  for (const id of Object.keys(state.channels)) {
    if (!(id in sorted)) sorted[id] = state.channels[id];
  }
  state.channels = sorted;
}

// If `channel` is brand new to state.json (no entry yet at all) and its
// name matches an orphaned entry - one whose channel id is no longer
// among liveIds, e.g. someone quit and the owner later created them a
// new channel with the same name - migrates that old total onto the new
// channel and removes the orphan, so leaving doesn't cost someone their
// points if they come back. Only totalPoints/lifetime* carry over; the
// new channel still gets its own fresh tracked message from
// seedTrackedMessages()/postWeeklyMessages(). Silent - the caller reports
// it as part of the weekly "Welcomed/Returned/Left" summary instead of
// announcing each migration individually. Returns true if revived.
function reviveIfOrphaned(state, channel, liveIds) {
  if (state.channels[channel.id]) return false;

  const orphan = Object.entries(state.channels).find(
    ([id, data]) => !liveIds.has(id) && (data.name || '').toLowerCase() === channel.name.toLowerCase()
  );
  if (!orphan) return false;

  const [orphanId, orphanData] = orphan;
  state.channels[channel.id] = {
    name: channel.name,
    totalPoints: orphanData.totalPoints || 0,
    lifetimeGained: orphanData.lifetimeGained || 0,
    ...(orphanData.lifetimeSpent ? { lifetimeSpent: orphanData.lifetimeSpent } : {}),
  };
  delete state.channels[orphanId];
  return true;
}

// Posts the new dated message (e.g. "9/13-9/19") to every goal channel and
// starts tracking it as the message scoreLastWeek() should score next time.
// Skips a channel that's already tracking a message for the current week
// (weekLabel matches) unless force is set, so a delayed/duplicate trigger
// (or an accidental double-dispatch) doesn't spam a second dated message
// into every channel. force: true reprints regardless - e.g. to replace a
// deleted message, or after correcting state by hand.
async function postWeeklyMessages({ force = false } = {}) {
  const { goalChannels } = await getChannels();

  const state = loadState();
  const newWeekLabel = getWeekLabel(config.timezone);
  const posted = [];
  const skipped = [];
  const liveIds = new Set(goalChannels.map((c) => c.id));

  for (const channel of goalChannels) {
    reviveIfOrphaned(state, channel, liveIds);
    const channelState = state.channels[channel.id];
    if (!force && channelState?.weekLabel === newWeekLabel) {
      skipped.push(channel.name);
      continue;
    }

    const newMessage = await discord.sendMessage(channel.id, newWeekLabel);
    // Merge rather than replace - preserves totalPoints/creditedMessageId
    // that scoreLastWeek() may have already set for this channel.
    state.channels[channel.id] = {
      ...(channelState || {}),
      name: channel.name,
      lastMessageId: newMessage.id,
      weekLabel: newWeekLabel,
    };
    posted.push(channel.name);
  }

  sortChannelsByPosition(state, goalChannels);
  saveState(state);
  return { weekLabel: newWeekLabel, posted, skipped };
}

// Scores the currently-tracked message in each goal channel, credits the
// points to that channel's running total (once per message - a message
// only ever gets credited once, tracked via creditedMessageId), and posts
// a results table to the results channel - skipped when no channel has
// anything to show. postWeeklyMessages() is what advances the tracked
// message to a new one; this never touches lastMessageId/weekLabel.
//
// Never *credits* a channel's current-week message (weekLabel matches
// this week) - that message's week isn't over yet, so crediting it now
// would lock in a premature (and likely 0) count and permanently block
// the real scoring once the week actually ends. This mainly matters for
// an out-of-sequence manual run (e.g. recovering a channel seed missed)
// alongside channels that already got this week's message from a normal
// postWeeklyMessages() run.
//
// A channel with nothing new to credit but a real scoring history
// (creditedMessageId set) still gets its last-credited message re-tallied
// purely for *display* - read-only, no state change - so the results
// table always shows everyone's real last score, not 0 for every channel
// that just happens to be mid-cycle. That's what makes reprinting safe:
// re-running this after deleting the old results message shows the same
// complete picture again instead of only whatever this particular run
// happened to newly credit.
async function scoreLastWeek() {
  const { goalChannels, resultsChannel } = await getChannels();
  const botUser = await discord.getCurrentUser();

  const state = loadState();
  const resultsRows = [];
  let scoredWeekLabel = null;
  const currentWeekLabel = getWeekLabel(config.timezone);

  for (const channel of goalChannels) {
    const channelState = state.channels[channel.id] || {};
    let lastWeekPoints = 0;

    const readyToCredit =
      channelState.lastMessageId &&
      channelState.weekLabel !== currentWeekLabel &&
      channelState.creditedMessageId !== channelState.lastMessageId;

    if (readyToCredit) {
      try {
        const message = await discord.getMessage(channel.id, channelState.lastMessageId);
        lastWeekPoints = await tallyPoints(channel.id, message, botUser.id);
        channelState.name = channel.name;
        channelState.totalPoints = (channelState.totalPoints || 0) + lastWeekPoints;
        channelState.lifetimeGained = (channelState.lifetimeGained || 0) + lastWeekPoints;
        channelState.creditedMessageId = channelState.lastMessageId;
        state.channels[channel.id] = channelState;
        scoredWeekLabel = channelState.weekLabel;
      } catch (err) {
        console.error(`Could not fetch/tally message for #${channel.name}: ${err.message}`);
      }
    } else if (channelState.creditedMessageId) {
      try {
        const message = await discord.getMessage(channel.id, channelState.creditedMessageId);
        lastWeekPoints = await tallyPoints(channel.id, message, botUser.id);
        scoredWeekLabel = scoredWeekLabel || message.content.trim();
      } catch (err) {
        console.error(`Could not re-fetch credited message for #${channel.name}: ${err.message}`);
      }
    }

    resultsRows.push({ channel: channel.name, lastWeek: lastWeekPoints, total: channelState.totalPoints || 0 });
  }

  sortChannelsByPosition(state, goalChannels);
  saveState(state);
  if (resultsRows.some((row) => row.lastWeek > 0)) {
    await discord.sendEmbed(resultsChannel.id, buildResultsEmbed(resultsRows, scoredWeekLabel));
  }
  return resultsRows;
}

function findGoalChannel(goalChannels, channelName) {
  const channel = goalChannels.find((c) => c.name.toLowerCase() === channelName.toLowerCase());
  if (!channel) {
    throw new Error(`Goal channel "${channelName}" not found`);
  }
  return channel;
}

function pointsSuffix(amount) {
  return `point${amount === 1 ? '' : 's'}`;
}

// Deducts points from a goal channel's running total (e.g. someone redeemed
// a reward). Throws if the channel isn't found or doesn't have enough.
// skipChannelMessage: true when a slash-command interaction response will
// already show the result in-channel, so the #bot post would be redundant.
async function spendPoints(channelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  const currentTotal = channelState.totalPoints || 0;

  if (amount > currentTotal) {
    throw new Error(`#${channel.name} only has ${currentTotal} points, can't spend ${amount}`);
  }

  channelState.name = channel.name;
  channelState.totalPoints = currentTotal - amount;
  channelState.lifetimeSpent = (channelState.lifetimeSpent || 0) + amount;
  state.channels[channel.id] = channelState;
  sortChannelsByPosition(state, goalChannels);
  saveState(state);

  if (!skipChannelMessage) {
    const noteText = note ? ` (${note})` : '';
    await discord.sendMessage(
      resultsChannel.id,
      `**${channel.name}** spent **${amount}** ${pointsSuffix(amount)}${noteText}. Remaining: **${channelState.totalPoints}**.`
    );
  }

  return { channel: channel.name, spent: amount, remaining: channelState.totalPoints };
}

// Moves points from one goal channel's running total to another. Throws if
// either channel isn't found, they're the same channel, or the source
// doesn't have enough.
async function transferPoints(fromChannelName, toChannelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const fromChannel = findGoalChannel(goalChannels, fromChannelName);
  const toChannel = findGoalChannel(goalChannels, toChannelName);

  if (fromChannel.id === toChannel.id) {
    throw new Error("Can't transfer points to the same channel");
  }

  const state = loadState();
  const fromState = state.channels[fromChannel.id] || {};
  const toState = state.channels[toChannel.id] || {};
  const fromTotal = fromState.totalPoints || 0;

  if (amount > fromTotal) {
    throw new Error(`#${fromChannel.name} only has ${fromTotal} points, can't transfer ${amount}`);
  }

  fromState.name = fromChannel.name;
  fromState.totalPoints = fromTotal - amount;
  fromState.lifetimeSpent = (fromState.lifetimeSpent || 0) + amount;
  toState.name = toChannel.name;
  toState.totalPoints = (toState.totalPoints || 0) + amount;
  toState.lifetimeGained = (toState.lifetimeGained || 0) + amount;
  state.channels[fromChannel.id] = fromState;
  state.channels[toChannel.id] = toState;
  sortChannelsByPosition(state, goalChannels);
  saveState(state);

  if (!skipChannelMessage) {
    const noteText = note ? ` (${note})` : '';
    await discord.sendMessage(
      resultsChannel.id,
      `**${fromChannel.name}** transferred **${amount}** ${pointsSuffix(amount)} to **${toChannel.name}**${noteText}. ` +
        `${fromChannel.name}: **${fromState.totalPoints}**, ${toChannel.name}: **${toState.totalPoints}**.`
    );
  }

  return {
    from: fromChannel.name,
    to: toChannel.name,
    amount,
    fromRemaining: fromState.totalPoints,
    toTotal: toState.totalPoints,
  };
}

// Adds points to a goal channel's running total directly (e.g. a manual
// bonus award, or a correction). Not subject to the emoji scoring rules.
async function addPoints(channelName, amount, note, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  channelState.name = channel.name;
  channelState.totalPoints = (channelState.totalPoints || 0) + amount;
  channelState.lifetimeGained = (channelState.lifetimeGained || 0) + amount;
  state.channels[channel.id] = channelState;
  sortChannelsByPosition(state, goalChannels);
  saveState(state);

  if (!skipChannelMessage) {
    const noteText = note ? ` (${note})` : '';
    await discord.sendMessage(
      resultsChannel.id,
      `**${channel.name}** was given **${amount}** ${pointsSuffix(amount)}${noteText}. New total: **${channelState.totalPoints}**.`
    );
  }

  return { channel: channel.name, added: amount, total: channelState.totalPoints };
}

// Looks up a goal channel's current running total and posts it to the
// results channel. Read-only - doesn't touch state.
async function getTotal(channelName, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const total = state.channels[channel.id]?.totalPoints || 0;

  if (!skipChannelMessage) {
    await discord.sendMessage(resultsChannel.id, `**${channel.name}** has **${total}** ${pointsSuffix(total)}.`);
  }

  return { channel: channel.name, total };
}

// Looks up a goal channel's lifetime gained/spent totals and posts them to
// the results channel. Read-only - doesn't touch state. gained - spent
// should always equal the channel's current totalPoints balance.
async function getLifetime(channelName, { skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const channel = findGoalChannel(goalChannels, channelName);

  const state = loadState();
  const channelState = state.channels[channel.id] || {};
  const gained = channelState.lifetimeGained || 0;
  const spent = channelState.lifetimeSpent || 0;
  const net = channelState.totalPoints || 0;

  if (!skipChannelMessage) {
    await discord.sendMessage(
      resultsChannel.id,
      `**${channel.name}** — Lifetime gained: **${gained}**, Lifetime spent: **${spent}**, Current total: **${net}**.`
    );
  }

  return { channel: channel.name, gained, spent, net };
}

// Looks up every goal channel's current running total and posts a
// leaderboard to the results channel. Read-only - doesn't touch state.
async function getAllTotals({ skipChannelMessage = false } = {}) {
  const { goalChannels, resultsChannel } = await getChannels();
  const state = loadState();

  const rows = goalChannels.map((channel) => ({
    channel: channel.name,
    total: state.channels[channel.id]?.totalPoints || 0,
  }));

  if (!skipChannelMessage) {
    await discord.sendEmbed(resultsChannel.id, buildTotalsEmbed(rows));
  }

  return rows;
}

// Posts a single @everyone reminder to the reminder channel (separate from
// the results channel - e.g. #general, where everyone actually hangs out).
// Requires the bot to have the "Mention @everyone, @here, and All Roles"
// permission in that channel, or Discord will silently render it as plain
// text with no ping.
async function postReminder() {
  const channels = await discord.getGuildChannels(config.guildId);
  const reminderChannel = channels.find(
    (c) => c.type === CHANNEL_TYPE_TEXT && c.name.toLowerCase() === config.reminderChannelName.toLowerCase()
  );
  if (!reminderChannel) {
    throw new Error(`Reminder channel "#${config.reminderChannelName}" not found in guild`);
  }

  await discord.sendMessage(
    reminderChannel.id,
    '@everyone Make sure to add your points to your weekly message before midnight!'
  );
}

// Runs the full weekly cycle: adopt any channel that isn't tracked yet
// (a brand-new channel with an existing human-posted message, or one
// that never got seeded), score the outgoing week, then post the new
// one. Used for the weekly scheduled run. force is passed through to
// postWeeklyMessages() - see there.
async function runWeeklyJob({ force = false } = {}) {
  await seedTrackedMessages();
  await scoreLastWeek();
  await postWeeklyMessages({ force });
}

// Pages backward through a channel's entire history (newest first, 100 at
// a time) looking for a message matching WEEK_LABEL_RE, ignoring any
// message the bot itself posted - the bot's own weekly posts match the
// same pattern, but seeding is meant to adopt a message a human posted,
// not something the bot already posted (and would just re-find as the
// "most recent" match, hiding the real one further back). Stops at the
// first qualifying match, or once the start of the channel is reached (a
// page shorter than requested) with no match found.
async function findWeekLabelMessage(channelId, botUserId) {
  let before;

  for (;;) {
    const messages = await discord.getRecentMessages(channelId, 100, before);
    if (messages.length === 0) return null;

    const match = messages.find(
      (m) => m.author?.id !== botUserId && WEEK_LABEL_RE.test((m.content || '').trim())
    );
    if (match) return match;

    if (messages.length < 100) return null;
    before = messages[messages.length - 1].id;
  }
}

// For channels the bot isn't tracking a scored message for yet (e.g. a
// human posted this week's date-range message before the bot ever ran
// there, or postWeeklyMessages() gave the channel its first-ever tracked
// message before it had ever been seeded), find the most recent
// human-posted message that looks like "9/13-9/19" and adopt it, so
// scoring picks up reactions already on it. A channel counts as "already
// tracked" - and is left alone - only once it has been credited at least
// once (creditedMessageId set); a channel whose only tracked message has
// never been scored is safe to re-point at an earlier real message
// instead. Runs automatically as part of runWeeklyJob(), so a brand-new
// channel gets adopted without anyone having to remember to run this by
// hand.
//
// Also where membership changes get tracked and announced: a channel
// brand new to state.json is "welcomed" (or "returned" if reviveIfOrphaned
// finds a name match), and a channel present in state.liveChannelIds
// (the live set as of the last time this ran) but missing from the
// current live set has "left". Posts one "Welcomed/Returned/Left" summary
// when any of those happened; otherwise stays fully quiet - the seeding
// mechanics themselves (which message got adopted, which couldn't be
// matched) aren't posted anywhere, just reflected in what gets tracked.
async function seedTrackedMessages() {
  const { goalChannels, resultsChannel } = await getChannels();
  const botUser = await discord.getCurrentUser();
  const state = loadState();
  const seeded = [];
  const alreadyTracked = [];
  const noMatch = [];
  const welcomed = [];
  const returned = [];
  const liveIds = new Set(goalChannels.map((c) => c.id));

  for (const channel of goalChannels) {
    const isNew = !state.channels[channel.id];
    if (isNew) {
      if (reviveIfOrphaned(state, channel, liveIds)) {
        returned.push(channel.name);
      } else {
        welcomed.push(channel.name);
      }
    }

    const channelState = state.channels[channel.id];
    if (channelState?.creditedMessageId) {
      alreadyTracked.push(channel.name);
      continue;
    }

    const match = await findWeekLabelMessage(channel.id, botUser.id);
    if (!match) {
      noMatch.push(channel.name);
      continue;
    }

    const weekLabel = match.content.trim();
    // Merge rather than replace - preserves totalPoints/lifetimeGained a
    // channel may already have from a manual /add, /spend, or /transfer.
    state.channels[channel.id] = { ...(channelState || {}), name: channel.name, lastMessageId: match.id, weekLabel };
    seeded.push({ channel: channel.name, weekLabel });
  }

  const previousLiveIds = state.liveChannelIds || [];
  const left = previousLiveIds.filter((id) => !liveIds.has(id)).map((id) => state.channels[id]?.name || id);
  state.liveChannelIds = [...liveIds];

  sortChannelsByPosition(state, goalChannels);
  saveState(state);

  const membershipSummary = buildMembershipSummary(welcomed, returned, left);
  if (membershipSummary) await discord.sendMessage(resultsChannel.id, membershipSummary);

  return { seeded, alreadyTracked, noMatch, welcomed, returned, left };
}

function buildMembershipSummary(welcomed, returned, left) {
  const lines = [];
  if (welcomed.length > 0) lines.push(`Welcomed this week: ${welcomed.join(', ')}`);
  if (returned.length > 0) lines.push(`Returned this week: ${returned.join(', ')}`);
  if (left.length > 0) lines.push(`Left this week: ${left.join(', ')}`);
  return lines.length > 0 ? lines.join('\n') : null;
}

// Sums points from every tracked emoji present on the message (each
// counted once - e.g. "1sunday" is worth 1 point whether one person or
// five reacted with it, since it marks that day's goal as done, not a
// vote count), as long as at least one non-bot user reacted with it.
async function tallyPoints(channelId, message, botUserId) {
  let total = 0;

  for (const reaction of message.reactions || []) {
    const emojiName = (reaction.emoji.name || '').toLowerCase();
    const value = config.EMOJI_POINTS[emojiName];
    if (!value) continue;

    const emojiIdentifier = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
    const users = await discord.getReactionUsers(channelId, message.id, emojiIdentifier);
    const hasRealReactor = users.some((user) => !user.bot && user.id !== botUserId);
    if (hasRealReactor) total += value;
  }

  return total;
}

function sortByTotal(rows) {
  return [...rows].sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel));
}

function sortByLastWeek(rows) {
  return [...rows].sort((a, b) => b.lastWeek - a.lastWeek || b.total - a.total || a.channel.localeCompare(b.channel));
}

// Bold channel name on its own line, stats below it, blank line between
// entries - reads like a native Discord embed instead of a code block or
// a grid of cards. Tied values just end up adjacent in the sort order.
function buildResultsEmbed(rows, weekLabel) {
  const sorted = sortByLastWeek(rows);

  const description = sorted
    .map((r) => `**${r.channel}**\n**${r.lastWeek}** this week · **${r.total}** total`)
    .join('\n\n');

  return {
    title: `📊 Results for ${weekLabel || 'last week'}`,
    color: 0x57f287,
    description,
  };
}

// Same style as buildResultsEmbed, but for a totals-only view (no "last
// week" figure to show).
function buildTotalsEmbed(rows) {
  const sorted = sortByTotal(rows);

  const description = sorted.map((r) => `**${r.channel}**\n**${r.total}** ${pointsSuffix(r.total)}`).join('\n\n');

  return {
    title: '🏆 Current Totals',
    color: 0x57f287,
    description,
  };
}

module.exports = {
  runWeeklyJob,
  getAllTotals,
  buildTotalsEmbed,
  postWeeklyMessages,
  scoreLastWeek,
  seedTrackedMessages,
  spendPoints,
  addPoints,
  transferPoints,
  getTotal,
  getLifetime,
  postReminder,
};
