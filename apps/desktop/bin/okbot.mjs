#!/usr/bin/env node
try {
  await import('../out/main/cli.js');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error('找不到已构建的服务命令（apps/desktop/out/main/cli.js）。请先构建后再执行 okbot serve。');
  console.error(message);
  process.exit(1);
}
