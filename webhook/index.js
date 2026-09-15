import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';

// Slash command name -> the workflow file it triggers, and which of its
// own options to forward as dispatch inputs. GitHub's dispatch API rejects
// any input not declared in the target workflow's yml, so each command
// must list exactly what its workflow expects - nothing more.
const COMMANDS = {
  spend: { workflow: 'spend.yml', options: ['channel', 'amount', 'note'] },
  add: { workflow: 'add.yml', options: ['channel', 'amount', 'note'] },
  transfer: { workflow: 'transfer.yml', options: ['from', 'to', 'amount', 'note'] },
  total: { workflow: 'total.yml', options: ['channel'] },
  totals: { workflow: 'totals.yml', options: [] },
};

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Expected POST', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.text();

    const isValid = signature && timestamp && (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
    if (!isValid) {
      return new Response('Bad request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);

    if (interaction.type === InteractionType.PING) {
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      const command = COMMANDS[interaction.data.name];

      if (!command) {
        return jsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `Unknown command: ${interaction.data.name}`, flags: 64 },
        });
      }

      // GitHub Actions can take longer than Discord's 3-second window, so
      // respond "thinking..." immediately and do the real work in the
      // background - dispatchWorkflow() edits this response once it's done.
      ctx.waitUntil(dispatchWorkflow(env, command, interaction));
      return jsonResponse({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
    }

    return new Response('Unhandled interaction type', { status: 400 });
  },
};

async function dispatchWorkflow(env, command, interaction) {
  const options = {};
  for (const opt of interaction.data.options || []) {
    options[opt.name] = opt.value;
  }

  const inputs = {
    interaction_token: interaction.token,
    application_id: interaction.application_id,
  };
  for (const name of command.options) {
    inputs[name] = options[name] != null ? String(options[name]) : '';
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${command.workflow}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'gacha-health-webhook',
        },
        body: JSON.stringify({ ref: 'main', inputs }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      await editInteractionResponse(interaction, `Failed to start the job (GitHub said ${res.status}).`);
      console.error('GitHub dispatch failed', res.status, text);
    }
  } catch (err) {
    await editInteractionResponse(interaction, `Failed to start the job: ${err.message}`);
  }
}

async function editInteractionResponse(interaction, content) {
  await fetch(
    `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }
  );
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}
