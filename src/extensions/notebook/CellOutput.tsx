import Ansi from 'ansi-to-react';
import DOMPurify from 'dompurify';

const OUTPUT_TRUNCATION_LIMIT = 100 * 1024; // 100 KB

// MIME priority order: richest renderable type wins
const MIME_PRIORITY: string[] = [
  'text/html',
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/gif',
  'application/json',
  'text/markdown',
  'text/plain',
];

/** Notebook output MIME data — keys are MIME types, values are strings or string arrays */
type MimeData = Record<string, string | string[]>;

/** Jupyter notebook output object */
interface NotebookOutput {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  name?: string;
  text?: string | string[];
  data?: MimeData;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  ename?: string;
  evalue?: string;
  traceback?: string | string[];
}

function pickMime(data: MimeData): string | null {
  for (const mime of MIME_PRIORITY) {
    if (data[mime] !== undefined) return mime;
  }
  return null;
}

function joinText(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join('');
  return String(value ?? '');
}

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length > OUTPUT_TRUNCATION_LIMIT) {
    const preview = text.slice(0, OUTPUT_TRUNCATION_LIMIT);
    return { text: preview, truncated: true };
  }
  return { text, truncated: false };
}

interface RichOutputProps {
  data: MimeData;
}

function RichOutput({ data }: RichOutputProps) {
  const mime = pickMime(data);
  if (!mime) return null;

  const raw = joinText(data[mime]);

  if (mime === 'text/html') {
    const clean = DOMPurify.sanitize(raw);
    return (
      <div
        className="notebook-html-output text-text-primary text-sm"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }

  if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif') {
    return (
      <img
        src={`data:${mime};base64,${raw}`}
        alt="cell output"
        className="max-w-full"
      />
    );
  }

  if (mime === 'image/svg+xml') {
    const clean = DOMPurify.sanitize(raw);
    return (
      <div
        className="max-w-full"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }

  if (mime === 'application/json') {
    const pretty = (() => {
      try { return JSON.stringify(JSON.parse(raw), null, 2); }
      catch { return raw; }
    })();
    return <pre className="text-text-primary text-sm font-mono whitespace-pre-wrap">{pretty}</pre>;
  }

  // text/markdown, text/plain fallback
  return <pre className="text-text-primary text-sm font-mono whitespace-pre-wrap">{raw}</pre>;
}

interface StreamOutputProps {
  output: NotebookOutput;
}

function StreamOutput({ output }: StreamOutputProps) {
  const raw = joinText(output.text);
  const { text, truncated } = truncate(raw);
  const isStderr = output.name === 'stderr';
  return (
    <div className={isStderr ? 'border-l-2 border-warning pl-2' : ''}>
      <pre className="text-text-primary text-sm font-mono whitespace-pre-wrap">
        <Ansi>{text}</Ansi>
      </pre>
      {truncated && (
        <div className="text-text-tertiary text-xs italic mt-1">
          Output truncated (showing first 100 KB)
        </div>
      )}
    </div>
  );
}

interface ErrorOutputProps {
  output: NotebookOutput;
}

function ErrorOutput({ output }: ErrorOutputProps) {
  const raw = joinText(output.traceback);
  return (
    <pre className="text-sm font-mono whitespace-pre-wrap border-l-2 border-error pl-2">
      <Ansi>{raw}</Ansi>
    </pre>
  );
}

interface CellOutputProps {
  output: NotebookOutput;
}

const CellOutput = ({ output }: CellOutputProps) => {
  if (!output) return null;

  switch (output.output_type) {
    case 'stream':
      return <StreamOutput output={output} />;
    case 'display_data':
    case 'execute_result':
      return <RichOutput data={output.data ?? {}} />;
    case 'error':
      return <ErrorOutput output={output} />;
    default:
      return null;
  }
};

export default CellOutput;
export type { NotebookOutput, MimeData };

// Pure logic exports for testing
export { pickMime, joinText, truncate, OUTPUT_TRUNCATION_LIMIT };
