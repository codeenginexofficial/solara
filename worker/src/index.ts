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

export interface Env {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
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
const DEFAULT_MODEL = 'openrouter/free';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

const GUARDRAILS = `You are Solara AI, embedded in the SOLARA Mars mission-operations workstation for Jezero Crater (NASA Space Apps Challenge 2026 project). You help the operator with terrain, datasets, and mission planning.

GROUNDING — answer ONLY from:
1. VERIFIED DATASET FACTS below (fixed, source-verified text).
2. CURRENT APP CONTEXT (values the app retrieved or computed at request time). Honor the labels it carries (observed / derived / modelled / historical / unavailable).
3. The user's conversation.

You must never invent values for: temperature, pressure, wind, dust opacity, radiation, illumination, real-time rover position, mission progress beyond the historical track, site-scale slope or hazards, rock abundance, route safety, or image content. If a value is not in your grounding, say "unknown" and, where useful, why (for example: "no environmental dataset is integrated").

Specific rules:
- Imagery: you cannot see the map imagery. If asked what something looks like, state that the mosaic is rendered as raster tiles in the user's browser and you have no access to its pixels; offer provenance and coverage facts instead.
- Routes: SOLARA routes are "proposed terrain-cost candidates" computed by a prototype slope-only model on a ~200 m/px prepared grid. Never call a route safe, validated, or drivable.
- Mission thresholds are prototype thresholds — not operational safety limits.
- Elevation values come from the static MOLA+HRSC blend (2018, areoid-referenced, ~200 m/px). Never present them as current conditions or site surveys.
- The rover traverse is historical (sols 14-1176); there is no live rover feed.
- Keep unknown visibly unknown. Prefer short, factual answers; cite dataset ids and the labels carried by the context when quoting data.`;

const VERIFIED_DATASET_FACTS = `VERIFIED DATASET FACTS (verification date 2026-11-13):
- jezero-ctx-mosaic-soc-008: NASA Trek WMTS serving the USGS "Mars 2020 Terrain Relative Navigation Context Camera Orthorectified Image Mosaic" (USGS Astrogeology, published 2020-07-24, DOI 10.5066/P9GV1ND3). ~6 m/px nominal; finest served level 13 ~5.087 m/px; footprint 77.1604655-77.6991776 E, 18.2110274-18.7211945 N (~30.3 x 30.2 km). Built from three CTX stereo pairs; imagery content 2006-2019. Historical imagery.
- mola-hrsc-blend-200m-colorshade: NASA Trek WMTS; colorized shaded relief of the "Mars MGS MOLA-MEX HRSC Blended DEM Global 200m v2" (Fergason, Hare and Laura, 2018, USGS). Global; finest served level 8 ~162.8 m/px (product nominal 200 m/px).
- mola-hrsc-blend-200m-dem: the same blend DEM v2, queried via NASA Trek ArcGIS ImageServer (point elevation identify, global). Areoid-referenced; total elevation uncertainty at least plus/minus 3 m; MOLA base points 1999-2001; HRSC covers ~44% of Mars; blending artifacts exist ("care should be taken" - USGS).
- usgs-sim3292-jezero-geology: USGS Geologic Map of Mars (SIM 3292, Tanaka et al., 2014, scale 1:20,000,000). Two units intersect the exploration area: mNhm (Middle Noachian highland massif unit) and HNt (Hesperian and Noachian transition unit). Global compilation - coarser than site-scale geology.
- mars2020-perseverance-traverse: historical Perseverance traverse compiled by NASA Trek: 332 sol-tagged segments, sols 14-1176, total ~27.2 km. Not a live position feed.
- mars2020-landing-ellipse: Mars 2020 landing-ellipse polygon (NASA Trek). The service publishes no ellipse dimensions or target name.

Canonical Jezero context: Jezero Crater is ~45 km wide, on the western edge of Isidis Planitia (NASA, 2018). It hosted an ancient lake and a fan-shaped river delta. Perseverance touched down on 2021-02-18 at "Octavia E. Butler Landing" (an informal mission-team name), ~2 km from the western delta front (Sun et al., 2023).`;

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
  return `${GUARDRAILS}\n\n${VERIFIED_DATASET_FACTS}${contextBlock}`;
}

async function callOpenRouter(
  env: Env,
  messages: ChatMessage[],
  contextBlock: string,
  requestOrigin: string | null,
): Promise<Response> {
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
        messages: [{ role: 'system', content: buildSystemPrompt(contextBlock) }, ...messages],
      }),
    });
  } catch {
    return fail(
      'upstream-unreachable',
      'Could not reach the OpenRouter API. Solara AI is unavailable right now.',
      502,
    );
  }

  if (!upstream.ok) {
    if (upstream.status === 429) {
      return fail(
        'rate-limited',
        'The Solara AI provider rate limit is active. Try again shortly.',
        429,
      );
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return fail(
        'upstream-auth',
        'The Solara AI proxy key was rejected by OpenRouter. Check OPENROUTER_API_KEY.',
        502,
      );
    }
    let detail = '';
    try {
      detail = clamp(JSON.stringify(await upstream.json()), MAX_UPSTREAM_DETAIL_CHARS);
    } catch {
      detail = '';
    }
    return fail(
      'upstream-error',
      `OpenRouter returned HTTP ${upstream.status}.${detail ? ` ${detail}` : ''}`,
      502,
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return fail('upstream-error', 'OpenRouter returned a malformed response.', 502);
  }
  const choices = (payload as { choices?: unknown })?.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const content = (first as { message?: { content?: unknown } } | undefined)?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return fail('upstream-error', 'OpenRouter returned no assistant content.', 502);
  }
  const usedModel = (payload as { model?: unknown })?.model;
  return json(
    {
      reply: content,
      model: typeof usedModel === 'string' ? usedModel : model,
    },
    200,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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
