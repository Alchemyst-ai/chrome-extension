(function () {
  // Match ChatGPT conversation POST, Claude completion endpoint, Gemini StreamGenerate, v0 chat API, Lovable chat API, Perplexity ask endpoint, and Bolt endpoints
  const CHATGPT_ENDPOINT_REGEX = /\/backend-api\/f\/conversation(?:\?|$)/;
  const CLAUDE_ENDPOINT_REGEX = /\/api\/organizations\/[^\/]+\/chat_conversations\/[^\/]+\/completion$/;
  const GEMINI_ENDPOINT_REGEX = /\/_\/BardChatUi\/data\/assistant\.lamda\.BardFrontendService\/StreamGenerate/;
  const V0_ENDPOINT_REGEX = /\/chat\/api\/chat$/;
  const LOVABLE_ENDPOINT_REGEX = /\/projects\/([a-f0-9-]+)\/chat$/;
  const PERPLEXITY_ENDPOINT_REGEX = /\/rest\/sse\/perplexity_ask$/;
  const BOLT_ENDPOINT_REGEX = /\/api\/chat\/v2(?:\?|$)/;
  
  function shouldInterceptChatGPT(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && CHATGPT_ENDPOINT_REGEX.test(url);
      // Intercepting ChatGPT request
      return should;
    } catch (_) { return false; }
  }
  
  function shouldInterceptClaude(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && CLAUDE_ENDPOINT_REGEX.test(url);
      // Intercepting Claude request
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptGemini(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && GEMINI_ENDPOINT_REGEX.test(url);
      // Intercepting Gemini request
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptV0(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && V0_ENDPOINT_REGEX.test(url);
      // Intercepting v0 request
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptLovable(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && LOVABLE_ENDPOINT_REGEX.test(url);
      // Intercepting Lovable request
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptPerplexity(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && PERPLEXITY_ENDPOINT_REGEX.test(url);
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptBolt(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && BOLT_ENDPOINT_REGEX.test(url);
      return should;
    } catch (_) { return false; }
  }

  // Get API key from localStorage
  const apiKey = localStorage.getItem('alchemystApiKey');

  function extractUrl(input, init) {
    try {
      if (typeof input === 'string') return input;
      // Support URL objects
      if (input instanceof URL) return input.toString();
      if (input && typeof input.url === 'string') return input.url;
      if (init && typeof init.url === 'string') return init.url;
    } catch (_) { }
    return '';
  }

  function shouldIntercept(input, init) {
    return shouldInterceptChatGPT(input, init) || shouldInterceptClaude(input, init) || shouldInterceptGemini(input, init) || shouldInterceptV0(input, init) || shouldInterceptLovable(input, init) || shouldInterceptPerplexity(input, init) || shouldInterceptBolt(input, init);
  }

  function handleSSEIfApplicable(response, url) {
    try {
      const contentType = response && response.headers && response.headers.get && response.headers.get('content-type');
      if (contentType && contentType.includes('text/event-stream')) {
        const originalBody = response.body;
        if (!originalBody || !originalBody.getReader) return response;
        const reader = originalBody.getReader();
        const stream = new ReadableStream({
          start(controller) {
            const decoder = new TextDecoder();
            (function pump() {
              reader.read().then(({ done, value }) => {
                if (done) { controller.close(); return; }
                try {
                  const text = decoder.decode(value, { stream: true });
                  try { window.postMessage({ type: 'ALCHEMYST_SSE_CHUNK', url, chunk: text }, '*'); } catch (_) { }
                } catch (_) { }
                try { controller.enqueue(value); } catch (_) { }
                pump();
              }).catch((e) => { try { controller.error(e); } catch (_) { } });
            })();
          }
        });
        return new Response(stream, { headers: response.headers, status: response.status, statusText: response.statusText });
      }
    } catch (_) { }
    return response;
  }

  async function enrichPayload(bodyText, url) {
    try {
      // Enriching payload
      
      // Extract user text based on platform
      let userText = '';
      let isGemini = false;
      
      if (url && GEMINI_ENDPOINT_REGEX.test(url)) {
        // Gemini format (form-encoded with double JSON stringification)
        isGemini = true;
        try {
          // Parse the form data to extract f.req parameter
          const params = new URLSearchParams(bodyText);
          const fReq = params.get('f.req');
          if (fReq) {
            // First level of JSON parsing
            const firstParse = JSON.parse(fReq);
            // Second level - the actual message array is in firstParse[1]
            if (firstParse && firstParse[1]) {
              const messageParse = JSON.parse(firstParse[1]);
              // The user prompt is typically the first element in the array
              if (Array.isArray(messageParse) && messageParse[0]) {
                userText = Array.isArray(messageParse[0]) ? messageParse[0][0] : messageParse[0];
              }
            }
          }
        } catch (e) {
          // Failed to parse Gemini payload
        }
      } else {
        // ChatGPT, Claude, v0, Lovable, Perplexity, or Bolt format (JSON payload)
        const payload = JSON.parse(bodyText);
        
        if (url && CHATGPT_ENDPOINT_REGEX.test(url)) {
          // ChatGPT format
          const userMsg = payload?.messages?.find(m => m?.author?.role === 'user');
          userText = userMsg?.content?.parts?.join('\n') || '';
        } else if (url && CLAUDE_ENDPOINT_REGEX.test(url)) {
          // Claude format
          userText = payload?.prompt || '';
        } else if (url && V0_ENDPOINT_REGEX.test(url)) {
          // v0 format
          userText = payload?.messageContent?.parts?.[0]?.content || '';
        } else if (url && LOVABLE_ENDPOINT_REGEX.test(url)) {
          // Lovable format
          userText = payload?.message || '';
        } else if (url && PERPLEXITY_ENDPOINT_REGEX.test(url)) {
          // Perplexity format
          userText = payload?.query_str || payload?.params?.dsl_query || '';
        } else if (url && BOLT_ENDPOINT_REGEX.test(url)) {
          // Bolt chat format - last user message
          const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
          const lastUser = [...msgs].reverse().find(m => m?.role === 'user');
          userText = lastUser?.content || lastUser?.rawContent || '';
        }
      }
      
      // User text extracted

      // Skip enrichment for empty prompts
      if (!String(userText).trim()) {
        return bodyText;
      }

      // Check if memory is enabled
      const memoryEnabled = localStorage.getItem('alchemyst_memory_enabled') === 'true';
      if (!memoryEnabled) {
        // Memory disabled, skipping enrichment
        return bodyText;
      }

      // Request context from content script (which has proper permissions)
      const context = await new Promise((resolve) => {
        const replyHandler = (event) => {
          if (event.source !== window) return;
          const data = event.data;
          if (data && data.type === 'ALCHEMYST_CONTEXT_REPLY') {
            window.removeEventListener('message', replyHandler);
            // Context received
            resolve(data.payload || '');
          }
        };
        window.addEventListener('message', replyHandler);
        window.postMessage({ type: 'ALCHEMYST_CONTEXT_REQUEST', query: userText }, '*');
        setTimeout(() => {
          window.removeEventListener('message', replyHandler);
          // Context timeout
          resolve('');
        }, 30_000);
      });

      if (context) {
        const enriched = `\n\nThe context of the conversation is:\n\n\`\`\`\n${context}\n\`\`\`\n\nThe user query is:\n\`\`\`\n${userText}\n\`\`\``;
        // Message enriched
        
        // Apply enrichment based on platform
        if (isGemini) {
          // Gemini format - reconstruct the form data with enriched message
          try {
            const params = new URLSearchParams(bodyText);
            const fReq = params.get('f.req');
            if (fReq) {
              const firstParse = JSON.parse(fReq);
              if (firstParse && firstParse[1]) {
                const messageParse = JSON.parse(firstParse[1]);
                // Replace the first element (user prompt) with enriched version
                if (Array.isArray(messageParse) && messageParse[0]) {
                  if (Array.isArray(messageParse[0])) {
                    messageParse[0][0] = enriched;
                  } else {
                    messageParse[0] = enriched;
                  }
                }
                // Reconstruct with double JSON stringification
                firstParse[1] = JSON.stringify(messageParse);
                params.set('f.req', JSON.stringify(firstParse));
                return params.toString();
              }
            }
          } catch (e) {
            // Failed to enrich Gemini payload
            return bodyText;
          }
        } else {
          // ChatGPT, Claude, v0, Lovable, Perplexity, or Bolt format
          const payload = JSON.parse(bodyText);
          
          if (url && CHATGPT_ENDPOINT_REGEX.test(url)) {
            // ChatGPT format
            const userMsg = payload?.messages?.find(m => m?.author?.role === 'user');
            if (userMsg?.content?.parts && Array.isArray(userMsg.content.parts)) {
              userMsg.content.parts = [enriched];
            }
          } else if (url && CLAUDE_ENDPOINT_REGEX.test(url)) {
            // Claude format
            payload.prompt = enriched;
          } else if (url && V0_ENDPOINT_REGEX.test(url)) {
            // v0 format
            if (payload?.messageContent?.parts?.[0]) {
              payload.messageContent.parts[0].content = enriched;
            }
          } else if (url && LOVABLE_ENDPOINT_REGEX.test(url)) {
            // Lovable format
            payload.message = enriched;
          } else if (url && PERPLEXITY_ENDPOINT_REGEX.test(url)) {
            // Perplexity format
            payload.query_str = enriched;
            try { if (payload.params && typeof payload.params === 'object') { payload.params.dsl_query = enriched; } } catch (_) { }
          } else if (url && BOLT_ENDPOINT_REGEX.test(url)) {
            // Bolt chat - replace last user content
            const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i] && msgs[i].role === 'user') {
                if (typeof msgs[i].content === 'string') msgs[i].content = enriched;
                if (typeof msgs[i].rawContent === 'string') msgs[i].rawContent = enriched;
                break;
              }
            }
          }
          
          return JSON.stringify(payload);
        }
      }

      return bodyText;
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
        // Intercepting request
        
        // Handle Gemini StreamGenerate requests
        if (url && GEMINI_ENDPOINT_REGEX.test(url)) {
          if (init && init.body instanceof FormData) {
            const formData = init.body;
            try {
              const params = new URLSearchParams();
              for (const [k, v] of formData.entries()) params.append(k, v);
              const original = params.toString();
              const enriched = await enrichPayload(original, url);
              if (typeof enriched === 'string' && enriched !== original) {
                const newParams = new URLSearchParams(enriched);
                const newFReq = newParams.get('f.req');
                if (newFReq) {
                  formData.set('f.req', newFReq);
                  // Gemini FormData enriched
                }
              }
            } catch (e) { 
              // Error enriching Gemini FormData
            }
            // Continue with the original request after enrichment
            return origFetch.call(this, input, init);
          }
        }
        
        // Handle other platforms (ChatGPT, Claude, v0, Lovable, Perplexity) with string body
        if (init && typeof init.body === 'string') {
          const newBody = await enrichPayload(init.body, url);
          if (newBody !== init.body) {
            // Request body enriched
            init = Object.assign({}, init, { body: newBody, method: init.method || 'POST' });
          }
          const resp = await origFetch.call(this, input, init);
          if (url && PERPLEXITY_ENDPOINT_REGEX.test(url)) { return handleSSEIfApplicable(resp, url); }
          return resp;
        }

        // If input is a Request, clone and rewrite
        if (input instanceof Request) {
          const method = (init?.method) || input.method || 'GET';
          if (method.toUpperCase() === 'POST') {
            let bodyText = '';
            try { bodyText = await input.clone().text(); } catch (_) { }
            if (bodyText) {
              const newBody = await enrichPayload(bodyText, url);
              if (newBody !== bodyText) {
                // Request body enriched
                const newReq = new Request(input, { body: newBody, method, headers: input.headers });
                const resp = await origFetch.call(this, newReq, init);
                if (url && PERPLEXITY_ENDPOINT_REGEX.test(url)) { return handleSSEIfApplicable(resp, url); }
                return resp;
              }
            }
          }
        }
      }
    } catch (e) { 
      // Error in fetch interception
    }
    return origFetch.apply(this, arguments);
  };

  // Hook XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__alch_url = url; 
    return origOpen.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__alch_url && typeof this.__alch_url === 'string' && shouldIntercept(this.__alch_url, null) && body) {
      try {
        const proceed = async () => {
          // Intercepting XHR request
          
          // Handle Gemini when body is FormData
          if (GEMINI_ENDPOINT_REGEX.test(this.__alch_url) && body instanceof FormData) {
            try {
              const params = new URLSearchParams();
              for (const [k, v] of body.entries()) params.append(k, v);
              const original = params.toString();
              const enriched = await enrichPayload(original, this.__alch_url);
              if (typeof enriched === 'string' && enriched !== original) {
                const newParams = new URLSearchParams(enriched);
                const newFReq = newParams.get('f.req');
                if (newFReq) {
                  body.set('f.req', newFReq);
                  // Gemini XHR FormData enriched
                }
              }
            } catch (e) { 
              // Error enriching Gemini XHR FormData
            }
            // Continue with the original request after enrichment
            return origSend.call(this, body);
          }
          
          // Handle other platforms with string body
          if (typeof body === 'string') {
            const newBody = await enrichPayload(body, this.__alch_url);
            if (newBody !== body) {
              // XHR body enriched
              return origSend.call(this, newBody);
            }
          }
          
          // If no enrichment occurred, proceed with original body
          return origSend.call(this, body);
        };
        return proceed();
      } catch (e) { 
        // Error in XHR interception
        return origSend.call(this, body);
      }
    }
    return origSend.apply(this, arguments);
  };
})();