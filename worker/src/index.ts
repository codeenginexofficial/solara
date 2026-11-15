/**
 * SOLARA Copilot proxy (serves the "Solara AI" workspace tab) — the smallest
 * compatible Cloudflare Worker.
 *
 * Single endpoint: POST /api/copilot/chat
 *  - Validates and clamps the client payload (never reflected back verbatim).
 *  - Injects the server-side honesty guardrails + verified dataset facts.
 *  - Forwards to OpenRouter using the OPENROUTER_API_KEY secret (never sent
 *    to or stored by the client; the frontend has no key and must never get
 *    one — no VITE_OPENROUTER_API_KEY exists by design).
 *  - Maps upstream failures to stable JSON error codes the UI can present
 *    honestly (rate-limited / upstream-auth / upstream-error / unconfigured).
 *
 * Model selection: env.OPENROUTER_MODEL (wrangler.toml [vars]) with the
 * verified default "openrouter/free" (OpenRouter Free Models Router).
 */

import { handleMedaEnvironmentLatest } from './meda';
import instructions from '../INSTRUCTIONS.md';
import {
  handlePerseveranceImageDownload,
  handlePerseveranceImages,
} from './roverImages';
import { runScientificToolCall, SCIENTIFIC_TOOL_DEFINITIONS } from './tools';

export interface Env {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  /** Reserved for future NASA API integrations (e.g. DONKI). Not used for MEDA PDS. */
  NASA_API_KEY?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Context sections the client may report; each is clamped and labelled. */
const CONTEXT_KEYS = [
  'explorationRegion',
  'selectedLocation',
  'visibleLayers',
  'missionPlan',
  'environmentalObservations',
  'environment',
  'dataNotAvailable',
] as const;

interface CopilotChatRequestBody {
  messages?: unknown;
  context?: unknown;
}

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_CONTEXT_CHARS = 4_000;
const MAX_UPSTREAM_DETAIL_CHARS = 300;
const MAX_SCIENCE_TOOL_CALLS = 4;
const MAX_SCIENCE_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS_PER_RESPONSE = 4;
const DEFAULT_MODEL = 'openrouter/free';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

type OpenRouterMessage =
  | { role: 'system'; content: string }
  | ChatMessage
  | { role: 'assistant'; content: string | null; tool_calls: OpenRouterToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

type OpenRouterRequestResult =
  | { ok: true; content: string | null; toolCalls: OpenRouterToolCall[]; model: string }
  | { ok: false; response: Response };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const VERIFIED_DATASET_FACTS = `VERIFIED DATASET FACTS (verification date 2026-11-14):
- jezero-ctx-mosaic-soc-008: NASA Trek WMTS serving the USGS "Mars 2020 Terrain Relative Navigation Context Camera Orthorectified Image Mosaic" (USGS Astrogeology, published 2020-07-24, DOI 10.5066/P9GV1ND3). ~6 m/px nominal; finest served level 13 ~5.087 m/px; footprint 77.1604655-77.6991776 E, 18.2110274-18.7211945 N (~30.3 x 30.2 km). Built from three CTX stereo pairs; imagery content 2006-2019. Historical imagery.
- mola-hrsc-blend-200m-colorshade: NASA Trek WMTS; colorized shaded relief of the "Mars MGS MOLA-MEX HRSC Blended DEM Global 200m v2" (Fergason, Hare and Laura, 2018, USGS). Global; finest served level 8 ~162.8 m/px (product nominal 200 m/px).
- mola-hrsc-blend-200m-dem: the same blend DEM v2, queried via NASA Trek ArcGIS ImageServer (point elevation identify, global). Areoid-referenced; total elevation uncertainty at least plus/minus 3 m; MOLA base points 1999-2001; HRSC covers ~44% of Mars; blending artifacts exist ("care should be taken" - USGS).
- usgs-sim3292-jezero-geology: USGS Geologic Map of Mars (SIM 3292, Tanaka et al., 2014, scale 1:20,000,000). Two units intersect the exploration area: mNhm (Middle Noachian highland massif unit) and HNt (Hesperian and Noachian transition unit). Global compilation - coarser than site-scale geology.
- mars2020-perseverance-traverse: historical Perseverance traverse compiled by NASA Trek: 332 sol-tagged segments, sols 14-1176, total ~27.2 km. Not a live position feed.
- mars2020-landing-ellipse: Mars 2020 landing-ellipse polygon (NASA Trek). The service publishes no ellipse dimensions or target name.
- mars2020-science-stops: NASA Trek "mars2020_waypoints" bookmarks: 8 named waypoints (Jezero Crater, Perseverance Landing Ellipse, Western/Northern Delta Deposit, Western Breach, Western/Northern Inflow Channel, Outflow Channel). 6 lie inside the CTX mosaic; Northern Inflow Channel (18.870 N) and Outflow Channel (78.713 E) lie outside it. The service publishes elevation = 0 for every waypoint — that value is NOT a measured elevation and must never be quoted as one. Destinations of interest, not a hazard map.
- jezero-iau-nomenclature: USGS/IAU Gazetteer of Planetary Nomenclature via NASA Trek. Only one IAU feature is in this area: Jezero, a 47.52 km crater in the Syrtis Major quadrangle, status "Adopted by IAU". A label identifies the feature centre; no boundary or rim is published or drawn.
- jezero-hydrous-minerals-omega-crism: OMEGA (Mars Express) + CRISM (MRO) hydrous-mineral detections served by NASA Trek as an ArcGIS export; prepared as a 1400x1400 (~36 m/px) transparency over 77.00-77.86 E, 18.05-18.88 N. Detections are sparse class pixels: presence only, no abundance, confidence, or class legend published. The chloride-salt THEMIS service was checked on 2026-11-14 and had zero detections here, so no chloride layer is offered.
- Environment context: Mars Ls and LMST are modelled (Mars24, Allison & McEwen 2000) and validated against 4,745 MSL/REMS sols: median |dLs| 0.51 deg, p95 1.05 deg, max 1.29 deg (feed Ls is integer-truncated). Public MSL weather snapshot: sol 4995, 2026-08-25, Ls 341, temp -71..-5 C, pressure 777 Pa, opacity Sunny, Gale Crater — stale, not current, not Jezero. Jezero MEDA in the same feed: 7 sols (2024-04-21..27), temperatures missing. Radiation: not integrated (unknown).

Canonical Jezero context: Jezero Crater is ~45 km wide (IAU gazetteer diameter 47.52 km), on the western edge of Isidis Planitia (NASA, 2018). It hosted an ancient lake and a fan-shaped river delta. Perseverance touched down on 2021-02-18 at "Octavia E. Butler Landing" (an informal mission-team name), ~2 km from the western delta front (Sun et al., 2023).`;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function fail(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

/** Clamp a string to n chars without splitting surrogate pairs badly. */
function clamp(value: string, n: number): string {
  return value.length <= n ? value : value.slice(0, n);
}

function isChatMessageArray(value: unknown): value is ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) {
    return false;
  }
  return value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'role' in item &&
      'content' in item &&
      ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant') &&
      typeof (item as ChatMessage).content === 'string' &&
      (item as ChatMessage).content.trim().length > 0 &&
      (item as ChatMessage).content.length <= MAX_MESSAGE_CHARS,
  );
}

