(function () {
  // Match ChatGPT conversation POST and Claude completion endpoint
  const CHATGPT_ENDPOINT_REGEX = /\/backend-api\/f\/conversation(?:\?|$)/;
  const CLAUDE_ENDPOINT_REGEX = /\/api\/organizations\/[^\/]+\/chat_conversations\/[^\/]+\/completion$/;
  
  function shouldInterceptChatGPT(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && CHATGPT_ENDPOINT_REGEX.test(url);
      if (should) console.log('Alchemyst: intercepting ChatGPT request to', url);
      return should;
    } catch (_) { return false; }
  }
  
  function shouldInterceptClaude(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && CLAUDE_ENDPOINT_REGEX.test(url);
      if (should) console.log('Alchemyst: intercepting Claude request to', url);
      return should;
    } catch (_) { return false; }
  }

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
    return shouldInterceptChatGPT(input, init) || shouldInterceptClaude(input, init);
  }

  async function enrichPayload(bodyText, url) {
    try {
      console.log('Alchemyst: enriching payload');
      const payload = JSON.parse(bodyText);
      
      // Extract user text based on platform
      let userText = '';
      if (url && CHATGPT_ENDPOINT_REGEX.test(url)) {
        // ChatGPT format
        const userMsg = payload?.messages?.find(m => m?.author?.role === 'user');
        userText = userMsg?.content?.parts?.join('\n') || '';
      } else if (url && CLAUDE_ENDPOINT_REGEX.test(url)) {
        // Claude format
        userText = payload?.prompt || '';
      }
      
      console.log('Alchemyst: user text:', userText);

      // Skip enrichment for empty prompts
      if (!String(userText).trim()) {
        return JSON.stringify(payload);
      }

      // Check if memory is enabled
      const memoryEnabled = localStorage.getItem('alchemyst_memory_enabled') === 'true';
      if (!memoryEnabled) {
        console.log('Alchemyst: Memory is disabled, skipping context enrichment');
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
        
        // Apply enrichment based on platform
        if (url && CHATGPT_ENDPOINT_REGEX.test(url)) {
          // ChatGPT format
          const userMsg = payload?.messages?.find(m => m?.author?.role === 'user');
          if (userMsg?.content?.parts && Array.isArray(userMsg.content.parts)) {
            userMsg.content.parts = [enriched];
          }
        } else if (url && CLAUDE_ENDPOINT_REGEX.test(url)) {
          // Claude format
          payload.prompt = enriched;
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
        const url = extractUrl(input, init);
        // If init is provided and has a string body
        if (init && typeof init.body === 'string') {
          const newBody = await enrichPayload(init.body, url);
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
              const newBody = await enrichPayload(bodyText, url);
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
    if (this.__alch_url && typeof this.__alch_url === 'string' && shouldIntercept(this.__alch_url, null) && body) {
      try {
        const proceed = async () => {
          const newBody = await enrichPayload(typeof body === 'string' ? body : body, this.__alch_url);
          return origSend.call(this, newBody);
        };
        return proceed();
      } catch (_) { /* fallthrough */ }
    }
    return origSend.apply(this, arguments);
  };
})();