Vitest Summary:\n\n\nTSC Output:\n\n\nCommit SHA:\nde571ec94579273fa9a36d98bc76e5db48542b73\n\nExported Symbols from adapters.ts:\ninterface OpenAIRequestBody {
interface OpenAIResponse {
interface AnthropicResponse {
function anthropicReqToOpenAI(body: AnthropicRequestBody): OpenAIRequestBody {
function openAIRespToAnthropic(resp: OpenAIResponse, requestedModel?: string): AnthropicResponse {
