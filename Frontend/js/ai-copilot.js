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
    trigger.title = 'Open AI Assistant';
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

  // ─── Send Message ────────────────────────────────────────────

  async function sendMessage(text) {
    if (!text.trim() || isLoading) return;

    const input = document.getElementById('ai-input');
    input.value = '';

    // Remove welcome message if present
    const welcome = document.querySelector('.ai-welcome');
    if (welcome) welcome.remove();

    // Add user message
    addMessage('user', text);

    // Show loading
    isLoading = true;
    const loadingId = addMessage('ai', '', true);

    try {
      // Check if Gemini is configured
      if (typeof GEMINI_API_KEY === 'undefined' || GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
        throw new Error('Please add your Gemini API key to config.js');
      }

      if (!geminiChat) {
        throw new Error('AI chat not initialized');
      }

      const response = await geminiChat.sendMessage(text);

      // Remove loading message
      removeMessage(loadingId);

      // Add AI response
      if (response.error) {
        addMessage('ai', `⚠️ ${response.text}`, false, true);
      } else {
        addMessage('ai', response.text);
      }
    } catch (error) {
      removeMessage(loadingId);
      addMessage('ai', `⚠️ ${error.message}`, false, true);
    }

    isLoading = false;
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

    // Convert markdown-like formatting
    return text
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Bullet points
      .replace(/^[•\-\*]\s+(.*)$/gm, '<li>$1</li>')
      // Wrap consecutive li in ul
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      // Line breaks
      .replace(/\n/g, '<br>');
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
