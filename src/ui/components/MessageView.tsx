/**
 * Message display component per PRD section 6.2
 * Renders conversation messages with model attribution, tool output, and visual polish
 */

import React from "react";
import { Box, Text } from "ink";
import { ToolOutput } from "./ToolOutput.js";
import type { IChatMessage, MessageRole } from "../../types/index.js";

interface IMessageViewProps {
  readonly messages: readonly IChatMessage[];
}

function getRoleColor(role: MessageRole): string {
  switch (role) {
    case "user":
      return "green";
    case "assistant":
      return "cyan";
    case "system":
      return "yellow";
    case "tool":
      return "magenta";
  }
}

function getRoleIcon(role: MessageRole): string {
  switch (role) {
    case "user":
      return "\u276F"; // ❯
    case "assistant":
      return "\u2726"; // ✦
    case "system":
      return "\u2022"; // •
    case "tool":
      return "\u2699"; // ⚙
  }
}

function getRoleLabel(role: MessageRole, model?: string): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return model ?? "Assistant";
    case "system":
      return "System";
    case "tool":
      return "Tool";
  }
}

/** Shorten model ID for display: "claude-sonnet-4-6" → "Sonnet 4.6" */
function shortModelName(model: string): string {
  if (model.includes("opus")) return "Opus 4.6";
  if (model.includes("sonnet")) return "Sonnet 4.6";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("gpt-5.2-mini")) return "GPT-5.2 mini";
  if (model.includes("gpt-5.2")) return "GPT-5.2";
  if (model.includes("o3")) return "o3";
  if (model.includes("gemini") && model.includes("pro")) return "Gemini Pro";
  if (model.includes("gemini") && model.includes("flash")) return "Gemini Flash";
  if (model.includes("kimi") || model.includes("k2")) return "Kimi K2.5";
  return model;
}

interface IMessageItemProps {
  readonly message: IChatMessage;
}

function MessageItem({ message }: IMessageItemProps): React.ReactElement {
  const color = getRoleColor(message.role);
  const icon = getRoleIcon(message.role);
  const label = getRoleLabel(message.role, message.model ? shortModelName(message.model) : undefined);

  // System messages get a compact, dimmed style
  if (message.role === "system") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="yellow" dimColor>{icon} </Text>
          <Text color="yellow" dimColor wrap="wrap">{message.content}</Text>
        </Box>
      </Box>
    );
  }

  // Tool result messages use the dedicated ToolOutput component
  if (message.role === "tool" && message.toolCalls && message.toolCalls.length > 0) {
    const firstCall = message.toolCalls[0];
    if (firstCall) {
      return (
        <ToolOutput
          toolName={firstCall.name}
          content={message.content}
          isError={message.content.startsWith("Error:")}
        />
      );
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role header with icon */}
      <Box>
        <Text color={color} bold>{icon} {label}</Text>
        {message.tokenUsage ? (
          <Text color="gray" dimColor> ({message.tokenUsage.totalTokens} tokens)</Text>
        ) : null}
      </Box>
      {/* Message content */}
      <Box marginLeft={2} flexDirection="column">
        <ContentRenderer content={message.content} />
      </Box>
      {/* Tool calls (assistant messages that invoked tools) */}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <Box marginLeft={2} flexDirection="column" marginTop={0}>
          {message.toolCalls.map((call) => {
            const argSummary = formatToolArgs(call.name, call.arguments);
            return (
              <Box key={call.id}>
                <Text color="magenta">{"\u2699"} </Text>
                <Text color="magenta" bold>{call.name}</Text>
                <Text color="gray"> {argSummary}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

/** Format tool call arguments as a readable one-liner */
function formatToolArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read":
    case "write":
    case "edit":
      return typeof args["file_path"] === "string" ? args["file_path"] : "";
    case "glob":
      return typeof args["pattern"] === "string" ? args["pattern"] : "";
    case "grep": {
      const pat = typeof args["pattern"] === "string" ? args["pattern"] : "";
      const dir = typeof args["path"] === "string" ? ` in ${args["path"]}` : "";
      return `"${pat}"${dir}`;
    }
    case "bash": {
      const cmd = typeof args["command"] === "string" ? args["command"] : "";
      return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
    }
    default:
      return JSON.stringify(args).slice(0, 80);
  }
}

// ── Markdown-aware content rendering ──────────────────────────────────────

interface IContentPart {
  readonly type: "text" | "code";
  readonly content: string;
  readonly lang: string;
}

/** Split content into alternating text and fenced code block segments. */
function splitCodeBlocks(content: string): IContentPart[] {
  const parts: IContentPart[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index), lang: "" });
    }
    parts.push({ type: "code", content: match[2] ?? "", lang: match[1] ?? "" });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex), lang: "" });
  }

  return parts.length > 0 ? parts : [{ type: "text", content, lang: "" }];
}

/**
 * Render message content with fenced code block support.
 * Code blocks are displayed in bordered boxes with optional
 * language labels, similar to Claude Code and Codex terminal output.
 */
function ContentRenderer({ content }: { readonly content: string }): React.ReactElement {
  const parts = splitCodeBlocks(content);

  // Fast path: plain text with no code blocks
  if (parts.length === 1 && parts[0]!.type === "text") {
    return <Text wrap="wrap">{content}</Text>;
  }

  return (
    <Box flexDirection="column">
      {parts.map((part, index) => {
        if (part.type === "code") {
          return (
            <Box key={index} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
              {part.lang.length > 0 ? <Text color="gray" dimColor>{part.lang}</Text> : null}
              <Text>{part.content}</Text>
            </Box>
          );
        }
        return <Text key={index} wrap="wrap">{part.content}</Text>;
      })}
    </Box>
  );
}

const MAX_VISIBLE_MESSAGES = 50;

export function MessageView({ messages }: IMessageViewProps): React.ReactElement {
  const visibleMessages = messages.length > MAX_VISIBLE_MESSAGES
    ? messages.slice(-MAX_VISIBLE_MESSAGES)
    : messages;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.length > MAX_VISIBLE_MESSAGES ? (
        <Text color="gray" dimColor>  ({messages.length - MAX_VISIBLE_MESSAGES} earlier messages hidden)</Text>
      ) : null}
      {visibleMessages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
