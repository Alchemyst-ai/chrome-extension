# Alchemyst Context Layer Chrome Extension

A Chrome extension that enriches ChatGPT, Claude, Gemini, Perplexity, v0, Lovable, and Bolt prompts with relevant context from your knowledge base.

## Features

- Seamlessly integrates with ChatGPT, Claude.ai, Gemini, Perplexity, v0, Lovable, and Bolt interfaces
- Injects relevant context from your Alchemyst knowledge base into prompts
- Save conversation history via the popup for supported platforms
- Toggle memory/context injection with a single click
- Simple API key configuration

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Usage

1. Click the extension icon in Chrome
2. Enter your Alchemyst API key and click "Save"
3. Navigate to ChatGPT, Claude.ai, Gemini, Perplexity, v0, Lovable, or Bolt
4. Use the Alchemyst memory button (next to the input area) to toggle context injection
5. Type your prompts normally — context will be automatically injected when enabled
6. To save a conversation, open the extension popup and click "Save Context" on a supported site

## Architecture

- `popup.html/js`: API key configuration interface
- `background.js`: Service worker for API communication
- `content.js`: DOM manipulation and message bridging
- `inpage.js`: Network request interception
- `offscreen.js`: Keeps service worker alive

## Development

The extension uses Chrome Extension Manifest V3 and includes:

- Long-lived connections via Chrome ports
- Request deduplication
- Robust error handling
- Persistent state management
- DOM-based UI integrations

## Permissions

- `storage`: For API key persistence
- `scripting`: For DOM manipulation
- `activeTab`: For current tab access
- `offscreen`: For service worker persistence

## Host Permissions

- `https://chat.openai.com/*`
- `https://chatgpt.com/*`
- `https://claude.ai/*`
- `https://gemini.google.com/*`
- `https://www.perplexity.ai/*`
- `https://v0.app/*`
- `https://lovable.dev/*`
- `https://lovable-api.com/*`
- `https://bolt.new/*`
- `https://platform-backend.getalchemystai.com/*`