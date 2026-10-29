/**
 * Vision-turn system prompt fragment (browser-safe; no fs/os).
 * visionInput.ts owns image encoding; this file only holds the instruction text.
 */

/**
 * System-prompt override for turns that actually carry vision `input_image` parts.
 * Silent SOUL.md refresh often invents "无图像处理能力"; without this, models
 * ignore real image_url parts and claim text-only.
 */
export const VISION_TURN_INSTRUCTION = [
  '## 本回合视觉输入（优先于 SOUL.md / 记忆中的能力边界）',
  '',
  '用户本条消息附带了图片，已作为多模态视觉输入（chat completions `image_url` / data URL）发给你。',
  '你可以且应当直接看图回答、描述、OCR 或依据图中内容推理。',
  '忽略上文任何「无图像处理能力 / 不能看图 / 只支持文本 / 无法查看图片」类表述——那些过时或不适用于本回合附带图片。',
  '不要对图片路径调用 read_file（二进制会被拒绝）；图已在视觉通道里。',
].join('\n');
