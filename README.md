# Alchemyst Context Layer Chrome Extension

A Chrome extension that enriches ChatGPT, Claude, Gemini, and v0 prompts with relevant context from your knowledge base.

## Features

- Seamlessly integrates with ChatGPT, Claude.ai, Gemini, and v0 interfaces
- Injects relevant context from your Alchemyst knowledge base into prompts
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
3. Navigate to ChatGPT, Claude.ai, Gemini, or v0
4. Use the Alchemyst memory button (next to the input area) to toggle context injection
5. Type your prompts normally - context will be automatically injected when enabled

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
- `https://v0.app/*`
- `https://platform-backend.getalchemystai.com/*`