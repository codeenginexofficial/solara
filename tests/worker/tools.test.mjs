import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../../worker/src/index.ts';

const CHAT_URL = 'https://solara.local/api/copilot/chat';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function completion(message) {
  return new Response(
    JSON.stringify({
      model: 'mock/tool-capable-model',
      choices: [{ message }],
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function copilotRequest() {
  return new Request(CHAT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Which datasets cover Jezero?' }] }),
  });
}

test('Worker loads scientific instructions and dispatches a real coverage result', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(String(input), OPENROUTER_URL);
    const body = JSON.parse(init.body);
    requests.push(body);

    if (requests.length === 1) {
      return completion({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'coverage-call-1',
            type: 'function',
            function: {
              name: 'get_dataset_coverage',
              arguments: JSON.stringify({ longitudeEastDeg: 77.42982, latitudePlanetocentricDeg: 18.46611 }),
            },
          },
        ],
      });
    }

    return completion({ role: 'assistant', content: 'The declared extents include Jezero; extent is not pixel availability.' });
  });

  const response = await worker.fetch(copilotRequest(), { OPENROUTER_API_KEY: 'test-only' });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.reply, 'The declared extents include Jezero; extent is not pixel availability.');
  assert.equal(payload.model, 'mock/tool-capable-model');
  assert.equal(requests.length, 2);

  const firstRequest = requests[0];
  assert.match(firstRequest.messages[0].content, /SOLARA Scientific Assistant Instructions/);
  assert.match(firstRequest.messages[0].content, /Use the provided scientific tools/);
  assert.equal(firstRequest.parallel_tool_calls, false);
  const exposedTools = new Map(firstRequest.tools.map((tool) => [tool.function.name, tool.function]));
  assert.deepEqual([...exposedTools.keys()].sort(), [
    'calculate_slope',
    'get_dataset_coverage',
    'get_meda_observations',
    'get_nearby_historical_rover_track',
    'get_rover_imagery_metadata',
    'get_terrain_elevation',
  ]);
  assert.match(exposedTools.get('get_nearby_historical_rover_track').description, /never a live rover location/);
  assert.match(exposedTools.get('get_rover_imagery_metadata').description, /do not include validated surface coordinates/);

  const secondRequest = requests[1];
  const assistantToolCall = secondRequest.messages.at(-2);
  const toolResult = secondRequest.messages.at(-1);
  assert.equal(assistantToolCall.role, 'assistant');
  assert.equal(assistantToolCall.tool_calls[0].id, 'coverage-call-1');
  assert.equal(toolResult.role, 'tool');
  assert.equal(toolResult.tool_call_id, 'coverage-call-1');
  const coverage = JSON.parse(toolResult.content);
  assert.equal(coverage.tool, 'get_dataset_coverage');
  assert.equal(coverage.region.id, 'jezero-crater-west');
  assert.ok(coverage.datasets.length >= 10);
  assert.ok(coverage.datasets.every((dataset) => dataset.extentNote.length > 0));
});

test('Worker dispatches slope to the deterministic five-sample DEM service', async (t) => {
  const requests = [];
  const demRequests = [];
  const point = { longitudeEastDeg: 77.42982, latitudePlanetocentricDeg: 18.46611 };
  const pixel = 0.00337412083064107;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === OPENROUTER_URL) {
      const body = JSON.parse(init.body);
      requests.push(body);
      if (requests.length === 1) {
        return completion({
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'slope-call-1',
              type: 'function',
              function: {
                name: 'calculate_slope',
                arguments: JSON.stringify(point),
              },
            },
          ],
        });
      }
      return completion({ role: 'assistant', content: 'The derived slope is about 6.68 degrees at DEM scale.' });
    }

    const query = new URL(url);
    assert.ok(query.pathname.endsWith('/ImageServer/identify'));
    const geometry = JSON.parse(query.searchParams.get('geometry'));
    demRequests.push({ x: geometry.x, y: geometry.y });
    const near = (value, expected) => Math.abs(value - expected) < 1e-9;
    let value = '-2520';
    if (near(geometry.y, point.latitudePlanetocentricDeg + pixel)) value = '-2508';
    else if (near(geometry.y, point.latitudePlanetocentricDeg - pixel)) value = '-2534';
    else if (near(geometry.x, point.longitudeEastDeg + pixel)) value = '-2536';
    else if (near(geometry.x, point.longitudeEastDeg - pixel)) value = '-2499';
    return new Response(JSON.stringify({ value }), { headers: { 'content-type': 'application/json' } });
  });

  const response = await worker.fetch(
    new Request(CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'What is the slope here?' }] }),
    }),
    { OPENROUTER_API_KEY: 'test-only' },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.reply, 'The derived slope is about 6.68 degrees at DEM scale.');
  assert.equal(requests.length, 2);
  assert.equal(demRequests.length, 5);
  const slope = JSON.parse(requests[1].messages.at(-1).content);
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'slope-call-1');
  assert.equal(slope.status, 'available');
  assert.equal(slope.method, 'central-difference-4-neighbour');
  assert.ok(Math.abs(slope.slopeDeg - 6.684) < 0.02);
  assert.equal(slope.samples.center.elevationM, -2520);
  assert.equal(slope.samples.north.elevationM, -2508);
  assert.equal(slope.samples.south.elevationM, -2534);
  assert.equal(slope.samples.east.elevationM, -2536);
  assert.equal(slope.samples.west.elevationM, -2499);
  assert.ok(slope.warnings.some((warning) => warning.includes('regional terrain')));
});

test('Worker rejects invalid tool coordinates before contacting a scientific data service', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    assert.equal(String(input), OPENROUTER_URL);
    const body = JSON.parse(init.body);
    requests.push(body);
    if (requests.length === 1) {
      return completion({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'invalid-dem-call',
            type: 'function',
            function: {
              name: 'get_terrain_elevation',
              arguments: JSON.stringify({ longitudeEastDeg: 181, latitudePlanetocentricDeg: 18.46611 }),
            },
          },
        ],
      });
    }
    return completion({ role: 'assistant', content: 'The requested coordinate is invalid.' });
  });

  const response = await worker.fetch(copilotRequest(), { OPENROUTER_API_KEY: 'test-only' });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.reply, 'The requested coordinate is invalid.');
  assert.equal(requests.length, 2);
  const toolResult = requests[1].messages.at(-1);
  const parsedResult = JSON.parse(toolResult.content);
  assert.equal(toolResult.tool_call_id, 'invalid-dem-call');
  assert.equal(parsedResult.error, 'invalid_arguments');
  assert.match(parsedResult.message, /longitudeEastDeg/);
});
