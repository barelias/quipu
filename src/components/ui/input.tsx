import React from "react"
import { cn } from "@/lib/utils"

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1",
        "text-sm text-text-primary placeholder:text-text-tertiary",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "transition-colors",
        className
      )}
      {...props}
    />
  )
}

export { Input }
export type { InputProps }
