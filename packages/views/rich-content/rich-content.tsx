"use client";

/**
 * RichContent — the ONE product-level readonly content renderer (MUL-4922).
 *
 * Chat (user message, live assistant, persisted assistant, timeline text),
 * Issue descriptions and Comments all render through this component. There is
 * no second product Markdown renderer: `packages/ui/markdown` stays a generic
 * primitive for terminal/raw output and must not grow product concerns
 * (Mention, Attachment, Mermaid, HTML preview) again.
 *
 * Surfaces differ only in the shell they wrap around this component:
 *   - Comment / Issue: edit, reply, menu, thread chrome — outside.
 *   - Chat: timeline, thinking, tool, failure, copy chrome — outside.
 *
 * The public API is deliberately narrow. There is no `surface` prop, no
 * `renderMention` override and no custom code-renderer escape hatch: each of
 * those is a door through which a per-surface fork walks back in. Link,
 * mention and attachment behaviour is decided here, once.
 *
 *   density — CSS only. Never switches parser, plugins, components map or the
 *             semantic DOM; `compact` and `document` produce the same blocks.
 *   phase   — lifecycle only. Does NOT decide whether a fence upgrades; that is
 *             the fence's real closed state (see streaming-fence.ts), so a
 *             settled-but-malformed fence still renders as source.
 */

import { createContext, isValidElement, memo, useContext, useMemo, useRef } from "react";
import ReactMarkdown, {
  type Components,
  type ExtraProps,
  type Options as ReactMarkdownOptions,
} from "react-markdown";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkCjkFriendly from "remark-cjk-friendly/parseOnly";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@auro/ui/lib/utils";
import { useWorkspaceSlug } from "@auro/core/paths";
import { useConfigStore } from "@auro/core/config";
import type { Attachment } from "@auro/core/types";
import { isAllowedFileCardHref, markdownSanitizeSchema, markdownUrlTransform } from "@auro/ui/markdown";
import {
  resolveClickIntent,
  useAppOrigin,
  useOptionalNavigation,
} from "../navigation";
import { useLinkHover, LinkHoverCard } from "../editor/link-hover-card";
import { openLink, isMentionHref } from "../editor/utils/link-handler";
import { preprocessMarkdown } from "../editor/utils/preprocess";
import { highlightToHtml } from "../editor/utils/highlight-markdown";
import { AttachmentDownloadProvider } from "../editor/attachment-download-context";
import { Attachment as AttachmentRenderer } from "../editor/attachment";
import { computeClosedFences, type ClosedFence } from "./streaming-fence";
import { remarkRepairCjkStrongTrailingWhitespace } from "./cjk-emphasis";
import {
  CodeBlockShell,
  RichFenceBlock,
  StaticCodeBody,
  isRichFenceLanguage,
  shouldUpgradeFence,
} from "./rich-code-block";
import "katex/dist/katex.min.css";
import "../editor/styles/index.css";
import "./rich-content.css";

export type RichContentDensity = "compact" | "document";
export type RichContentPhase = "streaming" | "settled";

// ---------------------------------------------------------------------------
// Fence gate context
// ---------------------------------------------------------------------------
//
// The closed-fence offsets travel by context rather than by rebuilding the
// components map. The map must stay referentially stable: react-markdown
// re-runs the whole subtree when `components` changes identity, which rewrites
// every highlighted <code>'s innerHTML and collapses an active text selection
// inside a code block (MUL-3621).

const ClosedFenceContext = createContext<ReadonlyMap<number, ClosedFence>>(
  new Map<number, ClosedFence>(),
);

/** The closed fence at this source offset, or undefined while it is still open. */
function useClosedFence(offset: number | undefined): ClosedFence | undefined {
  const closed = useContext(ClosedFenceContext);
  // An offset-less node cannot be matched to a source fence; refusing to
  // upgrade is the safe direction (source instead of a possibly partial block).
  return offset == null ? undefined : closed.get(offset);
}

function RichLink({ href, children }: { href?: string; children?: ReactNode }) {
  const slug = useWorkspaceSlug();
  const appOrigin = useAppOrigin();
  // Platform probe only: `openInNewTab` present means desktop, where native
  // anchor behavior is a dead end and every click must be intercepted. Absent
  // (web), modified clicks are left to the browser — the only way to get a
  // real background tab.
  const desktopTabs = !!useOptionalNavigation()?.openInNewTab;

  if (href?.startsWith("slash://skill/")) {
    return <span className="slash-command">{children}</span>;
  }

  if (isMentionHref(href)) {
    // Member / agent / all mentions
    return <span className="mention">{children}</span>;
  }

  // Regular link — open directly on click. A URL pointing back at this
  // deployment routes in-app rather than out to the browser. Built first
  // because it is also what an unfurl falls back to when the entity behind the
  // URL cannot be resolved.
  const plainLink = (
    <a
      href={href}
      onClick={(e) => {
        if (!href) {
          e.preventDefault();
          return;
        }
        if (!desktopTabs && (e.metaKey || e.ctrlKey || e.shiftKey)) return;
        e.preventDefault();
        openLink(href, slug, appOrigin, resolveClickIntent(e));
      }}
      onAuxClick={(e) => {
        if (e.button !== 1 || !href) return;
        // Web: native middle click on a real anchor already opens a
        // background tab. Desktop: the native window-open request dead-ends
        // (denied, then dropped by the http/https allowlist), so route it.
        if (!desktopTabs) return;
        e.preventDefault();
        openLink(href, slug, appOrigin, "background-tab");
      }}
    >
      {children}
    </a>
  );

  return plainLink;
}

