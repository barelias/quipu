export interface TerminalTab {
  id: string;
  label: string;
  isClaudeRunning: boolean;
}

export type AnnotationType = 'note' | 'question' | 'important' | 'todo';
