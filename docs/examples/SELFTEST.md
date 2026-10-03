# 自测证据

- `pnpm --filter @okbot/shared build` — green
- `pnpm --filter @okbot/agent test` — green（含 `skills/catalog.test.ts`）
- `pnpm --filter @okbot/desktop typecheck` — green
- `pnpm --filter @okbot/desktop test` — green
- `node docs/examples/assistant-package/selftest.mjs` — 写出 `_out/` 包文件并校验 stripSecrets

截图：
- `skills-progressive/catalog-demo.png`
- `skills-progressive/hot-reload-demo.png`
- `assistant-package/export-demo.png`
- `assistant-package/import-demo.png`
- `runtime-event/sse-stream-demo.png`
