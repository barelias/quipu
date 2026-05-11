// Deprecated shim — the curated MDX surface now lives in
// `@/extensions/mdx-runtime`. This re-export keeps existing imports
// (`@/extensions/agent-chat/mdx-components`) working through one or two
// release cycles; new code should import from `@/extensions/mdx-runtime`
// directly. Delete this file once no in-tree imports point here.
export * from '@/extensions/mdx-runtime';
