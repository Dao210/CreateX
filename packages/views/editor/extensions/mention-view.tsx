"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

export function MentionView({ node }: NodeViewProps) {
  return <NodeViewWrapper as="span" className="inline"><span className="mention">@{node.attrs.label ?? node.attrs.id}</span></NodeViewWrapper>;
}
