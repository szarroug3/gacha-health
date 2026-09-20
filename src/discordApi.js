const config = require('./config');

const BASE = 'https://discord.com/api/v10';

// A weekly job hits this endpoint many times in a row (per channel, per
// tracked emoji, per reaction page) and Discord's rate limit is easy to
// trip in that burst - without a retry, one 429 aborts tallying the whole
// message, silently under-counting that channel's points for the week.
const MAX_RATE_LIMIT_RETRIES = 5;

async function discordFetch(path, options = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bot ${config.token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const body = await res.json().catch(() => ({}));
      const retryAfterMs = Math.ceil((body.retry_after || 1) * 1000);
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Discord API ${options.method || 'GET'} ${path} failed: ${res.status} ${body}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }
}

function getCurrentUser() {
  return discordFetch('/users/@me');
}

function getGuildChannels(guildId) {
  return discordFetch(`/guilds/${guildId}/channels`);
}

function sendMessage(channelId, content) {
  return discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

function sendEmbed(channelId, embed) {
  return discordFetch(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ embeds: [embed] }),
  });
}

function getMessage(channelId, messageId) {
  return discordFetch(`/channels/${channelId}/messages/${messageId}`);
}

function getRecentMessages(channelId, limit = 25, before) {
  const query = new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) });
  return discordFetch(`/channels/${channelId}/messages?${query}`);
}

// Edits the placeholder ("thinking...") response Discord shows after a
// slash command is deferred. Auth is via the interaction token in the URL
// itself, not the bot token, but discordFetch's Bot header is harmless here.
function editInteractionResponse(applicationId, interactionToken, content) {
  return discordFetch(`/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

function editInteractionResponseEmbed(applicationId, interactionToken, embed) {
  return discordFetch(`/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    body: JSON.stringify({ embeds: [embed] }),
  });
}

// Custom emoji must be identified as "name:id"; unicode emoji just uses the
// character itself. Paginates in case a reaction has >100 users.
async function getReactionUsers(channelId, messageId, emojiIdentifier) {
  const users = [];
  let after;

  for (;;) {
    const query = new URLSearchParams({ limit: '100', ...(after ? { after } : {}) });
    const page = await discordFetch(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emojiIdentifier)}?${query}`
    );
    users.push(...page);
    if (page.length < 100) break;
    after = page[page.length - 1].id;
  }

  return users;
}

module.exports = {
  getCurrentUser,
  getGuildChannels,
  sendMessage,
  sendEmbed,
  getMessage,
  getRecentMessages,
  getReactionUsers,
  editInteractionResponse,
  editInteractionResponseEmbed,
};
