// Tells the browser where the WebSocket relay is (RELAY_URL env var, e.g. wss://henry-listens-relay.onrender.com). Empty = same host.
export default async () => new Response(`window.RELAY_URL=${JSON.stringify(process.env.RELAY_URL || '')};`, { headers: { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' } });
