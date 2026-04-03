import { useState, useEffect, useRef, useCallback } from 'react';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import mermaid from 'mermaid';

const lowlight = createLowlight(common);

const COMMON_LANGUAGES = [
  'javascript', 'typescript', 'python', 'go', 'rust', 'java', 'c', 'cpp',
  'ruby', 'php', 'bash', 'sql', 'css', 'html', 'json', 'yaml', 'xml',
  'mermaid', 'markdown', 'plaintext',
];

let mermaidRenderCounter = 0;

function CodeBlockView({ node, updateAttributes }) {
  const language = node.attrs.language || '';
  const [inputValue, setInputValue] = useState(language);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mermaidSvg, setMermaidSvg] = useState('');
  const [mermaidError, setMermaidError] = useState(null);
  const inputRef = useRef(null);

  // Sync input when node language changes externally
  useEffect(() => {
    setInputValue(node.attrs.language || '');
  }, [node.attrs.language]);

  // Mermaid rendering — debounced, with stale-render guard
  const mermaidTextRef = useRef('');
  useEffect(() => {
    if (language !== 'mermaid') {
      setMermaidSvg('');
      setMermaidError(null);
      mermaidTextRef.current = '';
      return;
    }

    const text = node.textContent || '';
    if (!text.trim()) {
      setMermaidSvg('');
      setMermaidError(null);
      mermaidTextRef.current = '';
      return;
    }

    // Skip if text hasn't actually changed (avoids re-render on tab switch)
    if (text === mermaidTextRef.current) return;
    mermaidTextRef.current = text;

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try {
        const id = `mermaid-cb-${++mermaidRenderCounter}`;
        const { svg } = await mermaid.render(id, text.trim());
        if (!cancelled) {
          setMermaidSvg(svg);
          setMermaidError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setMermaidError(err.message || 'Invalid mermaid syntax');
          setMermaidSvg('');
        }
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [language, node.textContent]);

  const handleInputChange = useCallback((e) => {
    const value = e.target.value;
    setInputValue(value);
    setShowSuggestions(true);
  }, []);

  const handleInputBlur = useCallback(() => {
    setTimeout(() => {
      updateAttributes({ language: inputValue || null });
      setShowSuggestions(false);
    }, 150);
  }, [inputValue, updateAttributes]);

  const handleInputKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateAttributes({ language: inputValue || null });
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
    if (e.key === 'Escape') {
      setInputValue(language);
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  }, [inputValue, language, updateAttributes]);

  const selectLanguage = useCallback((lang) => {
    setInputValue(lang);
    updateAttributes({ language: lang });
    setShowSuggestions(false);
  }, [updateAttributes]);

  const filteredLanguages = COMMON_LANGUAGES.filter(
    lang => !inputValue || lang.includes(inputValue.toLowerCase())
  );

  return (
    <NodeViewWrapper className="relative group/codeblock">
      {/* Language selector */}
      <div
        className="absolute top-1 right-2 z-10"
        contentEditable={false}
      >
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onFocus={() => setShowSuggestions(true)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            placeholder="language"
            className="w-[90px] text-[10px] text-text-tertiary bg-transparent border border-transparent
                       rounded px-1.5 py-0.5 outline-none opacity-40
                       group-hover/codeblock:opacity-100 focus:opacity-100
                       focus:border-border focus:bg-bg-elevated transition-opacity"
          />
          {showSuggestions && filteredLanguages.length > 0 && (
            <div className="absolute top-full right-0 mt-1 w-[120px] max-h-[160px] overflow-y-auto
                            bg-bg-elevated border border-border rounded shadow-lg z-50">
              {filteredLanguages.map(lang => (
                <button
                  key={lang}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectLanguage(lang)}
                  className="block w-full text-left text-[11px] text-text-secondary px-2 py-1
                             hover:bg-white/[0.08] hover:text-text-primary bg-transparent border-none cursor-pointer"
                >
                  {lang}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Code content — lowlight applies syntax highlighting classes to the <code> element */}
      <pre>
        <NodeViewContent as="code" />
      </pre>

      {/* Mermaid preview */}
      {language === 'mermaid' && (mermaidSvg || mermaidError) && (
        <div contentEditable={false} className="border-t border-border p-4 bg-bg-surface/50">
          {mermaidError ? (
            <div className="text-error text-xs font-mono">{mermaidError}</div>
          ) : (
            <div
              className="flex justify-center [&>svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: mermaidSvg }}
            />
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}

const CodeBlockWithLangBase = CodeBlockLowlight.configure({
  lowlight,
});

export const CodeBlockWithLang = CodeBlockWithLangBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
