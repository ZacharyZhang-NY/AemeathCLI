/**
 * Enhanced markdown renderer for terminal output.
 * Handles headers, bold, italic, inline code, fenced code blocks,
 * lists, blockquotes, horizontal rules, and links.
 */

import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";

interface IMarkdownContentProps {
  readonly content: string;
}

// ── Block-level types ──────────────────────────────────────────────────

interface IContentBlock {
  readonly type: "text" | "code" | "header" | "list" | "hr" | "blockquote";
  readonly content: string;
  readonly lang?: string | undefined;
  readonly level?: number | undefined;
}

/** Parse raw markdown string into block-level segments. */
function parseBlocks(raw: string): IContentBlock[] {
  const blocks: IContentBlock[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      break;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine === undefined || currentLine.startsWith("```")) {
          break;
        }
        codeLines.push(currentLine);
        i++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n"), lang });
      i++;
      continue;
    }

    // ATX header (#–####)
    const headerMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const hashes = headerMatch[1];
      const headerContent = headerMatch[2];
      if (hashes === undefined || headerContent === undefined) {
        i++;
        continue;
      }
      blocks.push({
        type: "header",
        content: headerContent,
        level: hashes.length,
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      blocks.push({ type: "hr", content: "" });
      i++;
      continue;
    }

    // Blockquote (consecutive >-prefixed lines)
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const quoteLine = lines[i];
        if (quoteLine === undefined || !quoteLine.startsWith("> ")) {
          break;
        }
        quoteLines.push(quoteLine.slice(2));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // List items (unordered or ordered)
    if (/^\s*[-*+]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const listLines: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l === undefined) {
          break;
        }
        if (
          /^\s*[-*+]\s/.test(l) ||
          /^\s*\d+\.\s/.test(l) ||
          (l.startsWith("  ") && listLines.length > 0)
        ) {
          listLines.push(l);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "list", content: listLines.join("\n") });
      continue;
    }

    // Plain text — accumulate until we hit a block-level construct
    const textLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (l === undefined) {
        break;
      }
      if (
        l.startsWith("```") ||
        l.startsWith("#") ||
        l.startsWith("> ") ||
        /^[-*_]{3,}\s*$/.test(l) ||
        /^\s*[-*+]\s/.test(l) ||
        /^\s*\d+\.\s/.test(l)
      ) {
        break;
      }
      textLines.push(l);
      i++;
    }
    if (textLines.length > 0) {
      blocks.push({ type: "text", content: textLines.join("\n") });
    }
  }

  return blocks.length > 0 ? blocks : [{ type: "text", content: raw }];
}

// ── Inline markdown ────────────────────────────────────────────────────

/** Render inline formatting: **bold**, *italic*, `code`, [link](url) */
function InlineMarkdown({
  text,
}: {
  readonly text: string;
}): React.ReactElement {
  const segments: React.ReactElement[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // **bold**
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      segments.push(
        <Text key={key++} bold>
          {boldMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // *italic*
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      segments.push(
        <Text key={key++} italic>
          {italicMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // `inline code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      segments.push(
        <Text key={key++} color={colors.syntax.string} bold>
          {codeMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // ~~strikethrough~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      segments.push(
        <Text key={key++} strikethrough dimColor>
          {strikeMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      segments.push(
        <Text key={key++} color={colors.status.info} underline>
          {linkMatch[1]}
        </Text>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text up to next special char
    const nextSpecial = remaining.search(/[[*`~]/);
    if (nextSpecial === -1) {
      segments.push(<Text key={key++}>{remaining}</Text>);
      break;
    } else if (nextSpecial === 0) {
      segments.push(<Text key={key++}>{remaining[0]}</Text>);
      remaining = remaining.slice(1);
    } else {
      segments.push(
        <Text key={key++}>{remaining.slice(0, nextSpecial)}</Text>,
      );
      remaining = remaining.slice(nextSpecial);
    }
  }

  return <Text wrap="wrap">{segments}</Text>;
}

// ── Block renderers ────────────────────────────────────────────────────

function HeaderBlock({
  content,
  level,
}: {
  readonly content: string;
  readonly level: number;
}): React.ReactElement {
  const headerColors: readonly string[] = [
    colors.text.accent,
    colors.status.active,
    colors.syntax.keyword,
    colors.text.secondary,
  ];
  const color = headerColors[level - 1] ?? colors.text.primary;
  const prefix = level === 1 ? "\u25C6 " : level === 2 ? "\u25B8 " : "  ";

  return (
    <Box marginY={level <= 2 ? 1 : 0}>
      <Text color={color} bold={level <= 2}>
        {prefix}
        {content}
      </Text>
    </Box>
  );
}

function ListBlock({
  content,
}: {
  readonly content: string;
}): React.ReactElement {
  const items = content.split("\n");
  const bullets = ["\u25B8", "\u25E6", "\u00B7", "\u2023"];

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const indent = item.match(/^(\s*)/)?.[1]?.length ?? 0;
        const bulletLevel = Math.floor(indent / 2);
        const clean = item
          .replace(/^\s*[-*+]\s/, "")
          .replace(/^\s*\d+\.\s/, "");
        const bullet = bullets[bulletLevel % bullets.length];

        return (
          <Box key={i} marginLeft={bulletLevel * 2}>
            <Text color={colors.status.active}>{bullet} </Text>
            <InlineMarkdown text={clean} />
          </Box>
        );
      })}
    </Box>
  );
}

function CodeBlockRender({
  content,
  lang,
}: {
  readonly content: string;
  readonly lang?: string | undefined;
}): React.ReactElement {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.border.dim}
      marginY={1}
    >
      {lang ? (
        <Box paddingX={1}>
          <Text color={colors.text.muted} dimColor>
            {lang}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" paddingX={1}>
        {lines.map((line, i) => (
          <Box key={i}>
            <Text color={colors.text.muted} dimColor>
              {String(i + 1).padStart(3, " ")} {"\u2502"}{" "}
            </Text>
            <Text color={colors.text.response}>{line}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function MarkdownContent({
  content,
}: IMarkdownContentProps): React.ReactElement {
  const blocks = parseBlocks(content);

  // Fast path: single plain-text block
  if (blocks.length === 1 && blocks[0]?.type === "text") {
    const text = blocks[0].content;
    if (!/[[*`~]/.test(text)) {
      return <Text wrap="wrap">{text}</Text>;
    }
    return <InlineMarkdown text={text} />;
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "code":
            return (
              <CodeBlockRender
                key={i}
                content={block.content}
                lang={block.lang}
              />
            );
          case "header":
            return (
              <HeaderBlock
                key={i}
                content={block.content}
                level={block.level ?? 1}
              />
            );
          case "list":
            return <ListBlock key={i} content={block.content} />;
          case "hr":
            return (
              <Box key={i} marginY={1}>
                <Text color={colors.border.dim}>
                  {"\u2500".repeat(40)}
                </Text>
              </Box>
            );
          case "blockquote":
            return (
              <Box
                key={i}
                marginLeft={1}
                borderStyle="single"
                borderLeft
                borderRight={false}
                borderTop={false}
                borderBottom={false}
                borderColor={colors.border.active}
                paddingLeft={1}
              >
                <Text color={colors.text.secondary} italic wrap="wrap">
                  {block.content}
                </Text>
              </Box>
            );
          case "text":
          default:
            return <InlineMarkdown key={i} text={block.content} />;
        }
      })}
    </Box>
  );
}
