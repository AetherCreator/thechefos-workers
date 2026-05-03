import { describe, it, expect } from 'vitest'
import { anthropicReqToOpenAI, openAIRespToAnthropic, type OpenAIResponse, type AnthropicResponse } from './adapters'
import type { AnthropicRequestBody } from './index'

describe('anthropicReqToOpenAI', () => {
  it('PWA payload → NIM shape', () => {
    const input: AnthropicRequestBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{ role: 'user', content: 'Hello' }]
    }
    const output = anthropicReqToOpenAI(input)
    expect(output.model).toBe('nvidia/llama-3.3-nemotron-super-49b-v1')
    expect(output.max_tokens).toBe(512)
    expect(output.messages.length).toBe(1)
    expect(output.messages[0].role).toBe('user')
    expect(output.messages[0].content).toBe('Hello')
  })

  it('System prompt prepended', () => {
    const input: AnthropicRequestBody = {
      model: 'claude-sonnet-4-6',
      system: 'You are X',
      messages: [{ role: 'user', content: 'Hello' }]
    }
    const output = anthropicReqToOpenAI(input)
    expect(output.messages[0]).toEqual({ role: 'system', content: 'You are X' })
    expect(output.messages[1]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('Multi-turn passthrough', () => {
    const input: AnthropicRequestBody = {
      model: 'claude-sonnet-4-6',
      messages: [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' }
      ]
    }
    const output = anthropicReqToOpenAI(input)
    expect(output.messages.length).toBe(3)
    expect(output.messages[0]).toEqual({ role: 'user', content: 'A' })
    expect(output.messages[1]).toEqual({ role: 'assistant', content: 'B' })
    expect(output.messages[2]).toEqual({ role: 'user', content: 'C' })
  })

  it('Content blocks → joined string', () => {
    const input: AnthropicRequestBody = {
      model: 'claude-sonnet-4-6',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'A' },
            { type: 'image', source: {} },
            { type: 'text', text: 'B' }
          ]
        }
      ]
    }
    const output = anthropicReqToOpenAI(input)
    expect(output.messages[0].content).toBe('A\n\nB')
  })
})

describe('openAIRespToAnthropic', () => {
  it('NIM response → Anthropic shape', () => {
    const input: OpenAIResponse = {
      id: 'resp-123',
      choices: [{ message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 7 }
    }
    const output = openAIRespToAnthropic(input)
    expect(output.type).toBe('message')
    expect(output.role).toBe('assistant')
    expect(output.content[0].text).toBe('Hi')
    expect(output.stop_reason).toBe('end_turn')
    expect(output.usage.input_tokens).toBe(10)
    expect(output.usage.output_tokens).toBe(7)
  })

  it('Round-trip + model echo', () => {
    const request: AnthropicRequestBody = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }]
    }
    const openaiRequest = anthropicReqToOpenAI(request)
    const fabricatedResponse: OpenAIResponse = {
      id: 'resp-456',
      choices: [{ message: { role: 'assistant', content: 'World' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 }
    }
    // With requestedModel
    const outputWithModel = openAIRespToAnthropic(fabricatedResponse, 'claude-haiku-4-5')
    expect(outputWithModel.content[0].text).toBe('World')
    expect(outputWithModel.model).toBe('claude-haiku-4-5')
    // Without requestedModel (default)
    const outputDefault = openAIRespToAnthropic(fabricatedResponse)
    expect(outputDefault.content[0].text).toBe('World')
    expect(outputDefault.model).toBe('claude-sonnet-4-6')
  })
})
