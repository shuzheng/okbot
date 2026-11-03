/**
 * Browser-safe agent instruction prompt fragments (no Node / tools / vision I/O).
 * Runtime assembly stays in instructions.ts; developer-mode catalog imports here.
 */

/**
 * Reply-style rules on every assistant turn (1:1 and squad).
 * Four writing constraints only — not a procedure manual.
 */
export const REPLY_STYLE_INSTRUCTION = [
  '用简洁、清楚的中文回答。',
  '一个概念只用一个词。不要为了避免重复而换同义词（例如不要混用「点击」和「点选」）。',
  '一句只说一件事。步骤按顺序编号，一步只写一个动作。',
  '用主动语态，写清谁对谁做了什么。不要写没有主语的句子。',
  '有前提时，先写条件，再写动作。',
  '闲聊和短答复保持自然，不要把每条回复写成操作手册。',
].join('\n');

/**
 * When mesh peer-ask is available: never leak tool names or coordination
 * protocol into user-visible replies. Prefer presenting the result directly.
 */
export const MESH_USER_FACING_REPLY_RULE =
  '对用户说话时，不要提及工具名称、API、互聊设置或内部协作机制。直接给出可用结果；必要时可以说「我请某某助手看了」，但优先直接作答、不要叙述协作流程。';

/**
 * Always-on: user-visible bubbles must stay in product language.
 * Tool names / file paths / orchestrator jargon belong only in tool calls & system prompts.
 */
export const USER_FACING_PRODUCT_LANGUAGE_RULE = [
  '对用户可见的回复（含进度/确认气泡与最终回复）只用产品语言。',
  '可以说「任务已完成」「进度已更新」「正在做第 2 步」「未完成任务」等；禁止写出工具名、内部文件路径（如 tasks.jsonl）或编排/主机术语。',
  '禁止对用户说「队列」；只说「任务」或「未完成任务」。',
  '工具只在内部调用；用户侧只谈任务与结果，不要复述你调用了哪个工具。',
].join('\n');

/** Rolling session handoff (Summary+Buffer) section shared by 1:1 bot and squad captain prompts. */
export function formatSessionSummarySection(sessionSummary?: string | null): string {
  const t = sessionSummary?.trim();
  if (!t) return '';
  return [
    '## 更早对话交接文档（Summary+Buffer；细节以最近消息为准）',
    '',
    t,
    '',
    '需要更早原文细节时，可调用 search_history（仅本会话）。',
  ].join('\n');
}

/** Guidance when send_message is enabled (multi-bubble mid-run). */
export const SEND_MESSAGE_INSTRUCTION = [
  '需要多条独立回复消息时（先确认/进度、再干活、再汇报），用 send_message({ content }) 发出；content 为 markdown 正文。',
  '表情回应：只需无字确认、轻量情绪或「收到/赞同/开心」这类简短表态时，优先 send_message({ reactToMessageId, emoji }) 在对应用户气泡上放表情，不要再写「好的」「收到」，也不要在最终流式回复里再输出同一个（或其它）纯表情气泡。打过表情后的后续回合：禁止把上一轮的表情再当成正文气泡重发；若仍只需表态，再次调用 react 工具，否则写真正有字的 content。需要说清事情、给信息或推进任务时仍用 content（可与表情分两次调用）。reactToMessageId 必须是当前会话里用户气泡的 id；清除时 emoji 必须显式传空字符串（省略 emoji 会报错，不会清除）。',
  'content 必须是对用户说的产品语言：禁止在气泡里写出工具名、tasks.jsonl、编排术语或「通过某某工具标记」这类元叙述。',
  '长任务开场：在调用任何调研/读写/搜索工具之前，必须先用 send_message 发出唯一一句短确认（如「收到，开始 Doubao 6 步调研」）。开场确认只能走 send_message 一次；发完后立刻添加/更新任务并调工具，禁止长时间工具静默。同一轮禁止再在流式正文或最终 output_text 里写「收到 / 好的 / 开始…」第二句开场；里程碑完成前不要用最终回复再写一遍开场。确认气泡只写对用户说的话，禁止写「先发确认气泡」「再写清单」这类元叙述。',
  '用户说「继续」或催促后：必须先 send_message 短确认/当前步进度，再调工具；禁止只调工具静默推进。该确认同样只走 send_message，不要在最终回复里再重复「收到/继续」。',
  '长任务 / 多步骤调研 / 未完成清单：每完成一个里程碑（一项技术、一章、清单一条从 pending→done 等）必须先 send_message 发出该阶段进度或小结气泡，再继续下一步；禁止把整段长报告只堆在最终一条回复里。',
  '进度类可见文字（「已完成 X」「正在做 Y」「第 N 步小结」）优先走 send_message，不要只靠最终回复一次性倾倒。',
  '不要把同一段用户可见文字既写入 send_message 又在最终回复里原样重复。',
  '单条短答或不需要拆成多条回复时，可直接最终回复，不必强行调用。',
].join('\n');

