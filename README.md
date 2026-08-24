# Mattermost Personal Account Automation

A modular, production-quality TypeScript automation service and CLI for interacting with Mattermost using your **existing personal Mattermost account**.

## 🚀 Key Features

* **Personal Account Attribution**: Posts and replies are attributed directly to your personal Mattermost user.
* **No Bots / No Webhooks**: Does not require creating bot accounts, incoming webhooks, or second users.
* **Modular Provider Architecture**:
  * `MattermostApiProvider`: High-performance REST API v4 using Personal Access Tokens (PAT).
  * `MattermostPlaywrightProvider`: Resilient browser automation using a persistent browser profile (`data/mattermost-browser`) with one-time manual login.
* **Domain Actions with Zod Validation**: Type-safe domain actions (`send_message`, `reply_to_message`, `read_channel`, `get_channel`, `whoami`).
* **Smart Channel Resolution**: Automatically resolves channel names, display names, slugs, or direct IDs with TTL in-memory caching.
* **Idempotency & Deduplication**: Prevents duplicate message posts during retries and concurrent pipeline executions.
* **Typed Error Hierarchy**: Distinguishes authentication, authorization, not found, network timeouts, and rate limits with safe exponential backoff.
* **Security First**: Automatically sanitizes tokens, cookies, and passwords from logs, error messages, and responses.
* **Versatile Interface**: Full TypeScript SDK and command-line interface (CLI) with JSON mode and standard Unix piping.

---

## 🏗 Architecture

```text
src/
├── application/
│   └── mattermost/
│       ├── actions/                   # ActionExecutor & domain action handlers
│       ├── dto/                       # Zod action schemas & action result DTOs
│       └── services/
│           └── automation-service.ts  # Unified MattermostAutomationService facade
│
├── domain/
│   └── mattermost/
│       ├── entities/                  # User, Channel, Post, Team types
│       ├── errors/                    # Typed error hierarchy & secret sanitization
│       └── providers/                 # MattermostProvider interface
│
├── infrastructure/
│   └── mattermost/
│       ├── api/
│       │   ├── client.ts              # REST API v4 client with retry & error mapping
│       │   └── api-provider.ts        # API-based MattermostProvider implementation
│       ├── playwright/
│       │   ├── page-objects/          # Encapsulated Composer & ChannelPage objects
│       │   ├── web-client.ts          # Persistent browser context manager
│       │   └── playwright-provider.ts # Playwright MattermostProvider implementation
│       └── services/
│           ├── channel-resolver.ts    # Name-to-ID resolver with TTL cache
│           ├── idempotency.ts         # Idempotency manager & promise deduplication
│           └── logger.ts              # Structured JSON/text logger with redaction
│
├── config/
│   ├── env.ts                         # Zod environment validation
│   └── index.ts
│
├── cli/
│   └── index.ts                       # CLI commands (whoami, send, reply, read, action, login)
│
└── index.ts                           # Public TypeScript SDK exports
```

---

## ⚙️ Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Configure your environment variables:

```env
# Mattermost Server URL
MATTERMOST_URL=https://mattermost.example.com

# Provider: 'api' (recommended) or 'playwright'
MATTERMOST_PROVIDER=api

# Personal Access Token (for API provider)
MATTERMOST_TOKEN=your_personal_access_token

# Optional Team Context
MATTERMOST_TEAM_ID=
MATTERMOST_TEAM_NAME=

# Optional Identity Verification (Fail-fast check)
MATTERMOST_EXPECTED_USER_ID=
MATTERMOST_EXPECTED_USERNAME=

# Playwright Configuration (if MATTERMOST_PROVIDER=playwright)
MATTERMOST_BROWSER_PROFILE_DIR=./data/mattermost-browser
MATTERMOST_HEADLESS=true

# Logging Level: debug, info, warn, error
LOG_LEVEL=info
```

### Authentication Strategies

#### Strategy 1 — Personal Access Token (Recommended)
1. In Mattermost web, go to **Profile Settings** $\rightarrow$ **Security** $\rightarrow$ **Personal Access Tokens**.
2. Generate a token with post/read permissions.
3. Add `MATTERMOST_TOKEN=<token>` to `.env`.

#### Strategy 2 — Persistent Browser Session (Playwright)
If Personal Access Tokens are restricted in your Mattermost instance:
1. Set `MATTERMOST_PROVIDER=playwright` in `.env`.
2. Run the interactive login command:
   ```bash
   npm run cli -- login
   ```
3. Complete login and MFA in the browser window. The session will be securely saved in `data/mattermost-browser/` and reused automatically.

---

## 💻 CLI Usage

You can use `npm run cli -- <command>` or run the built `mattermost` binary:

### 1. Verify Identity
```bash
npm run cli -- whoami
```
Output:
```text
✅ Mattermost Identity Verified
   User ID:   7x8y9z...
   Username:  egagofur
   Name:      Ega Gofur
   Email:     ega@example.com
```

### 2. Send Message
```bash
npm run cli -- send --channel engineering --message "MR !123 is ready for review."
```

### 3. Reply to Thread
```bash
npm run cli -- reply --channel engineering --root-id post_12345 --message "Approved and tested."
```

### 4. Resolve & Inspect Channel
```bash
npm run cli -- channel engineering
```

### 5. Read Recent Messages
```bash
npm run cli -- read engineering --limit 10
```

### 6. AI Agent / JSON Action Execution
Execute raw JSON actions directly via argument or piped from stdin:
```bash
npm run cli -- action '{"action":"send_message","channel":"engineering","message":"Automated alert"}'
```
Or via standard Unix pipe:
```bash
echo '{"action":"whoami"}' | npm run cli -- action
```
Structured response:
```json
{
  "success": true,
  "data": {
    "id": "post_789abc",
    "channelId": "chan_123",
    "userId": "usr_456",
    "message": "Automated alert",
    "createdAt": "2026-08-24T10:30:00.000Z"
  }
}
```

---

## 📦 Programmatic TypeScript SDK

```ts
import { MattermostAutomationService, loadConfig } from 'mattermost-agent';

// Initialize service with environment configuration
const service = new MattermostAutomationService();

// Verify authenticated user identity
const user = await service.whoami();
console.log(`Connected as @${user.username} (${user.id})`);

// Send a message
const result = await service.sendMessage({
  channel: 'engineering',
  message: 'MR !123 is ready for review.',
});
console.log(`Posted message ID: ${result.id}`);

// Reply to a thread
await service.replyToMessage({
  channel: 'engineering',
  rootId: result.id,
  message: 'Tests passed on staging.',
});

// Execute structured action (ideal for AI Agent triggers)
const actionResult = await service.executeAction({
  action: 'send_message',
  channel: 'engineering',
  message: 'Release completed.',
});

if (actionResult.success) {
  console.log('Action completed:', actionResult.data);
} else {
  console.error(`Error [${actionResult.error?.code}]: ${actionResult.error?.message}`);
}
```

---

## 🧪 Testing & Validation

Run unit and integration tests:
```bash
npm test
```

Run TypeScript type checking:
```bash
npm run typecheck
```

Build production bundle:
```bash
npm run build
```

---

## 🔒 Security Principles

* `.env` and `data/mattermost-browser/` are excluded by `.gitignore`.
* Tokens and session identifiers are redacted from all logs and error stacks.
* Password credentials are never stored.
* Fails fast if `MATTERMOST_EXPECTED_USER_ID` does not match the authenticated session.
