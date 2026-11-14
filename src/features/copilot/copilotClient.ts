/**
 * Typed client for the SOLARA Mission Copilot proxy (worker/src/index.ts;
 * Vite dev-proxies /api/copilot → 127.0.0.1:8787).
 *
 * The client NEVER sends a 'system' role and never carries credentials:
 * the Worker injects the honesty guardrails server-side and holds the
 * OPENROUTER_API_KEY secret. No VITE_OPENROUTER_API_KEY exists by design.
 */

export type CopilotErrorCode =
  | 'invalid-request'
  | 'payload-too-large'
  | 'rate-limited'
  | 'upstream-auth'
  | 'upstream-error'
  | 'upstream-unreachable'
  | 'copilot-unconfigured'
  | 'not-found'
  | 'method-not-allowed'
  /** Mapped client-side: the fetch itself did not complete. */
  | 'network-error'
  /** Mapped client-side: the proxy answered something unusable. */
  | 'invalid-response';

export interface CopilotChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Context sections the Worker clamps and labels before the model call. */
export interface CopilotContext {
  explorationRegion?: string;
  selectedLocation?: string;
  visibleLayers?: string;
  missionPlan?: string;
  /** NASA MEDA/PDS in-situ observations (fetched by the app, worker-clamped). */
  environmentalObservations?: string;
  /** Modelled Mars time (Ls/LMST) and stale weather-snapshot context. */
  environment?: string;
  dataNotAvailable?: string;
}

export interface CopilotReply {
  reply: string;
  /** Model id as reported by the proxy. */
  model: string;
}

/** Maximum conversation length the Worker accepts; the client trims to
 *  this before sending so long conversations never hit the server limit. */
export const MAX_CONVERSATION_MESSAGES = 24;

/** Error codes the Worker contract defines. */
const KNOWN_ERROR_CODES: ReadonlySet<string> = new Set([
  'invalid-request',
  'payload-too-large',
  'rate-limited',
  'upstream-auth',
  'upstream-error',
  'upstream-unreachable',
  'copilot-unconfigured',
  'not-found',
  'method-not-allowed',
]);

export class CopilotClientError extends Error {
  readonly code: CopilotErrorCode;
  constructor(code: CopilotErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** POST /api/copilot/chat. Throws CopilotClientError on any failure. */
export async function sendCopilotChat(
  messages: readonly CopilotChatMessage[],
  context?: CopilotContext,
): Promise<CopilotReply> {
  let response: Response;
  try {
    response = await fetch('/api/copilot/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, context }),
    });
  } catch {
    throw new CopilotClientError(
      'network-error',
      'The request to the Solara AI proxy did not complete.',
    );
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const err = body as { error?: unknown; message?: unknown } | null;
    if (
      err !== null &&
      typeof err === 'object' &&
      typeof err.error === 'string' &&
      typeof err.message === 'string' &&
      err.message.trim().length > 0
    ) {
      if (KNOWN_ERROR_CODES.has(err.error)) {
        throw new CopilotClientError(err.error as CopilotErrorCode, err.message);
      }
      throw new CopilotClientError('upstream-error', err.message);
    }
    throw new CopilotClientError(
      'invalid-response',
      `The Solara AI proxy returned HTTP ${response.status} with an unusable body.`,
    );
  }

  const payload = body as { reply?: unknown; model?: unknown } | null;
  const reply = payload?.reply;
  if (typeof reply !== 'string' || reply.trim().length === 0) {
    throw new CopilotClientError('invalid-response', 'The Solara AI proxy returned no assistant content.');
  }
  const model = payload?.model;
  return {
    reply,
    model: typeof model === 'string' && model.trim().length > 0 ? model : 'unknown model',
  };
}
