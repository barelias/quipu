import React from 'react';

interface ExcalidrawProps {
  initialData?: unknown;
  onChange?: () => void;
  theme?: string;
  excalidrawAPI?: (api: unknown) => void;
  UIOptions?: Record<string, unknown>;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __excalidrawProps: any;
  }
}

export const Excalidraw: React.FC<ExcalidrawProps> = ({ initialData, onChange, theme, excalidrawAPI, UIOptions }) => {
  window.__excalidrawProps = { initialData, onChange, theme, excalidrawAPI, UIOptions };
  return <div data-testid="excalidraw-mock" data-theme={theme}>Excalidraw</div>;
};

export const serializeAsJSON = (elements: unknown, appState: unknown, files: unknown): string =>
  JSON.stringify({ elements, appState, files });
