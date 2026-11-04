// HenryKnows client — the external knowledge service the agent calls as a tool (MCP over HTTP, no key).
// https://henryknows.info/connect/  — read-only; questions must carry no names or identifiers (our redaction guarantees that).
const BASE = (process.env.HENRY_BASE || 'https://henryknows.info').replace(/\/$/, '');
let nextId = 1;

async function mcpCall(name, args, timeoutMs = 45000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BASE}/mcp`, { method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }) });
    const text = await r.text();
    const line = text.split('\n').map((l) => l.replace(/^data:\s*/, '')).find((l) => l.startsWith('{'));
    const j = JSON.parse(line || text);
    if (j.error) throw new Error(j.error.message || 'MCP error');
    const c = (j.result?.content || []).find((x) => x.type === 'text');
    try { return JSON.parse(c?.text ?? '{}'); } catch { return { text: c?.text ?? '' }; }
  } finally { clearTimeout(t); }
}

/** Fast: passages + urls. Returns { sources:[{n,title,url,heading,excerpt}] } */
export const searchSources = (query, limit = 5) => mcpCall('search_sources', { query, limit });
// HenryKnows also offers ask_henry (a written answer). It is deliberately NOT a runtime tool here: that answer is composed by a
// non-Meta model, and the hackathon rules require every model called at runtime to be a Meta model. search_sources is lexical
// retrieval over the corpus (no model), so Spark reads the passages and writes the sentence itself.

export const henryTools = [
  { type: 'function', name: 'search_sources', strict: true,
    description: 'Search HenryKnows primary sources (8 CFR, SEVP/USCIS guidance, Federal Register) and get matching passages with their URLs. Fast. Use it to ground every regulatory claim; cite only URLs it returns.',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', description: 'Regulatory question in general terms, no names or identifiers' } } } },
];
export async function runHenryTool(name, args) {
  if (name === 'search_sources') { const r = await searchSources(args.query, 5); return { sources: (r.sources || []).map((s) => ({ title: s.title, url: s.url, heading: s.heading, excerpt: (s.excerpt || '').slice(0, 900) })) }; }
  return { error: 'unknown tool ' + name };
}
