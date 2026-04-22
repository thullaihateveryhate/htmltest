// ═══════════════════════════════════════════════════════════════
// ai-copilot.js — AI Copilot UI Component
// Glassmorphic chat panel with floating trigger button
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────
  let isOpen = false;
  let isLoading = false;
  let messages = [];
  let pendingAction = null;
  let pendingActionCardId = null;

  function getAIClient() {
    if (!window.stockdAIClient || typeof window.stockdAIClient.sendChatMessage !== 'function') {
      throw new Error('Copilot client is not available on this page.');
    }

    return window.stockdAIClient;
  }

  function truncateText(text, maxLength = 600) {
    if (typeof text !== 'string') return '';
    return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
  }

  function buildRequestContext() {
    const fileName = window.location.pathname.split('/').pop() || '';
    const page = fileName.replace(/\.html$/i, '') || 'unknown';

    return {
      source: 'copilot_panel',
      page,
      page_title: document.title || '',
      pathname: window.location.pathname,
      conversation: messages.slice(-8).map(msg => ({
        role: msg.role,
        text: truncateText(msg.text)
      }))
    };
  }

  function setComposerDisabled(disabled) {
    const input = document.getElementById('ai-input');
    const sendButton = document.getElementById('ai-send');

    if (input) input.disabled = disabled;
    if (sendButton) sendButton.disabled = disabled;
  }

  function setPendingActionButtonsDisabled(disabled) {
    if (!pendingActionCardId) return;

    const card = document.getElementById(pendingActionCardId);
    if (!card) return;

    const buttons = card.querySelectorAll('button');
    buttons.forEach((button) => {
      button.disabled = disabled;
    });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── DOM Creation ────────────────────────────────────────────

  function createCopilotUI() {
    // Floating trigger button
    const trigger = document.createElement('button');
    trigger.id = 'ai-copilot-trigger';
    trigger.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
      </svg>
    `;
    trigger.title = 'Open Copilot';
    trigger.onclick = togglePanel;

    // Only show floating button on Dashboard
    if (!window.location.href.includes('dashboard.html')) {
      trigger.style.display = 'none';
    }

    // Chat panel
    const panel = document.createElement('div');
    panel.id = 'ai-copilot-panel';
    panel.className = 'ai-panel-closed';
    panel.innerHTML = `
      <div class="ai-panel-header">
        <div class="ai-panel-brand">
          <div class="ai-panel-icon">✨</div>
          <div>
            <div class="ai-panel-title">Stockd AI</div>
            <div class="ai-panel-subtitle">Your intelligent assistant</div>
          </div>
        </div>
        <button class="ai-panel-close" onclick="toggleAIPanel()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
      
      <div class="ai-panel-messages" id="ai-messages">
        <div class="ai-welcome">
          <div class="ai-welcome-icon">🍕</div>
          <h3>Hey there!</h3>
          <p>I can help you with inventory, forecasting, and business analytics. Try asking:</p>
          <div class="ai-suggestions">
            <button class="ai-suggestion" onclick="sendAISuggestion('What\\'s running low?')">What's running low?</button>
            <button class="ai-suggestion" onclick="sendAISuggestion('How did we do last week?')">How did we do last week?</button>
            <button class="ai-suggestion" onclick="sendAISuggestion('Show me the forecast')">Show me the forecast</button>
          </div>
        </div>
      </div>
      
      <div class="ai-panel-input">
        <input type="text" id="ai-input" placeholder="Ask me anything..." autocomplete="off" />
        <button id="ai-send" onclick="sendAIMessage()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z"/>
          </svg>
        </button>
      </div>
    `;

    document.body.appendChild(trigger);
    document.body.appendChild(panel);

    // Event listeners
    const input = document.getElementById('ai-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAIMessage();
      }
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        togglePanel();
      }
    });
  }

  // ─── Panel Toggle ────────────────────────────────────────────

  function togglePanel() {
    const panel = document.getElementById('ai-copilot-panel');
    const trigger = document.getElementById('ai-copilot-trigger');

    isOpen = !isOpen;

    if (isOpen) {
      panel.className = 'ai-panel-open';
      trigger.classList.add('active');
      document.getElementById('ai-input').focus();
    } else {
      panel.className = 'ai-panel-closed';
      trigger.classList.remove('active');
    }
  }

  function removePendingActionCard() {
    if (!pendingActionCardId) return;

    const card = document.getElementById(pendingActionCardId);
    if (card) card.remove();
    pendingActionCardId = null;
  }

  function clearPendingAction(options) {
    const settings = options || {};

    if (settings.message) {
      addMessage('ai', settings.message);
      messages.push({ role: 'assistant', text: settings.message });
    }

    pendingAction = null;
    removePendingActionCard();
  }

  function buildConfirmationErrorMessage(error) {
    const code = error && typeof error.code === 'string' ? error.code : '';
    const message = error && typeof error.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'Unable to confirm that action right now.';

    if (code === 'pending_action_expired') {
      return `${message} No changes were made. Ask Copilot again if you still want to apply it.`;
    }

    if (
      code === 'invalid_pending_action' ||
      code === 'invalid_pending_action_signature' ||
      code === 'invalid_pending_action_timestamps' ||
      code === 'unexpected_pending_action' ||
      code === 'unsupported_pending_action'
    ) {
      return `${message} No changes were made. Please ask Copilot to prepare the action again.`;
    }

    if (code === 'missing_action_secret') {
      return `${message} No changes were made.`;
    }

    return `${message} No changes were made.`;
  }

  function showPendingActionPrompt(action) {
    const summary = action && typeof action.summary === 'string' && action.summary.trim()
      ? action.summary.trim()
      : 'Confirm this inventory update before continuing.';

    pendingAction = action;
    removePendingActionCard();

    const container = document.getElementById('ai-messages');
    const id = 'pending-' + Date.now();
    pendingActionCardId = id;

    const card = document.createElement('div');
    card.id = id;
    card.className = 'ai-message ai-message-ai';
    card.innerHTML = `
      <div class="ai-message-content">
        <div style="border:1px solid rgba(255,255,255,0.12); border-radius:14px; padding:14px; background:rgba(255,255,255,0.04);">
          <div style="font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#FBBF24; font-weight:700; margin-bottom:6px;">
            Confirmation Required
          </div>
          <div style="font-size:14px; line-height:1.45; margin-bottom:12px;">${escapeHtml(summary)}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" data-action="confirm" style="background:#10B981; color:#04130D; border:none; border-radius:10px; padding:8px 12px; font-weight:700; cursor:pointer;">
              Confirm
            </button>
            <button type="button" data-action="cancel" style="background:transparent; color:#E5E7EB; border:1px solid rgba(255,255,255,0.16); border-radius:10px; padding:8px 12px; font-weight:600; cursor:pointer;">
              Cancel
            </button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(card);
    container.scrollTop = container.scrollHeight;

    const confirmButton = card.querySelector('button[data-action="confirm"]');
    const cancelButton = card.querySelector('button[data-action="cancel"]');

    if (confirmButton) {
      confirmButton.addEventListener('click', confirmPendingInventoryAction);
    }

    if (cancelButton) {
      cancelButton.addEventListener('click', cancelPendingInventoryAction);
    }
  }

  async function confirmPendingInventoryAction() {
    if (!pendingAction || isLoading) return;

    isLoading = true;
    setComposerDisabled(true);
    setPendingActionButtonsDisabled(true);

    const loadingId = addMessage('ai', '', true);
    const requestContext = buildRequestContext();

    try {
      const response = await getAIClient().confirmPendingAction(pendingAction, {
        ...requestContext,
        source: 'copilot_panel_confirmation',
        pending_action_tool: pendingAction.tool_name || null
      });

      removeMessage(loadingId);
      removePendingActionCard();
      const replyText = response.reply || 'Done.';
      addMessage('ai', replyText);
      messages.push({ role: 'assistant', text: replyText });
      pendingAction = null;
    } catch (error) {
      removeMessage(loadingId);
      const errorMessage = buildConfirmationErrorMessage(error);
      pendingAction = null;
      removePendingActionCard();
      addMessage('ai', `⚠️ ${errorMessage}`, false, true);
    } finally {
      isLoading = false;
      setComposerDisabled(false);

      const input = document.getElementById('ai-input');
      if (input) input.focus();
    }
  }

  function cancelPendingInventoryAction() {
    if (!pendingAction) return;

    clearPendingAction({
      message: "Okay, I won't make that change."
    });
  }

  // ─── Send Message ────────────────────────────────────────────

  async function sendMessage(text) {
    const trimmedText = text.trim();
    if (!trimmedText || isLoading) return;

    if (pendingAction) {
      clearPendingAction();
    }

    const input = document.getElementById('ai-input');
    input.value = '';

    // Remove welcome message if present
    const welcome = document.querySelector('.ai-welcome');
    if (welcome) welcome.remove();

    // Add user message
    addMessage('user', trimmedText);

    // Show loading
    isLoading = true;
    setComposerDisabled(true);
    const loadingId = addMessage('ai', '', true);
    const requestContext = buildRequestContext();

    try {
      const response = await getAIClient().sendChatMessage(trimmedText, requestContext);
      const replyText = response.reply || 'I could not generate a reply.';

      // Remove loading message
      removeMessage(loadingId);

      // Add AI response
      addMessage('ai', replyText);

      messages.push({ role: 'user', text: trimmedText });
      messages.push({ role: 'assistant', text: replyText });

      if (
        response &&
        response.data &&
        response.data.requires_confirmation === true &&
        response.data.pending_action
      ) {
        showPendingActionPrompt(response.data.pending_action);
      }
    } catch (error) {
      removeMessage(loadingId);
      const errorMessage = error && typeof error.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Copilot is unavailable right now. Please try again.';
      addMessage('ai', `⚠️ ${errorMessage}`, false, true);
    } finally {
      isLoading = false;
      setComposerDisabled(false);
      if (input) input.focus();
    }
  }

  function addMessage(role, text, isLoading = false, isError = false) {
    const container = document.getElementById('ai-messages');
    const id = 'msg-' + Date.now();

    const msg = document.createElement('div');
    msg.id = id;
    msg.className = `ai-message ai-message-${role}${isError ? ' ai-message-error' : ''}`;

    if (isLoading) {
      msg.innerHTML = `
        <div class="ai-typing">
          <span></span><span></span><span></span>
        </div>
      `;
    } else {
      // Parse markdown-like formatting
      const formattedText = formatMessage(text);
      msg.innerHTML = `<div class="ai-message-content">${formattedText}</div>`;
    }

    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;

    return id;
  }

  function removeMessage(id) {
    const msg = document.getElementById(id);
    if (msg) msg.remove();
  }

  function formatMessage(text) {
    if (!text) return '';

    const escaped = escapeHtml(text);
    const withBold = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    const lines = withBold.split('\n');

    let html = '';
    let inList = false;

    lines.forEach(line => {
      const bulletMatch = line.match(/^\s*[•\-\*]\s+(.*)$/);

      if (bulletMatch) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        html += `<li>${bulletMatch[1]}</li>`;
        return;
      }

      if (inList) {
        html += '</ul>';
        inList = false;
      }

      if (line.trim()) {
        html += `<div>${line}</div>`;
      } else {
        html += '<br>';
      }
    });

    if (inList) {
      html += '</ul>';
    }

    return html;
  }

  // ─── Global Functions ────────────────────────────────────────

  window.toggleAIPanel = togglePanel;
  window.sendAIMessage = () => {
    const input = document.getElementById('ai-input');
    sendMessage(input.value);
  };
  window.sendAISuggestion = (text) => {
    sendMessage(text);
  };

  // ─── Initialize ──────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createCopilotUI);
  } else {
    createCopilotUI();
  }

})();
