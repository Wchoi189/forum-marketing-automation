import React, { useEffect, useState } from 'react';
import { CopilotSidebar } from '@copilotkit/react-ui';
import { useCopilotReadable, useCopilotAction } from '@copilotkit/react-core';
import '@copilotkit/react-ui/styles.css';

// ── Shared suggestion card ────────────────────────────────────────────────────

interface SuggestionCardProps {
  label: string;
  text?: string;
  reasoning?: string;
  status: string;
  onCopy?: () => void;
}

function SuggestionCard({ label, text, reasoning, status, onCopy }: SuggestionCardProps) {
  const [copied, setCopied] = useState(false);

  if (status === 'inProgress') {
    return (
      <div className="rounded-lg border border-violet-500/30 bg-violet-900/20 p-3 text-sm text-violet-300 animate-pulse">
        Generating {label.toLowerCase()}…
      </div>
    );
  }
  if (!text) return null;

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy?.();
  };

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-900/20 p-3 space-y-2">
      <div className="text-xs font-semibold text-violet-400 uppercase tracking-wide">{label}</div>
      {reasoning && (
        <div className="text-xs text-violet-300/70 italic">{reasoning}</div>
      )}
      <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">{text}</div>
      <button
        onClick={copy}
        className="text-xs px-3 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

interface ThreadTurn {
  direction: 'INBOUND' | 'OUTBOUND';
  utterance: string | null;
  intent: string | null;
  createdAt: string;
}

interface Props {
  userKey: string | null;
  children: React.ReactNode;
}

const STYLE_HINT =
  'Style: casual-but-professional 해요체. Concise (≤400 chars). No filler phrases.\n' +
  'Service rules: 6-month ₩25,000 | 12-month ₩50,000. IBK bank transfer only. No top-offs or extensions — new subscription required after expiry.';

function logApplied(userKey: string | null, actionName: string, outputLength: number) {
  fetch('/api/kakao/coach-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userKey, actionName, eventType: 'applied', outputLength }),
  }).catch(() => {});
}

export default function CoachSidebar({ userKey, children }: Props) {
  const [turns, setTurns] = useState<ThreadTurn[]>([]);

  useEffect(() => {
    if (!userKey) { setTurns([]); return; }
    fetch(`/api/kakao/thread/${encodeURIComponent(userKey)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setTurns(data?.turns ?? []))
      .catch(() => setTurns([]));
  }, [userKey]);

  useCopilotReadable({
    description: 'Active conversation thread (last 20 turns, PII scrubbed)',
    value: turns.length
      ? turns.map(t => `[${t.direction}] ${t.utterance ?? ''}`).join('\n')
      : 'No thread selected.',
  });

  useCopilotReadable({
    description: 'SharePlan operator style and service rules',
    value: STYLE_HINT,
  });

  useCopilotReadable({
    description: 'Intents observed in this conversation',
    value: turns.length
      ? [...new Set(turns.map(t => t.intent).filter(Boolean))].slice(0, 3).join(', ') || 'none'
      : 'none',
  });

  // ── Coach actions ────────────────────────────────────────────────────────────

  useCopilotAction({
    name: 'draftReply',
    description:
      'Generate a complete reply to the current conversation in SharePlan\'s natural style (max 400 chars, Korean). Operator reviews before copying.',
    parameters: [
      {
        name: 'tone',
        type: 'string',
        description: 'Desired tone of the reply',
        enum: ['neutral', 'warm', 'formal', 'apologetic'],
      },
      {
        name: 'suggestion',
        type: 'string',
        description: 'The drafted reply (Korean, max 400 characters)',
      },
    ],
    handler: async ({ suggestion }) => suggestion ?? '',
    render: ({ args, status }) => (
      <SuggestionCard
        label="Draft Reply"
        text={args.suggestion}
        status={status}
        onCopy={() => logApplied(userKey, 'draftReply', args.suggestion?.length ?? 0)}
      />
    ),
  });

  useCopilotAction({
    name: 'refineMessage',
    description:
      'Rewrite a draft the operator has typed for better rhetoric, politeness level, or marketing framing.',
    parameters: [
      {
        name: 'draft',
        type: 'string',
        description: "Operator's rough draft to refine",
      },
      {
        name: 'style',
        type: 'string',
        description: 'Refinement style',
        enum: ['polish', 'persuade', 'shorten', 'formalize', 'casualize'],
      },
      {
        name: 'suggestion',
        type: 'string',
        description: 'The rewritten message',
      },
    ],
    handler: async ({ suggestion }) => suggestion ?? '',
    render: ({ args, status }) => (
      <SuggestionCard
        label="Refined Message"
        text={args.suggestion}
        status={status}
        onCopy={() => logApplied(userKey, 'refineMessage', args.suggestion?.length ?? 0)}
      />
    ),
  });

  useCopilotAction({
    name: 'suggestFollowUp',
    description:
      'Given the conversation state, suggest the most appropriate next message to move the subscription flow forward.',
    parameters: [
      {
        name: 'suggestion',
        type: 'string',
        description: 'The suggested next message (Korean)',
      },
      {
        name: 'reasoning',
        type: 'string',
        description: 'Brief reasoning for why this follow-up fits the conversation',
      },
    ],
    handler: async ({ suggestion }) => suggestion ?? '',
    render: ({ args, status }) => (
      <SuggestionCard
        label="Follow-up Suggestion"
        text={args.suggestion}
        reasoning={args.reasoning}
        status={status}
        onCopy={() => logApplied(userKey, 'suggestFollowUp', args.suggestion?.length ?? 0)}
      />
    ),
  });

  useCopilotAction({
    name: 'translateToKorean',
    description:
      'Translate or localize a message into natural Korean with correct business register (존댓말).',
    parameters: [
      {
        name: 'text',
        type: 'string',
        description: 'Source text in any language',
      },
      {
        name: 'register',
        type: 'string',
        description: 'Korean speech register',
        enum: ['합쇼체', '해요체'],
      },
      {
        name: 'translation',
        type: 'string',
        description: 'Natural Korean translation',
      },
    ],
    handler: async ({ translation }) => translation ?? '',
    render: ({ args, status }) => (
      <SuggestionCard
        label="Korean Translation"
        text={args.translation}
        status={status}
        onCopy={() => logApplied(userKey, 'translateToKorean', args.translation?.length ?? 0)}
      />
    ),
  });

  return (
    <CopilotSidebar
      defaultOpen
      labels={{
        title: 'Communications Coach',
        initial: userKey
          ? `Coaching on ${userKey}. Ask me to draft a reply, refine a message, suggest a follow-up, or translate to Korean.`
          : 'Select a user above to load their conversation context.',
      }}
    >
      {children}
    </CopilotSidebar>
  );
}
