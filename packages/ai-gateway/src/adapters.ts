import type { AnthropicRequestBody } from './index';

export interface OpenAIRequestBody {
  model: string;
  messages: { role: string; content: string }[];
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIResponse {
  id: string;
  choices: [{ message: { role: string; content: string }; finish_reason: string }];
  usage: { prompt_tokens: number; completion_tokens: number };
}

export interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: [{ type: 'text'; text: string }];
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

export function anthropicReqToOpenAI(body: AnthropicRequestBody): OpenAIRequestBody {
  const model = 'nvidia/llama-3.3-nemotron-super-49b-v1';
  const max_tokens = body.max_tokens ?? 512;
  const messages: { role: string; content: string }[] = [];

  if (body.system && typeof body.system === 'string' && body.system !== '') {
    messages.push({ role: 'system', content: body.system });
  }

  if (body.messages) {
    for (const msg of body.messages) {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        const textBlocks = msg.content.filter((b: unknown): b is { type: 'text'; text: string } => {
          return typeof b === 'object' && b !== null && 'type' in b && (b as { type: unknown }).type === 'text' && 'text' in b && typeof (b as { text: unknown }).text === 'string';
        });
        content = textBlocks.map(b => b.text).join('\n\n');
      }
      messages.push({ role: msg.role, content });
    }
  }

  return { model, messages, max_tokens };
}

export function openAIRespToAnthropic(resp: OpenAIResponse, requestedModel?: string): AnthropicResponse {
  const stopReasonMap: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
  };
  const stop_reason = stopReasonMap[resp.choices[0].finish_reason] ?? resp.choices[0].finish_reason;

  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: resp.choices[0].message.content }],
    model: requestedModel ?? 'claude-sonnet-4-6',
    stop_reason,
    usage: {
      input_tokens: resp.usage.prompt_tokens,
      output_tokens: resp.usage.completion_tokens,
    },
  };
}