// ---------------------------------------------------------------------------
// Fenced code
// ---------------------------------------------------------------------------

function getTextContent(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return getTextContent(node.props.children);
  }
  return "";
}

// Props react-markdown actually passes to a component override: the intrinsic
// element's own props plus the source hast node (`ExtraProps`). Deriving them
// keeps the renderers checked against react-markdown's real contract instead of
// a hand-written approximation that a cast would have to silence.
type RichCodeProps = ComponentPropsWithoutRef<"code"> & ExtraProps;
type RichPreProps = ComponentPropsWithoutRef<"pre"> & ExtraProps;

/**
 * Source offset of a hast node, narrowed in one place. Offsets are how a
 * rendered block is matched back to its fence in the processed Markdown (see
 * streaming-fence.ts); a node without position cannot be matched.
 */
function nodeStartOffset(node: ExtraProps["node"]): number | undefined {
  return node?.position?.start.offset;
}

/**
 * Reads a hast element property as a string. hast property values are a union
 * (string | number | boolean | array | null), so this narrows at runtime rather
 * than asserting — a `data-*` attribute that is not a string yields "" instead
 * of a value that lies about its type.
 */
function stringProperty(node: ExtraProps["node"], key: string): string {
  const value = node?.properties?.[key];
  return typeof value === "string" ? value : "";
}

function isMultiLineNode(node: ExtraProps["node"]): boolean {
  const position = node?.position;
  return position != null && position.start.line !== position.end.line;
}

/**
 * `code` renderer. Returns the rich leaf directly for an upgraded fence and
 * relies on the `pre` renderer below to unwrap it — react-markdown otherwise
 * wraps `code` children in a `<pre>` whose monospace/overflow styles clamp a
 * diagram or preview iframe.
 */
function RichCode({ className, children, node, ...props }: RichCodeProps) {
  const language = /language-(\w+)/.exec(className || "")?.[1];
  const isBlock = isMultiLineNode(node);
  const fence = useClosedFence(nodeStartOffset(node));

  if (isBlock && shouldUpgradeFence(language, fence != null)) {
    // isRichFenceLanguage is re-checked for the type narrow; shouldUpgradeFence
    // already required it.
    if (isRichFenceLanguage(language)) {
      return (
        <RichFenceBlock
          language={language}
          body={String(children).replace(/\n$/, "")}
          title={fence?.title}
        />
      );
    }
  }

  if (!isBlock && !language) {
    // Inline code — CSS handles styling via .rich-text-editor code
    return <code {...props}>{children}</code>;
  }

  return <StaticCodeBody language={language} body={String(children)} />;
}

/**
 * Reads the language token and source offset from the `<code>` element that
 * react-markdown hands to a `pre` override. `isValidElement`'s type parameter
 * narrows the child's props, so no cast is needed to reach `node`.
 */
function readFencedCodeChild(children: ReactNode): {
  language?: string;
  offset?: number;
} {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string } & ExtraProps>(child)) return {};
  return {
    // Whole class token only: `language-htmlbars` must not read as `html`.
    language: /(?:^|\s)language-(\w+)(?:\s|$)/.exec(child.props.className ?? "")?.[1],
    offset: nodeStartOffset(child.props.node),
  };
}

/**
 * `pre` renderer. react-markdown calls this BEFORE invoking the `code`
 * renderer, so `children` is the unrendered `<code>` element from the AST: the
 * decision to unwrap is made from that child's own hast node (class token +
 * source offset), not by checking `children.type === MermaidDiagram`, which
 * never matches.
 */
function RichPre({ children }: RichPreProps) {
  const { language, offset } = readFencedCodeChild(children);
  const isFenceClosed = useClosedFence(offset) != null;

  // Upgraded fences escape the <pre><code> envelope entirely. An OPEN
  // mermaid/html fence deliberately falls through to the normal code shell, so
  // a half-streamed diagram reads as ordinary source with copy chrome.
  if (shouldUpgradeFence(language, isFenceClosed)) {
    return <>{children}</>;
  }

  return (
    <CodeBlockShell
      language={language}
      code={getTextContent(children).replace(/\n$/, "")}
    >
      {children}
    </CodeBlockShell>
  );
}