/** Allowlist + clamp the context sections. Unknown keys are ignored.
 *  Lines beginning with '#' are stripped: they would read as prompt
 *  structure inside the system prompt (prompt-injection surface). */
function sanitizeContext(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const context = value as Record<string, unknown>;
  const sections: string[] = [];
  for (const key of CONTEXT_KEYS) {
    const raw = context[key];
    if (typeof raw !== 'string' || raw.trim().length === 0) continue;
    const cleaned = clamp(raw, MAX_CONTEXT_CHARS).replace(/(^|\n)[^\S\n]*#{1,6}[^\n]*/g, '$1');
    sections.push(`## ${key}\n${cleaned}`);
  }
  if (sections.length === 0) return '';
  return `\n\nCURRENT APP CONTEXT (reported by the SOLARA app at request time; honor its labels, never contradict them):\n${sections.join('\n')}`;
}

function buildSystemPrompt(contextBlock: string): string {
  return `${instructions.trim()}\n\n${VERIFIED_DATASET_FACTS}${contextBlock}`;
}

async function requestOpenRouter(
  env: Env,
  messages: OpenRouterMessage[],
  requestOrigin: string | null,
  allowTools: boolean,
): Promise<OpenRouterRequestResult> {
  const model = (env.OPENROUTER_MODEL ?? '').trim() || DEFAULT_MODEL;
  const headers: Record<string, string> = {
    authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    'content-type': 'application/json',
    'x-title': 'SOLARA',
  };
  if (requestOrigin) headers['http-referer'] = requestOrigin;

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        ...(allowTools
          ? {
              tools: SCIENTIFIC_TOOL_DEFINITIONS,
              tool_choice: 'auto',
              parallel_tool_calls: false,
            }
          : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      response: fail(
        'upstream-unreachable',
        'Could not reach the OpenRouter API. Solara AI is unavailable right now.',
        502,
      ),
    };
  }

  if (!upstream.ok) {
    if (upstream.status === 429) {
      return {
        ok: false,
        response: fail(
          'rate-limited',
          'The Solara AI provider rate limit is active. Try again shortly.',
          429,
        ),
      };
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return {
        ok: false,
        response: fail(
          'upstream-auth',
          'The Solara AI proxy key was rejected by OpenRouter. Check OPENROUTER_API_KEY.',
          502,
        ),
      };
    }
    let detail = '';
    try {
      detail = clamp(JSON.stringify(await upstream.json()), MAX_UPSTREAM_DETAIL_CHARS);
    } catch {
      detail = '';
    }
    return {
      ok: false,
      response: fail(
        'upstream-error',
        `OpenRouter returned HTTP ${upstream.status}.${
          allowTools && upstream.status === 404 ? ' The selected model may not support tool calling.' : ''
        }${detail ? ` ${detail}` : ''}`,
        502,
      ),
    };
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return { ok: false, response: fail('upstream-error', 'OpenRouter returned a malformed response.', 502) };
  }
  const choices = isRecord(payload) ? payload.choices : undefined;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const rawMessage = isRecord(first) ? first.message : undefined;
  if (!isRecord(rawMessage)) {
    return { ok: false, response: fail('upstream-error', 'OpenRouter returned no assistant message.', 502) };
  }
  const rawContent = rawMessage.content;
  const content = typeof rawContent === 'string' ? rawContent : rawContent === null || rawContent === undefined ? null : undefined;
  if (content === undefined) {
    return { ok: false, response: fail('upstream-error', 'OpenRouter returned an invalid assistant message.', 502) };
  }

  const rawToolCalls = rawMessage.tool_calls;
  if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) {
    return { ok: false, response: fail('upstream-error', 'OpenRouter returned malformed tool calls.', 502) };
  }
  const toolCalls: OpenRouterToolCall[] = [];
  const callIds = new Set<string>();
  for (const rawCall of rawToolCalls ?? []) {
    if (!isRecord(rawCall) || rawCall.type !== 'function' || typeof rawCall.id !== 'string') {
      return { ok: false, response: fail('upstream-error', 'OpenRouter returned a malformed tool call.', 502) };
    }
    const rawFunction = rawCall.function;
    if (
      !isRecord(rawFunction) ||
      typeof rawFunction.name !== 'string' ||
      typeof rawFunction.arguments !== 'string' ||
      rawCall.id.length === 0 ||
      rawCall.id.length > 128 ||
      callIds.has(rawCall.id)
    ) {
      return { ok: false, response: fail('upstream-error', 'OpenRouter returned a malformed tool call.', 502) };
    }
    callIds.add(rawCall.id);
    toolCalls.push({
      id: rawCall.id,
      type: 'function',
      function: { name: rawFunction.name, arguments: rawFunction.arguments },
    });
  }

  const usedModel = isRecord(payload) && typeof payload.model === 'string' ? payload.model : model;
  return { ok: true, content, toolCalls, model: usedModel };
}

