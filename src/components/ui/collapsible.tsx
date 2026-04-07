import React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

type CollapsibleProps = React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Root>
type CollapsibleTriggerProps = React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleTrigger>
type CollapsibleContentProps = React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.CollapsibleContent>

function Collapsible({
  ...props
}: CollapsibleProps) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({
  ...props
}: CollapsibleTriggerProps) {
  return (<CollapsiblePrimitive.CollapsibleTrigger data-slot="collapsible-trigger" {...props} />);
}

function CollapsibleContent({
  ...props
}: CollapsibleContentProps) {
  return (<CollapsiblePrimitive.CollapsibleContent data-slot="collapsible-content" {...props} />);
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
export type { CollapsibleProps, CollapsibleTriggerProps, CollapsibleContentProps }
