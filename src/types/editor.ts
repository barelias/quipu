export interface TerminalTab {
  id: string;
  label: string;
  isClaudeRunning: boolean;
}

export type AnnotationType = 'note' | 'question' | 'important' | 'todo';

export interface FrameAnnotation {
  id: string;
  text: string;
  type: AnnotationType;
  selectedText?: string;
  line?: number;
  page?: number;
  topRatio?: number;
  createdAt: string;
}
