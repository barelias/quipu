import React from 'react';
import Card from './components/Card';
import Callout from './components/Callout';
import Badge from './components/Badge';
import Stat from './components/Stat';
import { Row, Col } from './components/Row';
import { LineChart, BarChart, AreaChart, PieChart } from './charts/Charts';

/**
 * Strip dangerous schemes from anchor hrefs and force safe link semantics.
 * Anchors are part of the curated MDX surface; if MDX authors emit one we
 * still won't let it open a `javascript:` payload or a phishing data: URI.
 */
function SafeAnchor({ href, children }: { href?: string; children?: React.ReactNode }) {
  const safe =
    typeof href === 'string' &&
    /^(https?:|quipu:|mailto:|#|\/)/i.test(href) &&
    !/^javascript:/i.test(href) &&
    !/^data:/i.test(href);
  if (!safe) {
    return <span>{children}</span>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
      {children}
    </a>
  );
}

/**
 * The curated component map exposed to the in-chat MDX runtime. Anything
 * an MDX author writes — `<Card>`, `<Badge>`, `<p>`, `<h2>`, etc. — is
 * resolved through this map. Components not in the map render as
 * unstyled fallbacks (MDX's default behaviour) but cannot escape it to
 * arbitrary DOM tags.
 */
export const MDX_COMPONENTS = {
  // Curated Quipu primitives
  Card,
  Callout,
  Badge,
  Stat,
  Row,
  Col,

  // Charts (Recharts under the hood). Accept either inline `data` or a
  // workspace `src` (.csv / .tsv / .json / .jsonl / .quipudb.jsonl).
  LineChart,
  BarChart,
  AreaChart,
  PieChart,

  // Mapped HTML elements — explicit so MDX cannot smuggle attributes
  // like `dangerouslySetInnerHTML`. Each receives a typed prop list.
  a: SafeAnchor,
  p: ({ children }: { children?: React.ReactNode }) => <p className="my-1">{children}</p>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-lg font-semibold mt-3 mb-1">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-base font-semibold mt-3 mb-1">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
  h4: ({ children }: { children?: React.ReactNode }) => <h4 className="text-sm font-medium mt-2 mb-1">{children}</h4>,
  h5: ({ children }: { children?: React.ReactNode }) => <h5 className="text-sm font-medium">{children}</h5>,
  h6: ({ children }: { children?: React.ReactNode }) => <h6 className="text-xs font-medium uppercase tracking-wide text-text-secondary">{children}</h6>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-5 my-1">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-5 my-1">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="my-0.5">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="px-1 py-0.5 rounded bg-bg-elevated text-text-primary text-[0.9em]">{children}</code>
  ),
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="p-2 rounded-md bg-bg-elevated overflow-x-auto text-xs my-1">{children}</pre>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-border pl-3 my-1 text-text-secondary">{children}</blockquote>
  ),
};

/**
 * Pre-validate MDX source for known dangerous constructs. Returns null if
 * the source is acceptable, or a short reason string if it should be
 * rejected and rendered as a fallback.
 */
export function validateMdxSource(source: string): string | null {
  // No imports / exports — the agent should not pull arbitrary modules.
  if (/^\s*(import|export)\s/m.test(source)) {
    return 'imports and exports are not allowed in chat mdx';
  }
  if (/dangerouslySetInnerHTML\b/i.test(source)) {
    return 'dangerouslySetInnerHTML is not allowed';
  }
  if (/\b__html\b/i.test(source)) {
    return '__html is not allowed';
  }
  if (/<\s*script\b/i.test(source)) {
    return '<script> tags are not allowed';
  }
  return null;
}
