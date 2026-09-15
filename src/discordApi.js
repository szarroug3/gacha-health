const config = require('./config');

const BASE = 'https://discord.com/api/v10';

async function discordFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${config.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API ${options.method || 'GET'} ${path} failed: ${res.status} ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
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

module.exports = { getCurrentUser, getGuildChannels, sendMessage, sendEmbed, getMessage, getReactionUsers };
