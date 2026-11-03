# Message reactions（气泡表情回应）

## Product

Conversation-first emoji reactions on chat bubbles (not a WeChat-style reaction sidebar).

1. **Persist**: reactions live on the message record (`session.jsonl` meta), updated in place. Never a new timeline bubble for the reaction itself.
2. **Assistant → user**: the model may react on a **user** bubble via **`send_message` reaction mode** (`reactToMessageId` + `emoji`) as a textless acknowledgement — reuse the existing tool; no separate reaction-only tool.
3. **User → assistant**: the user may react on an **assistant** bubble via hover 「更多」.
4. **Wake**:
   - New react or **change** emoji (user on an assistant bubble) → wake the assistant as **invisible** user intent: quiet turn (`origin: 'reaction'`, `autoContinue`-style hidden user row) with `quoteMessageId` = that message and body = the emoji.
   - **Remove** (tap the same emoji again in the grid / badge) → clear reaction only; **do not** wake.
   - User-reaction wake needs **no** special system-prompt teaching (quote + emoji is enough).
5. **UI entry**: message hover action group → 「更多」 menu. Above existing items, default **2 rows × 3**: first 5 = frequent emojis (MRU: on use, move to slot 1); 6th = `…` opening the same emoji-mart picker used for avatar emoji change. Grid candidate emoji font ~27px (badge size unchanged).
6. **Display**:
   - Assistant reaction on a **user** bubble → **bottom-right** of that bubble (round bg + border).
   - User reaction on an **assistant** bubble → **bottom-left**.
   - On set/change, the badge plays a short **pop** animation (scale up, then settle; CSS `bubble-reaction-pop`).
   - Titles / note cards still hide file extensions (unchanged).
7. One reaction per message (last writer wins for that `from` side; schema stores a single `reaction` with `from` + `emoji`).

## Schema

`ChatMessage.reaction?: MessageReaction`

```ts
type MessageReactionFrom = 'user' | 'assistant';
type MessageReaction = {
  emoji: string;
  from: MessageReactionFrom;
  updatedAt: string; // ISO
};
```

Persisted on `SessionRecordV2.meta.reaction`. Cleared by patching with `reaction: null` (host strips the meta key).

## IPC / gateway

- Channel `okbot:set-message-reaction`
- Payload: `{ botId?: string; squadId?: string; messageId: string; emoji: string | null }`
  - `emoji: null` or same-as-current → clear, no wake
  - otherwise upsert `from: 'user'`, emit `message_updated`, and (1:1 bot only) start quiet reaction turn
- RuntimeEvent: `{ type: 'message_updated'; botId; message: ChatMessage }` so all clients refresh the bubble in place
- Quiet origin: `ChatStartOrigin` adds `'reaction'`; `isQuietChatOrigin` includes it (hidden user row, still in model session)
- HTTP: `PUT /v1/bots|squads/:id/messages/:messageId/reaction` with `{ emoji }` (same semantics as IPC)

## Tool + prompt（reuse `send_message`）

No dedicated `react_message` tool. When `send_message` is enabled (prefs):

| Mode | Args | Effect |
|------|------|--------|
| Text bubble | `{ content }` | Mid-run independent assistant bubble (unchanged) |
| Reaction | `{ reactToMessageId, emoji }` | In-place reaction on that **user** bubble (`from: 'assistant'`); **explicit empty** `emoji: ""` clears; omitting `emoji` errors (does **not** clear); re-asserting the same emoji is idempotent; **does not** wake |
| Both | `{ content, reactToMessageId, emoji }` | Reaction then text bubble in one call — but if `content` is solely that emoji / emoji-only, host skips the text bubble |

Host `emitAssistantMessage` accepts a plain string (legacy text) or `{ content?, reactToMessageId?, emoji? }`.

**Host guards (double-bubble / loss):**
- Reaction-only must not create a chat bubble. If the model also returns emoji-only `content` in the same call, or an emoji-only final stream after reacting this turn, the host drops that bubble.
- **Next-turn echo:** an emoji-only assistant final that matches a reaction already on the target user bubble, or a recent prior user-bubble reaction, is dropped (no text bubble). A bare emoji-only final with no matching reaction is converted into an assistant reaction on the latest user bubble instead of a timeline row. Product: 打表情后就不发消息 — emoji-only finals never appear as bubbles.
- User UI still toggles clear by tapping the same emoji; the assistant tool must not use that toggle (same emoji = keep).

**System prompt** (`SEND_MESSAGE_INSTRUCTION`): teach that simple acknowledgements / light emotion can be **emoji-only** via `send_message({ reactToMessageId, emoji })` — prefer that over writing「好的 / 收到」, and do **not** also emit the same emoji as a final text bubble (including on later turns — re-react or write real prose); use `content` when something needs explaining. User→assistant reaction wake needs no extra prompt lines.

## MRU

Desktop `localStorage` key `okbot.reactionMru` (JSON string[]). Defaults: `👍 👎 👌 ❤️ 😂`. On pick, emoji moves to index 0; list capped at 5 for the grid.

## Deferred

- Squad wake on user reaction (persist + UI work; quiet squad turn not wired yet)
- Multi-reactor / multi-emoji on one bubble
- Reacting on mesh status rows / system rows
