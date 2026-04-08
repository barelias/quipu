import React, { useState, useCallback, useRef, useEffect } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useFileSystem } from '../../context/FileSystemContext';
import { useTab } from '../../context/TabContext';
import searchService from '../../services/searchService';

interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

interface SearchResponse {
  results: SearchMatch[];
  truncated: boolean;
}

interface FileGroup {
  file: string;
  matches: SearchMatch[];
}

interface SearchPanelProps {
  activePanel: string | null;
}

export default function SearchPanel({ activePanel }: SearchPanelProps) {
  const { workspacePath } = useFileSystem();
  const { openFile } = useTab();
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SearchMatch[] | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isCaseSensitive, setIsCaseSensitive] = useState<boolean>(false);
  const [isRegex, setIsRegex] = useState<boolean>(false);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input when this panel becomes active
  useEffect(() => {
    if (activePanel === 'search' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activePanel]);

  const performSearch = useCallback(async (searchQuery: string, caseSensitive: boolean, regex: boolean) => {
    if (!workspacePath || !searchQuery.trim()) {
      setResults(null);
      setIsTruncated(false);
      setError(null);
      return;
    }

    setIsSearching(true);
    setError(null);

    try {
      const searchResults = await searchService.search(workspacePath, searchQuery, {
        caseSensitive,
        regex,
      });
      setResults(searchResults.map(r => ({ file: r.path, line: r.line, text: r.content })));
      setIsTruncated(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setResults(null);
      setIsTruncated(false);
    } finally {
      setIsSearching(false);
    }
  }, [workspacePath]);

  // Debounced search triggered by query, caseSensitive, or regex changes
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults(null);
      setIsTruncated(false);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query, isCaseSensitive, isRegex);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, isCaseSensitive, isRegex, performSearch]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  const handleToggleCaseSensitive = useCallback(() => {
    setIsCaseSensitive((prev: boolean) => !prev);
  }, []);

  const handleToggleRegex = useCallback(() => {
    setIsRegex((prev: boolean) => !prev);
  }, []);

  const highlightEditorLine = useCallback((lineNumber: number) => {
    // Clear any pending highlight and remove existing ones
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    document.querySelectorAll('.search-highlight-line').forEach((el: Element) => {
      el.classList.remove('search-highlight-line');
    });

    // Wait briefly for the file to load in the editor, then highlight
    highlightTimeoutRef.current = setTimeout(() => {
      const editorEl = document.querySelector('.ProseMirror');
      if (!editorEl) return;
      const blocks = Array.from(editorEl.children);
      const targetEl = blocks[lineNumber - 1] as HTMLElement | undefined;
      if (!targetEl) return;
      targetEl.classList.add('search-highlight-line');
      targetEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      highlightTimeoutRef.current = setTimeout(() => {
        targetEl.classList.remove('search-highlight-line');
      }, 2500);
    }, 300);
  }, []);

  const handleResultClick = useCallback((filePath: string, lineNumber?: number) => {
    if (!workspacePath) return;
    // Build absolute path from workspace + relative path
    const absolutePath = workspacePath + '/' + filePath;
    const fileName = filePath.split('/').pop() || filePath;
    openFile(absolutePath, fileName);
    if (lineNumber) {
      highlightEditorLine(lineNumber);
    }
  }, [workspacePath, openFile, highlightEditorLine]);

  // Group results by file
  const groupedResults: FileGroup[] = React.useMemo(() => {
    if (!results || results.length === 0) return [];

    const groups: Record<string, SearchMatch[]> = {};
    for (const result of results) {
      if (!groups[result.file]) {
        groups[result.file] = [];
      }
      groups[result.file].push(result);
    }

    return Object.entries(groups).map(([file, matches]) => ({
      file,
      matches,
    }));
  }, [results]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-primary opacity-70">Search</span>
      </div>
      <div className="flex items-center mx-2.5 mb-2 bg-bg-elevated border border-border rounded px-1 shrink-0 focus-within:border-accent">
        <MagnifyingGlassIcon size={16} className="shrink-0 opacity-50 px-1" />
        <input
          ref={inputRef}
          type="text"
          className="flex-1 border-none outline-none bg-transparent py-1.5 px-1 text-[13px] font-sans text-text-primary min-w-0 placeholder:text-text-tertiary"
          placeholder="Search files..."
          value={query}
          onChange={handleQueryChange}
          spellCheck={false}
        />
        <div className="flex gap-0.5 shrink-0">
          <button
            className={cn(
              "bg-transparent border border-transparent rounded-sm py-0.5 px-1.5 text-xs font-mono text-text-primary opacity-50 cursor-pointer leading-none",
              "hover:opacity-80 hover:bg-white/5",
              isCaseSensitive && "opacity-100 bg-accent text-white border-accent hover:opacity-100 hover:bg-accent-hover",
            )}
            onClick={handleToggleCaseSensitive}
            title="Match Case"
          >
            Aa
          </button>
          <button
            className={cn(
              "bg-transparent border border-transparent rounded-sm py-0.5 px-1.5 text-xs font-mono text-text-primary opacity-50 cursor-pointer leading-none",
              "hover:opacity-80 hover:bg-white/5",
              isRegex && "opacity-100 bg-accent text-white border-accent hover:opacity-100 hover:bg-accent-hover",
            )}
            onClick={handleToggleRegex}
            title="Use Regular Expression"
          >
            .*
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {!workspacePath && (
          <div className="py-4 px-3 text-center text-[13px] text-text-primary opacity-50 italic">Open a folder to search</div>
        )}

        {workspacePath && isSearching && (
          <div className="py-4 px-3 text-center text-[13px] text-text-primary opacity-50 italic">Searching...</div>
        )}

        {workspacePath && !isSearching && error && (
          <div className="py-4 px-3 text-center text-[13px] text-error opacity-80 italic">{error}</div>
        )}

        {workspacePath && !isSearching && !error && query.trim() && results && results.length === 0 && (
          <div className="py-4 px-3 text-center text-[13px] text-text-primary opacity-50 italic">No results found</div>
        )}

        {isTruncated && (
          <div className="py-1 px-3 text-[11px] text-accent text-center shrink-0">
            Showing first 500 results
          </div>
        )}

        {groupedResults.map((group: FileGroup) => (
          <div key={group.file} className="mb-0.5">
            <div
              className="flex items-center justify-between py-1 px-3 cursor-pointer text-xs font-semibold text-text-primary bg-white/[0.03] hover:bg-white/[0.07]"
              onClick={() => handleResultClick(group.file)}
              title={group.file}
            >
              <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{group.file}</span>
              <span className="shrink-0 ml-2 text-[11px] font-normal opacity-60 bg-white/[0.06] px-1.5 rounded-full">{group.matches.length}</span>
            </div>
            {group.matches.map((match: SearchMatch, idx: number) => (
              <div
                key={`${group.file}:${match.line}:${idx}`}
                className="flex items-baseline py-0.5 pr-3 pl-5 cursor-pointer text-xs gap-2 hover:bg-white/5"
                onClick={() => handleResultClick(group.file, match.line)}
              >
                <span className="shrink-0 font-mono text-[11px] text-accent min-w-7 text-right">{match.line}</span>
                <span className="font-mono text-xs text-text-primary overflow-hidden text-ellipsis whitespace-nowrap min-w-0">{match.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