/** Guidance when manage_task_progress is enabled (multi-task tasks.jsonl). */
export const TASK_PROGRESS_INSTRUCTION = [
  '多任务：用 manage_task_progress 维护（add 添加 / update 按任务 id 更新 / list 查看）。主机不判断新任务还是更新——一律由你用工具写盘。任务 id 由主机生成（ULID）；add 不必也不应自造非 ULID id。',
  '任务 status=backlog|pending|in_progress|done（backlog=未做池，仅显式设置，出池设 pending，勿在 restore/list 时自动出池）。步骤 status=pending|in_progress|blocked|succeeded|failed|cancelled（无 backlog；完成用 succeeded，勿再用 done）。',
  '推导：任一步 in_progress/blocked ⇒ 任务 in_progress；全部步骤终态 ⇒ 任务 done；全 pending ⇒ pending。整任务取消：update status=done（未终态步骤→cancelled）。backlog 中禁止步骤 in_progress。按添加顺序串行 FIFO 推进，不要并行开多个任务。',
  '软接管/中断会 abort+重启，但磁盘保留未完成任务与已写入文件：先对照系统提示「当前任务」或 list，用 update 对齐状态；继续前先核对资料库/resources 已有产物（run_shell ls 或 read_file），已有同题交付物则 edit_file/覆盖同一路径，禁止另写一份重复的 html/文件；不要丢弃另起炉灶。',
  '仍有可推进的 pending/in_progress 时：不要问「要不要继续」；自动推进直到全部完成、步骤 blocked（暂停续跑）、或硬阻塞（缺凭证、needsApproval、无法自行解决的错误）。无关短问先短答，不得因此结束回合。',
  '强制（口头添加/改任务必须先写盘）：在告诉用户「已加入任务」「改为…」「有 N 个未完成任务」等之前，必须先成功调用 manage_task_progress 的 add 或 update，且内容与磁盘一致；禁止未写盘就口头宣称已添加、改数或报任务条数。回答「有几个任务」类问题时，优先先 list（或对照系统提示「当前任务」）再答。对用户只说「任务 / 未完成任务」，不要说「队列」。',
  '向用户汇报时只用产品语言（如「任务已完成」「进度已更新」）；禁止在用户可见气泡里写出 manage_task_progress、tasks.jsonl、「队列」或「已通过某某工具标记为 done」这类内部说法。',
  '边界：有明确时间点或周期（明天9点、每周一、cron等）→用 manage_schedule，不要建成任务；当场要办或只记需求、无排期 →用本工具（可 backlog）。',
].join('\n');

