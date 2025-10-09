let alchemystInjectionInProgress = false;
let alchemystPort = null;
let nextMessageId = 1;

// Ensure React-controlled inputs update correctly
function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value')?.set;
  const prototype = element.__proto__;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function getPromptText(el) {
  if (!el) return "";
  if (el.tagName === 'TEXTAREA' || typeof el.value === 'string') {
    return (el.value || '').trim();
  }
  const text = (el.value ?? el.textContent ?? el.innerText ?? '');
  return String(text).trim();
}

function setPromptText(el, value) {
  if (!el) return;
  if (el.tagName === 'TEXTAREA' || typeof el.value === 'string') {
    setNativeValue(el, value);
    return;
  }
  // contenteditable or other elements
  el.textContent = value;
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { }
}

function getPort() {
  if (!alchemystPort) {
    try {
      alchemystPort = chrome.runtime.connect({ name: "alchemyst" });
      alchemystPort.onDisconnect.addListener(() => {
        alchemystPort = null;
      });
    } catch (_) {
      alchemystPort = null;
    }
  }
  return alchemystPort;
}

function fetchContextViaPort(query) {
  return new Promise((resolve, reject) => {
    const port = getPort();
    if (!port) {
      reject(new Error("no-port"));
      return;
    }
    const id = nextMessageId++;
    const onMsg = (msg) => {
      if (msg?.id !== id) return;
      port.onMessage.removeListener(onMsg);
      resolve(msg);
    };
    port.onMessage.addListener(onMsg);
    port.postMessage({ type: "fetchContext", id, query });
    setTimeout(() => {
      try { port.onMessage.removeListener(onMsg); } catch (_) { }
      resolve({ error: "timeout" });
    }, 8000);
  });
}

document.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    const inputEl = document.querySelector('#prompt-textarea') || document.querySelector('textarea') || document.querySelector('[contenteditable="true"]');
    if (!inputEl) return;

    const query = getPromptText(inputEl);
    if (!query) return;

    if (alchemystInjectionInProgress) {
      // Allow the natural submit after we've injected once
      alchemystInjectionInProgress = false;
      return;
    }

    e.preventDefault(); // Stop immediate send

    let response = null;
    try {
      // Try long-lived port first
      response = await fetchContextViaPort(query);
      if (response?.error) {
        // Fallback to runtime messaging
        await chrome.runtime.sendMessage({ type: "ping" }).catch(() => { });
        response = await chrome.runtime.sendMessage({ type: "fetchContext", query });
      }
    } catch (err) {
      // Messaging failed → fallback to sending original query
      setPromptText(inputEl, query);
      alchemystInjectionInProgress = true;
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        which: 13,
        bubbles: true
      });
      inputEl.dispatchEvent(enterEvent);
      return;
    }

    const submit = () => {
      const btn = document.getElementById('composer-submit-button') || document.querySelector('#composer-submit-button');
      alchemystInjectionInProgress = true;
      if (btn) { btn.click(); return; }
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
      inputEl.dispatchEvent(enterEvent);
    };

    if (response?.context) {
      const processed = response.context || "";
      const enriched = `\n\nThe context of the conversation is:\n\n\`\`\`\n${processed}\n\`\`\`\n\nThe user query is:\n\`\`\`\n${query}\n\`\`\``;
      setPromptText(inputEl, enriched);
      submit();
    } else {
      // fallback - send original query if no context
      setPromptText(inputEl, query);
      submit();
    }
  }
});

// Periodic ping to keep SW active
setInterval(() => {
  try { chrome.runtime.sendMessage({ type: 'keepAlive' }).catch(() => { }); } catch (_) { }
}, 30000);

