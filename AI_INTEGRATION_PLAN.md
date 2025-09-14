## AI Integration Plan for WOY Task Manager

### Goals
- Enable a chat-based AI assistant (GPT-4) to interpret user intents and perform actions: create tasks, schedule events, and send notifications.
- Abstract AI concerns behind clean modules: client, prompts, tools, memory, orchestrator, HTTP layer.
- Keep extensibility for future tools (e.g., points, leaderboard, team collaboration flows).

### Architecture Overview
- **HTTP API**: `POST /api/ai/chat` to converse; `POST /api/ai/reset` to clear a session.
- **Orchestrator**: Runs OpenAI chat with tools (function calling), executes tools, returns final response and action log.
- **Tools**: Business actions exposed to AI as callable functions (createTask, scheduleEvent, notifyUser).
- **Prompting**: System prompt tailored for task management and collaboration.
- **Memory**: In-memory conversation store by `sessionId` (pluggable for Redis/DB).
- **Client**: Thin wrapper to initialize OpenAI SDK and select model.

### Code Layout
```
src/
  ai/
    clients/
      openaiClient.js          # OpenAI SDK singleton + default model
    memory/
      memoryStore.js           # In-memory session messages (replaceable)
    orchestrator/
      chatOrchestrator.js      # Tool-calling loop; executes registry
    prompt/
      systemPrompt.js          # System prompt builder
    tools/
      definitions.js           # OpenAI tool schemas (function calling)
      registry.js              # Tool implementations (stubs + WhatsApp)
  internal/
    ai/
      controller.js            # HTTP handlers
      routes.js                # /api/ai routes
```

### API Contracts
- `POST /api/ai/chat`
  - Body: `{ sessionId: string, userId?: string, message: string }`
  - Response: `{ message: string, actions: Array<{ tool, args, result|error }>, model: string }`

- `POST /api/ai/reset`
  - Body: `{ sessionId: string }`
  - Response: `{ ok: true }`

### Tooling (Function Calling)
- **createTask**: `{ title, description?, dueDate?, priority?, assignees?, labels? }`
- **scheduleEvent**: `{ title, start, end?, attendees?, location?, description? }`
- **notifyUser**: `{ channel: "whatsapp"|"email", recipient, message }`

Notes:
- Tool schemas live in `src/ai/tools/definitions.js`.
- Executions are routed by name via `src/ai/tools/registry.js`.
- WhatsApp delivery uses existing `sendMessage` helper. Email is stubbed.
- Replace stubs with DB/calendar integrations when ready.

### Orchestration Flow
1. Build messages: `system` + prior session + new `user` message.
2. Call OpenAI with tools enabled; if tool calls return, execute each via registry.
3. Feed tool results back to the model; repeat up to 4 steps or until final assistant text.
4. Persist conversation (assistant + tool messages) in memory store.
5. Respond with AI text and action log.

### Prompting Strategy
- System prompt emphasizes: concise, actionable responses; clarify when ambiguous; prefer tool use for task/event/notification intents; align with collaborative task manager domain.
- Tunable via `src/ai/prompt/systemPrompt.js`.

### Configuration
- Env vars:
  - `OPENAI_API_KEY` (required)
  - `OPENAI_MODEL` (optional, default `gpt-4`)

Model notes:
- Tool-calling requires models that support `tools` (function calling). If `gpt-4` in your account does not support this, set `OPENAI_MODEL` to a compatible model like `gpt-4o` or `gpt-4.1`.

### Extensibility
- Add tools: define schema in `definitions.js`, implement in `registry.js`.
- Swap memory: implement `getSessionMessages`, `appendSessionMessage`, `resetSession` over Redis/DB.
- Add channels: extend `notifyUser` with email/SMS providers.
- Add domain actions: e.g., points, leaderboard, team/project entities.

### Frontend Chatbox (minimal API usage)
- Send user input to `POST /api/ai/chat` with a stable `sessionId` (e.g., UUID per tab/user).
- Render `response.message`. Optionally display `actions` for transparency.
- To clear conversation, call `POST /api/ai/reset`.

### Testing Scenarios
- "buatkan jadwal presentasi minggu depan" → `scheduleEvent` called with next-week date.
- "tambahkan card untuk laporan penelitian" → `createTask` with appropriate title.
- "ingatkan via WA besok jam 9" → `notifyUser` channel `whatsapp`.

### Migration Hooks (Future)
- Replace stubs with Mongoose models under `src/models/` for tasks/events.
- Integrate calendar provider (Google/Microsoft) and OAuth.
- Persist conversations and actions for analytics and recovery.


