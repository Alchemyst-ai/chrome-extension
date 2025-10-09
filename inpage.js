(function () {
  // Match the final conversation POST, but NOT the /prepare preflight
  const ENDPOINT_REGEX = /\/backend-api\/f\/conversation(?:\?|$)/;

  console.log('Alchemyst: inpage.js loaded');

  // Get API key from localStorage
  const apiKey = localStorage.getItem('alchemystApiKey');
  console.log('Alchemyst: API key from localStorage:', apiKey ? 'found' : 'not found');

  function extractUrl(input, init) {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input.url === 'string') return input.url;
      if (init && typeof init.url === 'string') return init.url;
    } catch (_) { }
    return '';
  }

  function shouldIntercept(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && ENDPOINT_REGEX.test(url);
      if (should) console.log('Alchemyst: intercepting request to', url);
      return should;
    } catch (_) { return false; }
  }

  async function enrichPayload(bodyText) {
    try {
      console.log('Alchemyst: enriching payload');
      const payload = JSON.parse(bodyText);
      const userMsg = payload?.messages?.find(m => m?.author?.role === 'user');
      const userText = userMsg?.content?.parts?.join('\n') || '';
      console.log('Alchemyst: user text:', userText);

      // Skip enrichment for empty prompts (e.g., /prepare calls)
      if (!String(userText).trim()) {
        return JSON.stringify(payload);
      }

      // Request context from content script (which has proper permissions)
      const context = await new Promise((resolve) => {
        const replyHandler = (event) => {
          if (event.source !== window) return;
          const data = event.data;
          if (data && data.type === 'ALCHEMYST_CONTEXT_REPLY') {
            window.removeEventListener('message', replyHandler);
            console.log('Alchemyst: received context:', data.payload);
            resolve(data.payload || '');
          }
        };
        window.addEventListener('message', replyHandler);
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REQUEST', query: userText }, '*');
        setTimeout(() => {
          window.removeEventListener('message', replyHandler);
          console.log('Alchemyst: context timeout');
          resolve('');
        }, 30_000);
      });

      if (context) {
        const enriched = `\n\nThe context of the conversation is:\n\n\`\`\`\n${context}\n\`\`\`\n\nThe user query is:\n\`\`\`\n${userText}\n\`\`\``;
        console.log('Alchemyst: enriched message:', enriched);
        if (userMsg?.content?.parts && Array.isArray(userMsg.content.parts)) {
          userMsg.content.parts = [enriched];
        }
      }

      return JSON.stringify(payload);
    } catch (_) {
      return bodyText;
    }
  }

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    try {
      if (shouldIntercept(input, init)) {
        // If init is provided and has a string body
        if (init && typeof init.body === 'string') {
          const newBody = await enrichPayload(init.body);
          init = Object.assign({}, init, { body: newBody, method: init.method || 'POST' });
          return origFetch.call(this, input, init);
        }

        // If input is a Request, clone and rewrite
        if (input instanceof Request) {
          const method = (init?.method) || input.method || 'GET';
          if (method.toUpperCase() === 'POST') {
            let bodyText = '';
            try { bodyText = await input.clone().text(); } catch (_) { }
            if (bodyText) {
              const newBody = await enrichPayload(bodyText);
              const newReq = new Request(input, { body: newBody, method, headers: input.headers });
              return origFetch.call(this, newReq, init);
            }
          }
        }
      }
    } catch (_) { }
    return origFetch.apply(this, arguments);
  };

  // Hook XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__alch_url = url; return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__alch_url && typeof this.__alch_url === 'string' && ENDPOINT_REGEX.test(this.__alch_url) && body) {
      try {
        const proceed = async () => {
          const newBody = await enrichPayload(typeof body === 'string' ? body : body);
          return origSend.call(this, newBody);
        };
        return proceed();
      } catch (_) { /* fallthrough */ }
    }
    return origSend.apply(this, arguments);
  };
})();