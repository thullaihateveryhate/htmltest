// ═══════════════════════════════════════════════════════════════
// ai-client.js — Provider-neutral frontend transport for Stockd
// Sends requests to the Supabase Edge Function named `copilot`
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const VALID_MODES = new Set(['chat', 'pricing_insights']);

  function getSupabaseClient() {
    if (typeof sb === 'undefined' || !sb.functions || typeof sb.functions.invoke !== 'function') {
      throw new Error('AI client is unavailable because Supabase is not initialized.');
    }

    return sb;
  }

  async function extractInvokeErrorDetails(error) {
    const context = error && error.context;

    if (context && typeof context.clone === 'function') {
      try {
        const response = context.clone();
        const json = await response.json();
        if (json && json.error && typeof json.error.message === 'string' && json.error.message.trim()) {
          return {
            code: typeof json.error.code === 'string' ? json.error.code.trim() : null,
            message: json.error.message.trim()
          };
        }
      } catch (_) {
        // Ignore JSON parsing errors and fall through.
      }

      try {
        const response = context.clone();
        const text = await response.text();
        if (typeof text === 'string' && text.trim()) {
          return {
            code: null,
            message: text.trim()
          };
        }
      } catch (_) {
        // Ignore text parsing errors and fall through.
      }
    }

    if (error && typeof error.message === 'string' && error.message.trim()) {
      return {
        code: typeof error.code === 'string' ? error.code.trim() : null,
        message: error.message.trim()
      };
    }

    return {
      code: null,
      message: 'Copilot is unavailable right now. Please try again.'
    };
  }

  async function invokeCopilot(mode, message, context, options) {
    if (!VALID_MODES.has(mode)) {
      throw new Error('Unsupported Copilot mode.');
    }

    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('A message is required for Copilot.');
    }

    const client = getSupabaseClient();
    const requestBody = {
      mode,
      message: message.trim(),
      context,
      confirm: Boolean(options && options.confirm === true)
    };

    if (options && options.pendingAction) {
      requestBody.pending_action = options.pendingAction;
    }

    const { data, error } = await client.functions.invoke('copilot', {
      body: requestBody
    });

    if (error) {
      const details = await extractInvokeErrorDetails(error);
      const invokeError = new Error(details.message);
      invokeError.code = details.code;
      throw invokeError;
    }

    if (!data || data.ok !== true || typeof data.reply !== 'string') {
      throw new Error('Copilot returned an invalid response.');
    }

    return {
      reply: data.reply,
      data: data.data || null,
      meta: data.meta || null,
      mode: data.mode || mode
    };
  }

  async function sendChatMessage(message, context) {
    return invokeCopilot('chat', message, context);
  }

  async function getPricingInsights(message, context) {
    return invokeCopilot('pricing_insights', message, context);
  }

  async function confirmPendingAction(pendingAction, context) {
    if (!pendingAction || typeof pendingAction !== 'object') {
      throw new Error('A pending action is required before confirmation.');
    }

    const summary = typeof pendingAction.summary === 'string' && pendingAction.summary.trim()
      ? pendingAction.summary.trim()
      : 'Confirm pending inventory action';

    return invokeCopilot('chat', summary, context, {
      confirm: true,
      pendingAction
    });
  }

  window.stockdAIClient = {
    invokeCopilot,
    sendChatMessage,
    getPricingInsights,
    confirmPendingAction
  };
})();
