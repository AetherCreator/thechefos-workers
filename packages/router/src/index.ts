// packages/router/src/index.ts — minimal deploy test
export default {
  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ status: 'ok', worker: 'thechefos-router' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
