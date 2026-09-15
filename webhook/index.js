import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';

// Slash command name -> the workflow file in the main repo that handles it.
const WORKFLOW_FILES = {
  spend: 'spend.yml',
  add: 'add.yml',
  total: 'total.yml',
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
      const commandName = interaction.data.name;
      const workflowFile = WORKFLOW_FILES[commandName];

      if (!workflowFile) {
        return jsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: `Unknown command: ${commandName}`, flags: 64 },
        });
      }

      // GitHub Actions can take longer than Discord's 3-second window, so
      // respond "thinking..." immediately and do the real work in the
      // background - dispatchWorkflow() edits this response once it's done.
      ctx.waitUntil(dispatchWorkflow(env, commandName, workflowFile, interaction));
      return jsonResponse({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
    }

    return new Response('Unhandled interaction type', { status: 400 });
  },
};

async function dispatchWorkflow(env, commandName, workflowFile, interaction) {
  const options = {};
  for (const opt of interaction.data.options || []) {
    options[opt.name] = opt.value;
  }

  // Each workflow only declares the inputs it actually uses (total.yml has
  // no amount/note) - GitHub's dispatch API rejects any undeclared input,
  // so only include what the target workflow expects.
  const inputs = {
    channel: String(options.channel ?? ''),
    interaction_token: interaction.token,
    application_id: interaction.application_id,
  };
  if (commandName === 'spend' || commandName === 'add') {
    inputs.amount = options.amount != null ? String(options.amount) : '';
    inputs.note = options.note ? String(options.note) : '';
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`,
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
