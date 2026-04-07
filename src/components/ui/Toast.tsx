import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { ToastType } from '@/types/workspace';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => number;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_COLORS: Record<ToastType, string> = {
  error: 'bg-error',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
};

let toastIdCounter = 0;

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: number) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info'): number => {
    const id = ++toastIdCounter;

    setToasts(prev => {
      const next = [...prev, { id, message, type }];
      // Maximum 5 visible toasts, remove oldest
      if (next.length > 5) {
        const removed = next.shift()!;
        if (timersRef.current[removed.id]) {
          clearTimeout(timersRef.current[removed.id]);
          delete timersRef.current[removed.id];
        }
      }
      return next;
    });

    // Auto-dismiss after 5 seconds
    timersRef.current[id] = setTimeout(() => {
      dismissToast(id);
    }, 5000);

    return id;
  }, [dismissToast]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const handleDismiss = useCallback((id: number) => {
    dismissToast(id);
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className="flex items-stretch w-[360px] max-w-[calc(100vw-32px)] bg-bg-elevated rounded-lg shadow-lg overflow-hidden pointer-events-auto animate-toast-in"
          >
            <div className={cn("w-1 shrink-0", TYPE_COLORS[toast.type] || 'bg-info')} />
            <div className="flex-1 py-2.5 px-3 flex items-center gap-2 min-w-0">
              <span className="flex-1 font-sans text-sm leading-snug text-text-primary break-words">{toast.message}</span>
              <button
                className="shrink-0 bg-transparent border-none cursor-pointer p-1 text-text-tertiary rounded transition-colors hover:bg-white/[0.06] hover:text-text-secondary"
                onClick={() => handleDismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                <XIcon size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
