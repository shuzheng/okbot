import type { ResolvedModelConfig } from '@okbot/shared';

export function assertModel(model: ResolvedModelConfig): void {
  if (!model.baseURL?.trim()) throw new Error('请先在设置里填写 baseURL');
  if (!model.apiKey?.trim()) throw new Error('请先在设置里填写 API Key');
  if (!model.model?.trim()) throw new Error('请先在设置里添加并启用至少一个模型');
}
