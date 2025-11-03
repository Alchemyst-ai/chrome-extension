(function () {
  // Match ChatGPT conversation POST, Claude completion endpoint, Gemini StreamGenerate, v0 chat API, Lovable chat API, Perplexity ask endpoint, and Bolt endpoints
  const CHATGPT_ENDPOINT_REGEX = /\/backend-api\/f\/conversation(?:\?|$)/;
  const CLAUDE_ENDPOINT_REGEX = /\/api\/organizations\/[^\/]+\/chat_conversations\/[^\/]+\/completion$/;
  const GEMINI_ENDPOINT_REGEX = /\/_\/BardChatUi\/data\/assistant\.lamda\.BardFrontendService\/StreamGenerate/;
  const V0_ENDPOINT_REGEX = /\/chat\/api\/chat$/;
  const LOVABLE_ENDPOINT_REGEX = /\/projects\/([a-f0-9-]+)\/chat$/;
  const PERPLEXITY_ENDPOINT_REGEX = /\/rest\/sse\/perplexity_ask$/;
  const BOLT_ENDPOINT_REGEX = /\/api\/chat\/v2(?:\?|$)/;
  const DEEPSEEK_ENDPOINT_REGEX = /\/api\/v0\/chat\/completion$/;
  const I10X_ENDPOINT_REGEX = /https:\/\/backend\.i10x\.ai\/llm$/;
  const COMPAS_ENDPOINT_REGEX = /https:\/\/api\.compasai\.com\/api\/chat\/ai_chat\/?$/;
  
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

  function shouldInterceptDeepSeek(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && DEEPSEEK_ENDPOINT_REGEX.test(url);
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptCompas(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && COMPAS_ENDPOINT_REGEX.test(url);
      return should;
    } catch (_) { return false; }
  }

  function shouldInterceptI10x(input, init) {
    try {
      const url = extractUrl(input, init);
      const should = typeof url === 'string' && I10X_ENDPOINT_REGEX.test(url);
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
    return shouldInterceptChatGPT(input, init) || shouldInterceptClaude(input, init) || shouldInterceptGemini(input, init) || shouldInterceptV0(input, init) || shouldInterceptLovable(input, init) || shouldInterceptPerplexity(input, init) || shouldInterceptBolt(input, init) || shouldInterceptDeepSeek(input, init) || shouldInterceptI10x(input, init) || shouldInterceptCompas(input, init);
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
        } else if (url && DEEPSEEK_ENDPOINT_REGEX.test(url)) {
          // DeepSeek format
          userText = payload?.prompt || '';
        } else if (url && I10X_ENDPOINT_REGEX.test(url)) {
          // i10x.ai format
          userText = payload?.text || '';
        } else if (url && COMPAS_ENDPOINT_REGEX.test(url)) {
          // Compas AI format
          userText = payload?.data?.topic || payload?.message || payload?.data?.message || '';
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
          } else if (url && DEEPSEEK_ENDPOINT_REGEX.test(url)) {
            // DeepSeek format
            payload.prompt = enriched;
          } else if (url && I10X_ENDPOINT_REGEX.test(url)) {
            // i10x.ai format
            payload.text = enriched;
          } else if (url && COMPAS_ENDPOINT_REGEX.test(url)) {
            // Compas AI format
            try { if (payload.data && typeof payload.data === 'object') { payload.data.topic = enriched; } } catch (_) { }
            payload.message = enriched;
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
          if (url && (PERPLEXITY_ENDPOINT_REGEX.test(url) || DEEPSEEK_ENDPOINT_REGEX.test(url))) { return handleSSEIfApplicable(resp, url); }
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
                if (url && (PERPLEXITY_ENDPOINT_REGEX.test(url) || DEEPSEEK_ENDPOINT_REGEX.test(url))) { return handleSSEIfApplicable(resp, url); }
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

  // Hook WebSocket for Manus Socket.IO messages
  if (window.location.hostname.includes('manus.im')) {
    const origWebSocket = window.WebSocket;
    const pendingEnrichments = new Map(); // Track messages being enriched to prevent duplicates
    const recentContent = new Set(); // Track recent message content to catch duplicates with different IDs

    // Cleanup old entries every 30 seconds
    setInterval(() => {
      recentContent.clear();
      // pendingEnrichments will be cleaned as messages complete
    }, 30000);

    window.WebSocket = function(...args) {
      const ws = new origWebSocket(...args);
      const origSend = ws.send.bind(ws);
      
      ws.send = async function(data) {
        try {
          // Check if this is a Manus Socket.IO connection
          const url = args[0];
          if (url && typeof url === 'string' && url.includes('api.manus.im')) {
            // Check if memory is enabled
            const memoryEnabled = localStorage.getItem('alchemyst_memory_enabled') === 'true';
            if (!memoryEnabled) {
              return origSend(data);
            }

            // Parse Socket.IO message format: 42["message",{...}]
            // 4 = MESSAGE, 2 = EVENT
            let messageStr = '';
            if (typeof data === 'string') {
              messageStr = data;
            } else if (data instanceof Blob) {
              messageStr = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsText(data);
              });
            } else if (data instanceof ArrayBuffer) {
              const decoder = new TextDecoder();
              messageStr = decoder.decode(data);
            }

            // Check if this is a Socket.IO event message (starts with 42)
            // Socket.IO packet format: [packetType][packetId][...data]
            // 4 = MESSAGE, 2 = EVENT packet type
            if (messageStr && messageStr.startsWith('42')) {
              try {
                // Extract the JSON array part: ["message", {...}]
                const jsonPart = messageStr.substring(2);
                const payload = JSON.parse(jsonPart);
                
                // Check if this message has a "content" field (any message with content)
                if (Array.isArray(payload) && payload.length >= 2 && 
                    payload[0] === 'message' && 
                    payload[1] && 
                    typeof payload[1] === 'object' &&
                    typeof payload[1].content === 'string' &&
                    payload[1].content.trim()) {
                  
                  const userText = String(payload[1].content || '').trim();
                  
                  // Skip if already enriched (contains context markers) or empty
                  if (!userText || userText.includes('The context of the conversation is:')) {
                    console.log('Alchemyst: Skipping already-enriched or empty Manus message');
                    return origSend(data);
                  }

                  // Create a stable message identifier using content (for duplicate detection)
                  const contentKey = userText.toLowerCase().trim().slice(0, 100);
                  
                  // Check if we've seen this exact content recently (within last 5 seconds)
                  // This catches duplicates even with different message IDs
                  if (recentContent.has(contentKey)) {
                    console.log('Alchemyst: Blocking duplicate Manus message (same content)', contentKey);
                    return; // Don't send the duplicate
                  }

                  // Create a unique message key using ID and timestamp
                  const messageKey = `${payload[1].id || 'no-id'}_${payload[1].timestamp || Date.now()}`;
                  
                  // Check if we're already processing this specific message
                  if (pendingEnrichments.has(messageKey)) {
                    console.log('Alchemyst: Blocking duplicate Manus message (same ID)', messageKey);
                    return; // Don't send the duplicate
                  }

                  // Mark as being enriched and track content to prevent duplicates
                  pendingEnrichments.set(messageKey, true);
                  recentContent.add(contentKey);
                  console.log('Alchemyst: Intercepting Manus message for enrichment', messageKey, 'content:', contentKey.substring(0, 50));
                  
                  // Remove from recentContent after 5 seconds to allow legitimate resends
                  setTimeout(() => {
                    recentContent.delete(contentKey);
                  }, 5000);
                  
                  // Request context with a reasonable timeout (3 seconds max wait for better reliability)
                  const contextPromise = new Promise((resolve) => {
                    let resolved = false;
                    const replyHandler = (event) => {
                      if (event.source !== window || resolved) return;
                      const data = event.data;
                      if (data && data.type === 'ALCHEMYST_CONTEXT_REPLY') {
                        resolved = true;
                        window.removeEventListener('message', replyHandler);
                        resolve(data.payload || '');
                      }
                    };
                    window.addEventListener('message', replyHandler);
                    window.postMessage({ type: 'ALCHEMYST_CONTEXT_REQUEST', query: userText }, '*');
                    setTimeout(() => {
                      if (!resolved) {
                        resolved = true;
                        window.removeEventListener('message', replyHandler);
                        resolve('');
                      }
                    }, 3000); // 3 second timeout for better reliability
                  });

                  // Wait for context (with timeout) before sending
                  let context = '';
                  try {
                    context = await contextPromise;
                  } catch (e) {
                    console.log('Alchemyst: Error waiting for context', e);
                    context = '';
                  }

                  // Enrich the message content
                  let finalContent = userText;
                  if (context && context.trim()) {
                    finalContent = `\n\nThe context of the conversation is:\n\n\`\`\`\n${context}\n\`\`\`\n\nThe user query is:\n\`\`\`\n${userText}\n\`\`\``;
                    console.log('Alchemyst: Enriching Manus message with context', messageKey);
                  } else {
                    console.log('Alchemyst: No context available, sending original message', messageKey);
                  }
                  
                  // Update payload with enriched content
                  payload[1].content = finalContent;
                  
                  // Reconstruct the Socket.IO message
                  const enrichedJson = JSON.stringify(payload);
                  const enrichedMessage = '42' + enrichedJson;
                  
                  // Remove from pending before sending enriched version
                  pendingEnrichments.delete(messageKey);
                  // Note: recentContent will be cleaned up by timeout
                  
                  console.log('Alchemyst: Sending Manus message', messageKey, context ? '(enriched)' : '(no context)');
                  
                  // Send the enriched message (this replaces the original - DON'T send original)
                  if (typeof data === 'string') {
                    return origSend(enrichedMessage);
                  } else {
                    // Convert back to Blob/ArrayBuffer if needed
                    const encoder = new TextEncoder();
                    const encoded = encoder.encode(enrichedMessage);
                    return origSend(encoded.buffer);
                  }
                } else {
                  // Not a message we care about, let it through
                  console.log('Alchemyst: Manus message has no content field or wrong format', messageStr.substring(0, 100));
                }
              } catch (e) {
                // Failed to parse/enrich, send original to avoid losing message
                console.log('Alchemyst: Failed to enrich Manus Socket.IO message, sending original', e);
                // Send original message to avoid losing it
                return origSend(data);
              }
            } else {
              // Not a Socket.IO event message we care about, let it through
              if (messageStr && messageStr.length > 0 && !messageStr.match(/^[0-9]+$/)) {
                console.log('Alchemyst: Manus message not a Socket.IO event (42...), letting through', messageStr.substring(0, 50));
              }
            }
          }
        } catch (e) {
          // Error in WebSocket interception, send original
          console.log('Alchemyst: Error in WebSocket send interception', e);
        }
        
        // Send original message if not modified
        return origSend(data);
      };

      return ws;
    };

    // Copy static properties
    Object.setPrototypeOf(window.WebSocket, origWebSocket);
    window.WebSocket.prototype = origWebSocket.prototype;
  }
})();