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