// The components map is module-level and static: it never depends on density,
// phase or the fence gate, so its identity is stable for the lifetime of the
// app and react-markdown can bail out of unchanged subtrees.
const COMPONENTS: Partial<Components> = {
  a: RichLink,

  // Images — unified through <Attachment>. The resolver context provided by
  // AttachmentDownloadProvider turns a CDN URL into a full record when
  // possible; external URLs render as plain images with lightbox-via-preview
  // -modal. forceKind is mandatory: markdown `![]()` carries no content-type
  // and alt is commonly empty, so without it images fall through to file-card
  // chrome.
  img: ({ src, alt }) => (
    <AttachmentRenderer
      attachment={{
        kind: "url",
        url: typeof src === "string" ? src : "",
        filename: alt ?? "",
        forceKind: "image",
      }}
    />
  ),

  // FileCard — intercept <div data-type="fileCard"> from preprocessMarkdown
  div: ({ node, children, ...props }) => {
    if (stringProperty(node, "dataType") === "fileCard") {
      const rawHref = stringProperty(node, "dataHref");
      const href = isAllowedFileCardHref(rawHref) ? rawHref : "";
      return (
        <AttachmentRenderer
          attachment={{
            kind: "url",
            url: href,
            filename: stringProperty(node, "dataFilename"),
          }}
        />
      );
    }
    return <div {...props}>{children}</div>;
  },

  // Tables — wrap in tableWrapper div for border/radius/scroll (matches Tiptap)
  table: ({ children }) => (
    <div className="tableWrapper">
      <table>{children}</table>
    </div>
  ),

  code: RichCode,
  pre: RichPre,
};

// `satisfies` rather than a cast: the plugin lists are still checked against
// react-markdown's own option types, so a bad plugin tuple fails here instead of
// being silenced.
const REMARK_PLUGINS = [
  [remarkMath, { singleDollarTextMath: false }],
  remarkBreaks,
  [remarkGfm, { singleTilde: false }],
  remarkCjkFriendly,
  remarkRepairCjkStrongTrailingWhitespace,
] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>;

const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeKatex,
] satisfies NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface RichContentProps {
  content: string;
  /**
   * Attachments associated with the surrounding entity (comment / issue body /
   * chat message). Inline `<img>` and file-card URLs matching one of these get
   * their download URL re-signed at click time instead of using the possibly
   * stale link embedded in the markdown.
   *
   * Callers SHOULD pass a stable reference; a fresh array on every parent
   * render busts the memo.
   */
  attachments?: Attachment[];
  /** CSS density only — never changes the semantic DOM. */
  density?: RichContentDensity;
  /**
   * Streaming lifecycle. Does not gate fence upgrades (closedness does); it
   * exists so surfaces can express that content is still arriving.
   */
  phase?: RichContentPhase;
  className?: string;
}

export const RichContent = memo(function RichContent({
  content,
  attachments,
  density = "document",
  phase = "settled",
  className,
}: RichContentProps) {
  // Subscribed, not read once. The CDN config is fetched asynchronously after
  // auth, so content that renders first would otherwise keep its legacy CDN
  // links as plain anchors permanently — the preprocess step that turns them
  // into file cards had already run against an empty domain and nothing would
  // re-run it. Subscribing puts the value in the memo dependencies below, so a
  // late config arrival reprocesses exactly once.
  const cdnDomain = useConfigStore((s) => s.cdnDomain);

  const processed = useMemo(
    () =>
      highlightToHtml(
        preprocessMarkdown(content, { cdnDomain, autolinkIssueIdentifiers: false }),
      ),
    [content, cdnDomain],
  );

  // Derived from the SAME string handed to ReactMarkdown, so offsets line up
  // with the hast node positions the `code`/`pre` renderers observe. Computing
  // it from the raw pre-preprocess text would mis-match every rewritten node.
  const closedFences = useMemo(() => computeClosedFences(processed), [processed]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const hover = useLinkHover(wrapperRef);

  // Memoize the react-markdown subtree on its only real inputs. Unrelated
  // parent re-renders (a sibling agent task streaming over WebSocket fires one
  // every ~100ms) would otherwise re-run react-markdown, which hands `<code>` a
  // fresh `dangerouslySetInnerHTML` object each time; React then rewrites the
  // highlighted innerHTML even though the string is byte-identical, tearing
  // down every hljs <span> and collapsing any active text selection inside a
  // code block (MUL-3621). A stable element reference lets React bail out.
  const markdown = useMemo(
    () => (
      <ClosedFenceContext.Provider value={closedFences}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          urlTransform={markdownUrlTransform}
          components={COMPONENTS}
        >
          {processed}
        </ReactMarkdown>
      </ClosedFenceContext.Provider>
    ),
    [processed, closedFences],
  );

  return (
    <AttachmentDownloadProvider attachments={attachments}>
      <div
        ref={wrapperRef}
        data-rich-content=""
        data-density={density}
        data-phase={phase}
        className={cn(
          "rich-text-editor readonly text-body",
          density === "compact" && "rich-content-compact",
          className,
        )}
      >
        {markdown}
        <LinkHoverCard {...hover} />
      </div>
    </AttachmentDownloadProvider>
  );
});
