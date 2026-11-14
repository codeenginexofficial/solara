/**
 * CopilotPanel — the workspace "Solara AI" tab.
 *
 * Talks to the Copilot proxy (POST /api/copilot/chat, dev-proxied to the
 * Cloudflare Worker). The proxy injects the honesty guardrails server-side;
 * this client never sends a system role or credentials. Conversation state
 * is in-memory (lost on reload — same philosophy as the mission store).
 * Assistant replies are plain text with preserved line breaks; nothing is
 * ever rendered as HTML.
 *
 * Panel sizing/collapse is owned by ContextWorkspace; this component fills
 * the tab panel and manages only conversation state.
 */

import { useEffect, useRef, useState } from 'react';
import { Eraser, Send } from 'lucide-react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import {
  CopilotClientError,
  MAX_CONVERSATION_MESSAGES,
  sendCopilotChat,
  type CopilotChatMessage,
} from '../../copilot/copilotClient';

export interface CopilotContextPayload {
  explorationRegion?: string;
  selectedLocation?: string;
  visibleLayers?: string;
  missionPlan?: string;
  environmentalObservations?: string;
  environment?: string;
  dataNotAvailable?: string;
}

export interface CopilotPanelProps {
  /** Context sections attached to every send (built by HabitatMode). */
  context: CopilotContextPayload;
}

type CopilotStatus = 'idle' | 'ready' | 'unconfigured' | 'offline';

const STATUS_CHIP: Record<CopilotStatus, { label: string; tone: 'neutral' | 'ok' | 'warn' }> = {
  idle: { label: 'Idle', tone: 'neutral' },
  ready: { label: 'Ready', tone: 'ok' },
  unconfigured: { label: 'Unconfigured', tone: 'warn' },
  offline: { label: 'Offline', tone: 'warn' },
};

/** Grounded intro (verified sources only, no external links needed). */
const WELCOME_FACTS =
  'Jezero Crater is ~45 km wide and sits on the western edge of Isidis Planitia. It hosted an ancient lake and a fan-shaped river delta. The Perseverance rover landed there on 2021-02-18 at "Octavia E. Butler Landing" (an informal mission-team name), ~2 km from the western delta front.';

const STARTER_QUESTIONS: readonly string[] = [
  'What data is SOLARA using for Jezero?',
  'Elevation at the selected point',
  'Summarize my current mission plan',
  'What can you not tell me about this site?',
];

/** Honest per-code wording; never fabricate an assistant reply for these. */
function errorMessage(err: CopilotClientError): string {
  switch (err.code) {
    case 'copilot-unconfigured':
      return 'Solara AI is unconfigured: the proxy has no OPENROUTER_API_KEY. Ask the operator to set the Worker secret (npm run dev:copilot).';
    case 'rate-limited':
      return 'Solara AI provider rate limit active — try again shortly.';
    case 'upstream-auth':
    case 'upstream-error':
    case 'upstream-unreachable':
      return `Solara AI provider unavailable — ${err.message}`;
    case 'network-error':
      return 'Solara AI proxy not reachable — is `npm run dev:copilot` running?';
    default:
      return err.message;
  }
}

