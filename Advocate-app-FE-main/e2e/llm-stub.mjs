// A controlled, local stand-in for an OpenAI-compatible AI provider, for the
// browser E2E run only. It never calls out; every answer is canned and marked
// "[E2E stub]" so a test can tell it came from here. It records how many
// requests it saw (GET /__stats) so a test can prove the backend used it.
import http from 'node:http'

let requests = 0
const PORT = Number(process.env.LLM_STUB_PORT || 8099)

function reply(body) {
  const msgs = body?.messages || []
  const last = [...msgs].reverse().find((m) => m.role === 'user')
  const text = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content || '')
  return `[E2E stub] Received ${text.length} characters. This is a controlled test answer, not legal advice.`
}

http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    if (req.url === '/__stats') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ requests }))
    }
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'e2e-stub' }] }))
    }
    requests += 1
    let body = {}
    try { body = JSON.parse(raw || '{}') } catch { /* keep empty */ }
    const content = reply(body)
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const word of content.split(' ')) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: word + ' ' } }] })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } })}\n\n`)
      return res.end('data: [DONE]\n\n')
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      id: 'e2e', object: 'chat.completion', model: body.model || 'e2e-stub',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }))
  })
}).listen(PORT, '127.0.0.1', () => console.log(`LLM stub on ${PORT}`))
