const { describe, test, before, after } = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { startServer } = require('../../server.js');

describe('WebSocket Connection & Message Flow', () => {
  let serverInstance;
  let wss;
  let port;

  before(async () => {
    const result = await startServer(0);
    serverInstance = result.server;
    wss = result.wss;
    port = result.port;
  });

  after(async () => {
    wss.close();
    await new Promise((resolve, reject) => {
      serverInstance.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  test('should establish WebSocket connection to server', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.close();
  });

  test('should echo a text message back to client', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const message = JSON.stringify({ action: 'ping', timestamp: Date.now() });

    const response = await new Promise((resolve) => {
      ws.once('message', (data) => resolve(data.toString()));
      ws.send(message);
    });

    const parsed = JSON.parse(response);
    assert.strictEqual(parsed.type, 'echo');
    assert.strictEqual(parsed.payload, message);
    assert.ok(typeof parsed.timestamp === 'number');

    ws.close();
  });

  test('should handle multiple sequential messages', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const messages = ['msg-1', 'msg-2', 'msg-3'];
    const responses = [];

    ws.on('message', (data) => {
      responses.push(JSON.parse(data.toString()).payload);
    });

    for (const msg of messages) {
      ws.send(msg);
    }

    // Allow time for all messages to round-trip
    await new Promise((resolve) => setTimeout(resolve, 300));

    assert.strictEqual(responses.length, messages.length);
    assert.deepStrictEqual(responses, messages);

    ws.close();
  });

  test('should handle connection close gracefully', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    ws.close();

    await new Promise((resolve) => {
      ws.once('close', resolve);
    });

    assert.strictEqual(ws.readyState, WebSocket.CLOSED);
  });
});