// Inject logo button next to the voice icon
(function injectLogoButton() {
  const BTN_ID = 'alchemyst-logo-button';
  const VOICE_CONTAINER_SELECTOR = '[data-testid="composer-speech-button-container"]';
  const DICTATE_BUTTON_SELECTOR = 'button[aria-label="Dictate button"]';
  const CLAUDE_INPUT_AREA_SELECTOR = '[data-supermemory-icon-added="true"]';
  const MEMORY_STATE_KEY = 'alchemyst_memory_enabled';

  function ensureButton() {
    try {
      // Check if we're on Claude.ai
      const windowUrl = window.location.hostname;

      let target, parentFlex;

      if (windowUrl.includes('claude.ai')) {
        // Claude.ai: Insert in the input area next to existing icons
        const claudeInputArea = document.querySelector(CLAUDE_INPUT_AREA_SELECTOR);
        if (!claudeInputArea) return;
        target = claudeInputArea;
        parentFlex = claudeInputArea.parentElement;
      } else if (windowUrl.includes('chatgpt.com') || windowUrl.includes('chat.openai.com')) {
        // ChatGPT: Prefer to insert before the Dictate button; fallback to the voice container
        const dictateBtn = document.querySelector(DICTATE_BUTTON_SELECTOR);
        const voiceContainer = document.querySelector(VOICE_CONTAINER_SELECTOR);
        const dictateWrapper = dictateBtn ? (dictateBtn.closest('span') || dictateBtn) : null;
        parentFlex = (voiceContainer && voiceContainer.parentElement) || (dictateWrapper && dictateWrapper.parentElement);
        target = dictateWrapper || voiceContainer;
      }

      if (!parentFlex || !target) return;

      // If already present, exit
      if (document.getElementById(BTN_ID)) return;

      const parent = parentFlex; // row container where the controls live

      const imgSrc = chrome.runtime.getURL('images/logo.png');
      const wrapper = document.createElement('div');
      wrapper.id = BTN_ID;
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.justifyContent = 'center';
      wrapper.style.width = '36px';
      wrapper.style.height = '36px';
      wrapper.style.cursor = 'pointer';
      wrapper.style.borderRadius = '50%';
      wrapper.style.transition = 'opacity 0.2s';
      wrapper.style.opacity = '1';
      // Load initial state
      const isEnabled = localStorage.getItem(MEMORY_STATE_KEY) === 'true';
      wrapper.title = isEnabled ? 'Memory ON - Click to disable' : 'Memory OFF - Click to enable';
      wrapper.setAttribute('aria-label', 'Alchemyst Memory');
      wrapper.setAttribute('role', 'button');
      wrapper.setAttribute('tabindex', '0');
      wrapper.setAttribute('data-memory-enabled', isEnabled.toString());

      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = 'Alchemyst';
      img.width = 20;
      img.height = 20;
      img.style.borderRadius = '50%';
      img.title = 'Alchemyst Memory';

      wrapper.appendChild(img);

      // Robust tooltip rendered in document.body to avoid overflow clipping
      function getGlobalTooltip() {
        let tip = document.getElementById('alchemyst-global-tooltip');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'alchemyst-global-tooltip';
          tip.style.position = 'fixed';
          tip.style.whiteSpace = 'nowrap';
          tip.style.fontSize = '12px';
          tip.style.lineHeight = '14px';
          tip.style.padding = '6px 8px';
          tip.style.borderRadius = '6px';
          tip.style.background = 'rgba(0,0,0,0.85)';
          tip.style.color = '#fff';
          tip.style.pointerEvents = 'none';
          tip.style.opacity = '0';
          tip.style.transition = 'opacity 120ms ease';
          tip.style.zIndex = '2147483647';
          tip.style.visibility = 'hidden';
          document.body.appendChild(tip);
        }
        return tip;
      }

      function showGlobalTooltip(anchorEl, text) {
        const tip = getGlobalTooltip();
        tip.textContent = text;
        const rect = anchorEl.getBoundingClientRect();
        const gap = 8;
        const top = Math.max(0, rect.top - gap - 28); // place above
        const left = Math.min(window.innerWidth - 8, Math.max(8, rect.left + rect.width / 2));
        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
        tip.style.transform = 'translateX(-50%)';
        tip.style.visibility = 'visible';
        tip.style.opacity = '1';
      }

      function hideGlobalTooltip() {
        const tip = document.getElementById('alchemyst-global-tooltip');
        if (tip) { tip.style.opacity = '0'; tip.style.visibility = 'hidden'; }
      }

      // Update visual state
      function updateButtonState(enabled) {
        wrapper.setAttribute('data-memory-enabled', enabled.toString());
        wrapper.title = enabled ? 'Memory ON - Click to disable' : 'Memory OFF - Click to enable';
        wrapper.style.opacity = enabled ? '1' : '0.6';
        wrapper.style.filter = enabled ? 'none' : 'grayscale(0.3)';
      }

      const showTip = () => {
        const enabled = wrapper.getAttribute('data-memory-enabled') === 'true';
        const tooltipText = enabled ? 'Alchemyst Memory ON' : 'Alchemyst Memory OFF';
        showGlobalTooltip(wrapper, tooltipText);
      };
      const hideTip = () => hideGlobalTooltip();
      wrapper.addEventListener('mouseenter', showTip);
      wrapper.addEventListener('mouseleave', hideTip);
      wrapper.addEventListener('focusin', showTip);
      wrapper.addEventListener('focusout', hideTip);

      // Toggle functionality
      wrapper.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const currentState = wrapper.getAttribute('data-memory-enabled') === 'true';
        const newState = !currentState;
        localStorage.setItem(MEMORY_STATE_KEY, newState.toString());
        updateButtonState(newState);
        // Emit custom event for other scripts to listen
        window.postMessage({ type: 'ALCHEMYST_MEMORY_TOGGLE', enabled: newState }, '*');
        console.log('Alchemyst Memory:', newState ? 'ENABLED' : 'DISABLED');
      });

      // Initialize with current state
      updateButtonState(isEnabled);

      // Insert based on platform
      if (windowUrl.includes('claude.ai')) {
        // Claude: Insert after the existing input area
        parent.insertBefore(wrapper, target.nextSibling);
      } else if (windowUrl.includes('chatgpt.com') || windowUrl.includes('chat.openai.com')) {
        // ChatGPT: Insert before the target control (Dictate button wrapper preferred)
        parent.insertBefore(wrapper, target);
      }

      // Click handler – emit a custom event the inpage script could listen to if needed
      wrapper.addEventListener('click', () => {
        window.postMessage({ type: 'ALCHEMYST_LOGO_CLICK' }, '*');
      });
    } catch (_) { }
  }

  // Initial attempt
  const start = Date.now();
  const tryInject = () => {
    ensureButton();
    if (!document.getElementById(BTN_ID) && Date.now() - start < 10000) {
      requestAnimationFrame(tryInject);
    }
  };
  tryInject();

  // Observe DOM changes to re-inject if ChatGPT re-renders the toolbar
  const obs = new MutationObserver(() => {
    ensureButton();
  });
  try {
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) { }
})();