export function CopilotPanel({ context }: CopilotPanelProps) {
  const [messages, setMessages] = useState<CopilotChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<CopilotStatus>('idle');
  const [modelId, setModelId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<CopilotClientError | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** Bumped on every send and on clear; in-flight resolutions whose
   *  sequence is stale must not mutate the conversation. */
  const sendSequenceRef = useRef(0);

  /* Auto-grow the composer with the draft (capped). */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  /* Two-step clear confirm reverts on its own if abandoned. */
  useEffect(() => {
    if (!confirmingClear) return;
    const timer = setTimeout(() => setConfirmingClear(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingClear]);

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    if (!text || pending) return;
    const userMessage: CopilotChatMessage = { role: 'user', content: text };
    const nextMessages = [...messages, userMessage];
    const seq = ++sendSequenceRef.current;

    setMessages(nextMessages);
    setDraft('');
    setLastError(null);
    setPending(true);
    try {
      // The Worker rejects conversations longer than its limit; trim here
      // (oldest dropped) so long chats degrade gracefully instead of
      // failing on invalid-request.
      const { reply, model } = await sendCopilotChat(
        nextMessages.slice(-MAX_CONVERSATION_MESSAGES),
        context,
      );
      if (seq !== sendSequenceRef.current) return;
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
      setModelId(model);
      setStatus('ready');
    } catch (e) {
      const err =
        e instanceof CopilotClientError
          ? e
          : new CopilotClientError('invalid-response', e instanceof Error ? e.message : String(e));
      if (seq !== sendSequenceRef.current) return;
      // Revert the optimistic user entry and restore the draft — a failed
      // send never becomes a fabricated exchange.
      setMessages(messages);
      setDraft(text);
      setLastError(err);
      if (err.code === 'copilot-unconfigured') setStatus('unconfigured');
      else if (err.code === 'network-error') setStatus('offline');
    } finally {
      setPending(false);
    }
  };

  const handleClearClick = () => {
    if (messages.length === 0 || pending) return;
    if (!confirmingClear) {
      setConfirmingClear(true);
      return;
    }
    setConfirmingClear(false);
    // Invalidate any in-flight send: its resolution must not resurrect
    // the conversation that was just cleared.
    sendSequenceRef.current += 1;
    setMessages([]);
    setLastError(null);
  };

  const chip = STATUS_CHIP[status];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="copilot-panel">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-edge/60 px-3">
        <Badge tone={chip.tone} data-testid="copilot-status">
          {chip.label}
        </Badge>
        {status === 'ready' && modelId && (
          <span
            className="hidden shrink-0 truncate font-mono text-[10px] text-ink-subtle xl:inline"
            title="Model id reported by the Solara AI proxy"
          >
            {modelId}
          </span>
        )}
        <span className="min-w-0 flex-1" aria-hidden="true" />
        {confirmingClear && (
          <span className="shrink-0 text-[10.5px] text-danger" aria-hidden="true">
            Confirm clear
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label={confirmingClear ? 'Confirm clear conversation' : 'Clear conversation'}
          title={confirmingClear ? 'Confirm clear conversation' : 'Clear conversation'}
          onClick={handleClearClick}
          className={cn('rounded-sm', confirmingClear && 'text-danger hover:text-danger')}
        >
          <Eraser />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="text-xs leading-relaxed text-ink-muted" data-testid="copilot-welcome">
            <p>{WELCOME_FACTS}</p>
            <p className="mt-1.5 text-[10.5px] text-ink-subtle">Sources: NASA (2018, 2021); Sun et al. (2023)</p>
            <div className="mt-3 text-[10.5px] uppercase tracking-[0.06em] text-ink-subtle">Start with</div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {STARTER_QUESTIONS.map((question) => (
                <Button
                  key={question}
                  variant="outline"
                  size="sm"
                  className="justify-start text-left"
                  disabled={pending}
                  onClick={() => void send(question)}
                >
                  {question}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <ol
            className="flex flex-col gap-3"
            aria-label="Solara AI conversation"
            aria-live="polite"
            data-testid="copilot-conversation"
          >
            {messages.map((message, index) => (
              <li
                key={index}
                className={cn(
                  'rounded-lg border px-3 py-2',
                  message.role === 'user'
                    ? 'border-accent/40 bg-accent-subtle'
                    : 'border-edge bg-panel-raised/70',
                )}
              >
                <span
                  className={cn(
                    'mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em]',
                    message.role === 'user' ? 'text-accent-strong' : 'text-ink-subtle',
                  )}
                >
                  {message.role === 'user' ? 'You' : 'Solara AI'}
                </span>
                {/* Plain text only — never dangerouslySetInnerHTML. */}
                <div
                  className={cn(
                    'whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink',
                  )}
                >
                  {message.content}
                </div>
              </li>
            ))}
          </ol>
        )}
        {pending && (
          <div className="mt-3 flex items-center gap-2 text-xs text-ink-muted" data-testid="copilot-waiting">
            <span className="inline-block size-2 rounded-full bg-accent opacity-40" aria-hidden="true" />
            Waiting for Solara AI…
          </div>
        )}
      </div>

      {lastError && (
        <div
          className="mx-3 mb-2 shrink-0 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs leading-snug text-danger"
          role="alert"
          data-testid="copilot-error"
        >
          {errorMessage(lastError)}
        </div>
      )}

      <div className="shrink-0 border-t border-edge/60 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder="Ask about the site, the data, or the plan…"
            aria-label="Solara AI message"
            data-testid="copilot-composer"
            className="max-h-32 min-h-9 w-full resize-none rounded-md border border-edge bg-elevated px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-ink-muted"
          />
          <Button
            variant="accent"
            size="sm"
            onClick={() => void send()}
            disabled={!draft.trim() || pending}
            aria-label="Send message"
            className="h-9 px-3.5 gap-1.5 font-medium rounded-md"
          >
            <Send className="size-3.5" aria-hidden="true" />
            <span>Send</span>
          </Button>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-ink-subtle">
          In-memory conversation — lost on reload. Enter sends.
        </p>
      </div>
    </div>
  );
}
