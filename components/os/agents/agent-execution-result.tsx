import { cn } from '@/lib/utils';
import { CONFIDENCE_META } from '@/lib/agents/display';
import type { AgentExecutionResult } from '@/types';

/**
 * Renders a structured execution result. AI-generated content is rendered as
 * plain text only (React escapes it) — never as HTML/markdown — so a model
 * response can't inject markup. The shape is already validated by the service.
 */
export function AgentExecutionResultView({ result }: { result: AgentExecutionResult }) {
  const confidence = CONFIDENCE_META[result.confidence];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Summary
          </h4>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] font-medium',
              confidence.badge,
            )}
          >
            {confidence.label}
          </span>
        </div>
        <p className="mt-1.5 text-sm whitespace-pre-wrap">{result.summary}</p>
      </div>

      <ResultList title="Key points" items={result.keyPoints} />
      <ResultList title="Risks" items={result.risks} />
      <ResultList title="Recommendations" items={result.recommendations} />
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h4>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm">
            <span
              className="text-muted-foreground mt-1.5 size-1 shrink-0 rounded-full bg-current"
              aria-hidden
            />
            <span className="whitespace-pre-wrap">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
