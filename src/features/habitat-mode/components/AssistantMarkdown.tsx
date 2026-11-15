import rehypeKatex from 'rehype-katex';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { cn } from '../../../lib/utils';

const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mb-2 mt-3 text-sm font-semibold text-ink">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-1.5 mt-3 text-[13px] font-semibold text-ink">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1 mt-2 text-xs font-semibold text-ink">{children}</h5>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-edge pl-3 text-ink-muted">{children}</blockquote>
  ),
  a: ({ children, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-ink underline decoration-ink-subtle underline-offset-2 hover:text-ink-muted"
    >
      {children}
    </a>
  ),
  code: ({ children, className, node: _node, ...props }) => (
    <code {...props} className={cn('font-mono text-[11.5px] text-ink', className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-sm border border-edge bg-surface p-2 text-[11.5px] leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-[11.5px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-edge px-2 py-1 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-edge/70 px-2 py-1 align-top">{children}</td>,
};

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
      components={MARKDOWN_COMPONENTS}
    >
      {children}
    </ReactMarkdown>
  );
}