function assistantResponse(content: string | null, model: string): Response {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail('upstream-error', 'OpenRouter returned no assistant content.', 502);
  }
  return json({ reply: content, model }, 200);
}

async function callOpenRouter(
  env: Env,
  messages: ChatMessage[],
  contextBlock: string,
  requestOrigin: string | null,
): Promise<Response> {
  const providerMessages: OpenRouterMessage[] = [
    { role: 'system', content: buildSystemPrompt(contextBlock) },
    ...messages,
  ];
  const seenToolCallIds = new Set<string>();
  let executedToolCalls = 0;
  let usedModel = (env.OPENROUTER_MODEL ?? '').trim() || DEFAULT_MODEL;

  for (let round = 0; round < MAX_SCIENCE_TOOL_ROUNDS; round += 1) {
    const result = await requestOpenRouter(
      env,
      providerMessages,
      requestOrigin,
      executedToolCalls < MAX_SCIENCE_TOOL_CALLS,
    );
    if (!result.ok) return result.response;
    usedModel = result.model;

    if (result.toolCalls.length === 0) return assistantResponse(result.content, usedModel);
    if (executedToolCalls >= MAX_SCIENCE_TOOL_CALLS) {
      return fail(
        'upstream-error',
        'OpenRouter continued requesting scientific tools after the per-turn tool limit.',
        502,
      );
    }
    if (result.toolCalls.length > MAX_TOOL_CALLS_PER_RESPONSE) {
      return fail('upstream-error', 'OpenRouter returned too many tool calls in one response.', 502);
    }
    for (const toolCall of result.toolCalls) {
      if (seenToolCallIds.has(toolCall.id)) {
        return fail('upstream-error', 'OpenRouter reused a tool-call id within one turn.', 502);
      }
      seenToolCallIds.add(toolCall.id);
    }

    providerMessages.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls,
    });

    const availableSlots = MAX_SCIENCE_TOOL_CALLS - executedToolCalls;
    const toolResults = await Promise.all(
      result.toolCalls.map((toolCall, index) =>
        index < availableSlots
          ? runScientificToolCall(toolCall.function.name, toolCall.function.arguments)
          : Promise.resolve(
              JSON.stringify({
                status: 'unavailable',
                warnings: ['This tool was not run because the per-turn scientific tool-call limit was reached.'],
              }),
            ),
      ),
    );
    executedToolCalls += Math.min(result.toolCalls.length, availableSlots);
    for (let index = 0; index < result.toolCalls.length; index += 1) {
      const toolCall = result.toolCalls[index]!;
      providerMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResults[index]!,
      });
    }
  }

  // Give the model one final chance to summarize tool results with tools
  // disabled. This bounds both external data calls and provider-side loops.
  const finalResult = await requestOpenRouter(env, providerMessages, requestOrigin, false);
  if (!finalResult.ok) return finalResult.response;
  if (finalResult.toolCalls.length > 0) {
    return fail('upstream-error', 'OpenRouter requested another tool after the tool-call budget was exhausted.', 502);
  }
  return assistantResponse(finalResult.content, finalResult.model || usedModel);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Route: NASA MEDA environmental observations (PDS Atmospheres)
    if (url.pathname === '/api/meda/environment/latest') {
      if (request.method !== 'GET') {
        return fail('method-not-allowed', 'Use GET for this endpoint.', 405);
      }
      return handleMedaEnvironmentLatest(request, env);
    }

    // NASA raw-image list and fixed-ID file download routes. Both destinations
    // are constructed from validated values in roverImages.ts.
    if (url.pathname === '/api/rovers/perseverance/images') {
      if (request.method !== 'GET') {
        return fail('method-not-allowed', 'Use GET for this endpoint.', 405);
      }
      return handlePerseveranceImages(request);
    }
    if (
      url.pathname.startsWith('/api/rovers/perseverance/images/') &&
      url.pathname.endsWith('/download')
    ) {
      if (request.method !== 'GET') {
        return fail('method-not-allowed', 'Use GET for this endpoint.', 405);
      }
      return handlePerseveranceImageDownload(request);
    }

    if (url.pathname !== '/api/copilot/chat') {
      return fail('not-found', 'Unknown endpoint.', 404);
    }
    if (request.method !== 'POST') {
      return fail('method-not-allowed', 'Use POST for this endpoint.', 405);
    }

    if (typeof env.OPENROUTER_API_KEY !== 'string' || env.OPENROUTER_API_KEY.trim().length === 0) {
      return fail(
        'copilot-unconfigured',
        'The Solara AI proxy has no OPENROUTER_API_KEY configured. Ask the operator to set the Worker secret.',
        503,
      );
    }

    // Reject oversized uploads before buffering the body when the client
    // declares its length; the post-read check below is the fallback for
    // missing/lying content-length headers.
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return fail('payload-too-large', 'Conversation payload exceeds the proxy limit.', 413);
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return fail('payload-too-large', 'Conversation payload exceeds the proxy limit.', 413);
    }

    let body: CopilotChatRequestBody;
    try {
      body = JSON.parse(rawBody) as CopilotChatRequestBody;
    } catch {
      return fail('invalid-request', 'Request body is not valid JSON.', 400);
    }
    if (!isChatMessageArray(body.messages)) {
      return fail(
        'invalid-request',
        `messages must be a non-empty array of at most ${MAX_MESSAGES} {role, content} items with role "user" or "assistant".`,
        400,
      );
    }

    return callOpenRouter(env, body.messages, sanitizeContext(body.context), request.headers.get('origin'));
  },
};