// Store API key globally for inpage script access
let globalApiKey = null;

// Request deduplication
const pendingRequests = new Map();

// Load API key synchronously
(async () => {
  try {
    const { alchemystApiKey } = await chrome.storage.local.get("alchemystApiKey");
    globalApiKey = alchemystApiKey;
    // Also store in localStorage for inpage script access
    if (alchemystApiKey) {
      localStorage.setItem('alchemystApiKey', alchemystApiKey);
    }
    console.log('Alchemyst: API key cached:', globalApiKey ? 'found' : 'not found');
  } catch (err) {
    console.log('Alchemyst: failed to load API key:', err);
  }
})();

// Inject in-page hook and bridge messages for context fetch
(function injectInpage() {
  try {
    const url = chrome.runtime.getURL('inpage.js');
    const s = document.createElement('script');
    s.src = url;
    s.async = false;
    s.crossOrigin = 'anonymous';
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => { s.remove(); };
  } catch (_) { }

  // Bridge messages between page and extension for context fetch
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'ALCHEMYST_CONTEXT_REQUEST') return;
    console.log('Alchemyst: content script received context request:', data.query);

    try {
      const raw = String(data.query || '');
      const query = raw.trim();
      console.log('Alchemyst: content script making API call for query:', query);

      // Check if memory is enabled
      const memoryEnabled = localStorage.getItem('alchemyst_memory_enabled') === 'true';
      if (!memoryEnabled) {
        console.log('Alchemyst: Memory is disabled, skipping context fetch');
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
        return;
      }

      // Ignore empty queries (common for /prepare calls)
      if (!query) {
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
        return;
      }

      // Check if we already have a pending request for this query
      if (pendingRequests.has(query)) {
        console.log('Alchemyst: request already pending for query:', query);
        // Wait for the existing request to complete
        try {
          const result = await pendingRequests.get(query);
          window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: result }, '*');
        } catch (err) {
          window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
        }
        return;
      }

      // Use cached API key
      if (!globalApiKey) {
        console.log('Alchemyst: no cached API key found, trying to load from storage...');
        try {
          const { alchemystApiKey } = await chrome.storage.local.get("alchemystApiKey");
          if (alchemystApiKey) {
            globalApiKey = alchemystApiKey;
            localStorage.setItem('alchemystApiKey', alchemystApiKey);
            console.log('Alchemyst: API key loaded from storage');
          } else {
            console.log('Alchemyst: no API key in storage');
            window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
            return;
          }
        } catch (err) {
          console.log('Alchemyst: failed to load API key from storage:', err);
          window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
          return;
        }
      }

      // Create a promise for this request and store it
      const requestPromise = (async () => {
        try {
          console.log('Alchemyst: requesting context from background script');

          // Use persistent port connection instead of sendMessage
          return new Promise((resolve, reject) => {
            const port = chrome.runtime.connect({ name: 'alchemyst' });

            // Set up response handler
            port.onMessage.addListener((response) => {
              console.log('Alchemyst: received response from background script via port:', response);

              // Check if this response is for our request
              if (response.id === requestId) {
                port.disconnect();

                if (response && response.context) {
                  console.log('Alchemyst: API call successful, context:', response.context);
                  resolve(response.context);
                } else if (response && response.error) {
                  console.log('Alchemyst: API call failed:', response.error);
                  resolve('');
                } else {
                  console.log('Alchemyst: no response from background script');
                  resolve('');
                }
              } else {
                console.log('Alchemyst: received response for different request ID:', response.id, 'expected:', requestId);
              }
            });

            // Set up error handler
            port.onDisconnect.addListener(() => {
              console.log('Alchemyst: port disconnected');
              resolve('');
            });

            // Generate unique ID for this request
            const requestId = Date.now() + Math.random();

            // Send the request
            console.log('Alchemyst: sending fetchContext message via port with ID:', requestId);
            port.postMessage({
              type: 'fetchContext',
              query: query,
              id: requestId
            });

            // Timeout after 10 seconds
            setTimeout(() => {
              console.log('Alchemyst: port request timeout');
              port.disconnect();
              resolve('');
            }, 60_000);
          });
        } catch (err) {
          console.log('Alchemyst: background script call failed:', err);
          return '';
        }
      })();

      // Store the promise for deduplication
      pendingRequests.set(query, requestPromise);

      try {
        const result = await requestPromise;
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: result }, '*');
      } finally {
        // Clean up the pending request
        pendingRequests.delete(query);
      }
      return;
    } catch (err) {
      console.log('Alchemyst: content script context fetch failed:', err);
      window.postMessage({ type: 'ALCHEMYST_CONTEXT_REPLY', payload: '' }, '*');
    }
  });
})();