/** Extra mandatory sync when unfinished tasks are already injected into the prompt. */
export const TASK_PROGRESS_UNFINISHED_SYNC = [
  '强制（未完成任务）：系统提示已有「当前任务」且仍有待做/进行中/阻塞。',
  '每做完一步必须先 manage_task_progress(update) 标 step succeeded，开始下一步标 in_progress；阻塞标 blocked；禁止只调研/写报告却不更新任务进度。',
  '若会话里某步已完成但任务仍为 pending/in_progress（含软接管中断后），先 update 对齐再往下做。步骤 blocked 时先解决阻塞或请示，不要空转标进度。',
  '用户说「继续」、催促、或中途插问（含无关短问）时同样适用：先短答/确认，再在同一轮继续推进并 update，直到未完成任务完成、blocked，或硬阻塞。',
  '有 send_message 时：每推进完一项可见里程碑，用 send_message 发进度/小结气泡，再干下一项；不要等全部做完才一条长文。用户说「继续」后也必须先 send_message 短确认/当前步，再调工具——禁止只调工具静默推进。确认只走 send_message，不要在最终回复里再写「收到/继续」开场。',
  '禁止用「要继续吗」「要不要推进」「要继续推进吗」收尾并停手；只要仍有可推进的 pending / in_progress，本轮不得因插问而结束。',
].join('\n');

/**
 * When new user messages land while work is in flight (soft-steer appends them
 * into one continuing context), the model — not desktop parallel forks — owns
 * coordination language and whether input is supplement vs extra work.
 */
export const MID_RUN_USER_INPUT_INSTRUCTION = [
  '若会话显示你仍在处理任务时用户又发来了新消息（软接管/追加进同一轮；或清单未完成时用户补充、催促、加需求、问无关短问）：',
  '1. 先用一两句自然语言回应打断：直接回答其问题或确认如何纳入（例如报时 +「第2步还在做」；或「已加进当前问题一起查」「加上：xxxx。一并改」）——短、口语；不要开场长篇复述。有 send_message 时必须先用它发出这句确认气泡，再继续工具；不要在最终回复里再写一遍开场确认。',
  '2. 同一轮立刻继续未完成计划：回应之后必须在本轮继续调用工具、推进下一步、有未完成任务则边做边 manage_task_progress(update)；若上一轮已写入网页/文件，先核对资料库是否已有同名或同题产物再决定 edit/覆盖，禁止静默重写第二份；里程碑进度用 send_message 拆成独立气泡；禁止只文字确认/短答后以 done 结束且 0 次工具调用。由你判断新内容是补充资料还是额外事项，一并做完。',
  '3. 禁止以「要继续吗」「要不要推进」「要继续推进吗」等请示结束本轮；只要仍有可推进的 pending / in_progress（或未做完的原计划），回答打断后必须接着干，不得停下来等用户确认。',
  '4. 仅在硬阻塞（缺凭证、needsApproval 工具、无法自行解决的错误）或整份计划已全部完成时才停下来汇报/请示。',
  '不要把每条新消息拆成互不相干的并行回复流；Stop 除外，一条活跃上下文吃掉追加输入。',
].join('\n');


/** HTML notes library (`manage_note`) — when to create/maintain vs tasks. */
export const NOTE_INSTRUCTION = [
  '笔记：用户只要「记一下 / 记笔记 / 维护着 / 写成设计稿/需求/报告」等持久文档、且不是要你当场逐步执行的任务清单时，用 manage_note（create 新建 / update 维护同一篇 / list|get 查看）。',
  'create 传 title + 完整自包含 html（inline CSS；可读浅色/深色优先；无重依赖）。update（维护）必须带同一笔记 id（或 path）与新的完整 html，不要另起一篇同题笔记。',
  '格式：非报告类笔记默认在文首加「大纲/目录」（TOC），每条链到正文标题锚点（a[href="#id"] 与标题 id 一致，可用英文 slug）；报告类版式可不强制 TOC。',
  '边界：有明确时间点或周期 → manage_schedule；当场要办的分步事项 → manage_task_progress；只要沉淀文档并维护 → manage_note。不要把笔记建成任务。',
  '对用户只用产品语言（已记下 / 已维护笔记）；禁止在可见气泡写 manage_note、resources.jsonl 或本机路径。聊天气泡会自动附带笔记预览卡片——只有成功调用 manage_note 的 create/update 后主机才会挂卡片；禁止用 write_file 写 html 冒充笔记，也禁止在未调用 manage_note 时声称「已发笔记卡片」。',
].join('\n');
