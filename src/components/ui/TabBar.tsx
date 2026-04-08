import React, { useCallback } from 'react';
import { XIcon, CircleIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useTab } from '../../context/TabContext';

interface Tab {
    id: string;
    name: string;
    path: string;
    isDirty: boolean;
}

export default function TabBar() {
    const { openTabs, activeTabId, switchTab, closeTab } = useTab();

    const handleClose = useCallback((e: React.MouseEvent<HTMLButtonElement>, tabId: string) => {
        e.stopPropagation();
        closeTab(tabId);
    }, [closeTab]);

    if (openTabs.length === 0) return null;

    return (
        <div
            className="flex h-[35px] bg-bg-surface border-b border-border overflow-x-auto overflow-y-hidden shrink-0 [&::-webkit-scrollbar]:h-[3px] [&::-webkit-scrollbar-thumb]:bg-border"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            role="tablist"
        >
            {openTabs.map((tab: Tab) => {
                const isActive = tab.id === activeTabId;
                return (
                    <div
                        key={tab.id}
                        data-tab-id={tab.id}
                        className={cn(
                            "group/tab flex items-center gap-1.5 px-4",
                            "cursor-pointer border-r border-border whitespace-nowrap",
                            "text-[13px] text-text-primary opacity-70",
                            "min-w-[120px] shrink-0 relative",
                            "hover:opacity-100 hover:bg-white/[0.04]",
                            "transition-opacity",
                            isActive && "opacity-100 bg-page-bg border-b-2 border-b-accent",
                        )}
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => switchTab(tab.id)}
                        title={tab.path}
                    >
                        <span className="overflow-hidden text-ellipsis max-w-[180px] font-sans">
                            {tab.name}
                        </span>
                        <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                            {tab.isDirty ? (
                                <>
                                    <CircleIcon
                                        weight="fill"
                                        size={8}
                                        className="text-accent group-hover/tab:hidden"
                                        aria-label="unsaved changes"
                                    />
                                    <button
                                        className={cn(
                                            "hidden group-hover/tab:flex items-center justify-center",
                                            "bg-transparent border-none text-text-primary",
                                            "cursor-pointer px-0.5 rounded-sm leading-none",
                                            "opacity-60 hover:!opacity-100 hover:bg-white/10",
                                        )}
                                        onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleClose(e, tab.id)}
                                        aria-label={`Close ${tab.name}`}
                                    >
                                        <XIcon size={14} />
                                    </button>
                                </>
                            ) : (
                                <button
                                    className={cn(
                                        "bg-transparent border-none text-text-primary",
                                        "cursor-pointer px-0.5 rounded-sm leading-none",
                                        "opacity-0 group-hover/tab:opacity-60",
                                        "hover:!opacity-100 hover:bg-white/10",
                                        "transition-opacity",
                                        isActive && "opacity-60",
                                    )}
                                    onClick={(e: React.MouseEvent<HTMLButtonElement>) => handleClose(e, tab.id)}
                                    aria-label={`Close ${tab.name}`}
                                >
                                    <XIcon size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
