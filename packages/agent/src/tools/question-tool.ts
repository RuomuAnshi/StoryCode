import { z } from 'zod';
import { AuthorQuestionSchema } from '@storycode/core';
import { defineTool } from './types.js';
export const askUserTool = defineTool({
  name: 'ask_user',
  description:
    '需要作者决定创作方向、确认歧义或选择下一步时调用。提出一个简短问题和 2–4 个不同选项（label 与 description），应用展示可点击选项，也允许作者自由输入。调用后必须暂停，不能代替作者选择或继续执行后续工具。选项只代表下一步意图，不代表接受文件提案。不要对明确指令重复提问。',
  schema: AuthorQuestionSchema,
  parameters: z.toJSONSchema(AuthorQuestionSchema, { io: 'input' }),
  mutating: false,
  execute(args) {
    return { authorQuestion: args, data: { waitingForAuthor: true }, summary: args.question };
  },
});
