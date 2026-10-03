# 示例：统一 RuntimeEvent 流

## 模型

桌面 IPC 与 Gateway SSE 使用同一 `RuntimeEvent` JSON。SSE 帧形如：

```text
event: delta
data: {"type":"delta","botId":"bot_…","messageId":"…","delta":"你好"}

event: done
data: {"type":"done","botId":"bot_…","messageId":"…","content":"…"}
```

云电脑 `/v1/shell` 在 `Accept: text/event-stream` 时使用对齐的 `ExecStreamEvent`（stdout/stderr/done）；桌面 `createRemoteExecutionBackend` 将其折叠为与 JSON 模式相同的 `formatted`，工具层仍是一个 `ExecutionBackend`。

## 中文操作步骤

1. 设置 → 开启本机 HTTP API（可开 LAN gateway）。
2. 复制「请求 URL」中的 SSE curl，向某助手发一条消息。
3. 观察终端中连续的 `event: user_message` / `delta` / `done`（或 `tool_request`）。
4. （可选）对已注册云电脑执行 shell：后端优先走 SSE，再回落 JSON。

截图：`sse-stream-demo.png`。
