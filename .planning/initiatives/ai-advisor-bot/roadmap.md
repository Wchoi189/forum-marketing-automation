# Roadmap: AI Provider Swap + Slack Bot

## Part 1: AI Provider Abstraction

**Goal**: Replace hardcoded xAI calls with a configurable provider system supporting DeepSeek and Gemini Flash.

### Step 1 — Add env vars (`config/env.ts`)

Add two new fields:

- `AI_PROVIDER: "xai" | "deepseek" | "gemini"` — default `"xai"`
- `AI_MODEL_ID: string` — default `"grok-4-1-fast-non-reasoning"`

### Step 2 — Create `lib/llm.ts` (new file)

Shared `callLLM()` helper that:

- Takes `{ systemPrompt, userMessage, maxTokens, temperature }`
- Routes to the correct endpoint based on `ENV.AI_PROVIDER`:
  - **xai**: `https://api.x.ai/v1/chat/completions` with `ENV.XAI_API_KEY`
  - **deepseek**: `https://api.deepseek.com/v1/chat/completions` with `ENV.DEEPSEEK_API_KEY`
  - **gemini**: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` with `ENV.OPENAI_API_KEY` (Gemini supports OpenAI-compatible protocol)
- Returns `{ content, usage: { promptTokens, completionTokens, totalTokens } }`
- Same abort/timeout/retry pattern as current code

### Step 3 — Update `lib/aiAdvisor.ts`

- Replace `callGrokAdvisor()` body to call `callLLM()` instead of direct `fetch`
- Rename function to `callAiAdvisor()` (provider-agnostic)
- Keep all validation (`validateOutput`, `validateFlat`) unchanged

### Step 4 — Update `lib/nlWebhook.ts`

- Replace `classifyIntent()` body to call `callLLM()` instead of direct `fetch`
- Model ID and API key come from `callLLM()` routing, not hardcoded

### Step 5 — Update `.env.docker`

```env
AI_PROVIDER=deepseek
AI_MODEL_ID=deepseek-chat
# Existing keys (DEEPSEEK_API_KEY, XAI_API_KEY, OPENAI_API_KEY already present)
```

---

## Part 2: Slack Bot for Incoming Commands

**Goal**: Receive Slack messages, route them through existing NL intent classification, reply with results.

### Step 6 — Install Slack SDK

```bash
npm install @slack/web-api
```

### Step 7 — Create `routes/api/slack.ts` (new file)

- New route: `POST /api/slack-event`
- Verify Slack request signature using `SLACK_SIGNING_SECRET` (add to `.env.docker`)
- Handle URL verification challenge (Slack's initial setup)
- Extract message text from `event.text`
- Forward to existing `classifyIntent()` + intent dispatch (reuse NL webhook logic)
- Reply back to Slack channel via `SLACK_BOT_TOKEN` + `chat.postMessage`

### Step 8 — Add env vars (`config/env.ts`)

- `SLACK_SIGNING_SECRET: string | null` — for request verification
- `SLACK_BOT_TOKEN: string | null` — for replying to channels

### Step 9 — Mount in `server.ts`

Add `app.use(createSlackRouter({ ...deps, classifyIntent, ... }))` alongside existing routers.

### Step 10 — Update `.env.docker`

Add:

```env
SLACK_SIGNING_SECRET=<from your Slack app Basic Information>
SLACK_BOT_TOKEN=<xoxb-... already have as SLACK_OAUTH_TOKEN, can reuse>
```

---

## Slack App Setup (one-time, done in browser)

1. Go to https://api.slack.com/apps → Create App (from scratch)
2. Enable **Event Subscriptions** with your server URL (e.g., `https://your-domain/api/slack-event`)
3. Subscribe to `message.channels` and `message.im` events
4. Add bot scopes: `channels:history`, `im:history`, `chat:write`
5. Copy **Signing Secret** from Basic Information
6. Install to workspace → get **Bot User OAuth Token**

---

## Files to Create

| File | Purpose |
|------|---------|
| `lib/llm.ts` | Shared LLM provider router |
| `routes/api/slack.ts` | Slack event handler |

## Files to Modify

| File | Changes |
|------|---------|
| `config/env.ts` | Add 4 env vars (AI_PROVIDER, AI_MODEL_ID, SLACK_SIGNING_SECRET, SLACK_BOT_TOKEN) |
| `lib/aiAdvisor.ts` | Use `callLLM()` instead of direct xAI fetch |
| `lib/nlWebhook.ts` | Use `callLLM()` instead of direct xAI fetch |
| `server.ts` | Mount Slack router |
| `.env.docker` | Add provider config + Slack secrets |
| `package.json` | Add `@slack/web-api` dependency |
