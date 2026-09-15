const discord = require('./discordApi');

// When a script is triggered by the Discord webhook (via GitHub Actions'
// workflow_dispatch), INTERACTION_TOKEN/DISCORD_APPLICATION_ID are passed
// through as inputs so the deferred "thinking..." response can be edited
// with the real result. When run manually (no interaction), this is a
// no-op - there's nothing to edit.
function makeResponder() {
  const interactionToken = process.env.INTERACTION_TOKEN;
  const applicationId = process.env.DISCORD_APPLICATION_ID;

  return async function respond(content) {
    if (!interactionToken || !applicationId) return;
    try {
      await discord.editInteractionResponse(applicationId, interactionToken, content);
    } catch (err) {
      console.error('Failed to edit interaction response:', err.message);
    }
  };
}

module.exports = { makeResponder };
