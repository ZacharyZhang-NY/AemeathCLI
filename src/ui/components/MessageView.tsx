/**
 * Conversation message display with markdown rendering,
 * tool-call visualization, and visual role indicators.
 */

import React from "react";
import { Box, Text } from "ink";
import { MarkdownContent } from "./MarkdownContent.js";
import { ToolCallDisplay } from "./ToolCallDisplay.js";
import { colors } from "../theme.js";
import type { IChatMessage, MessageRole } from "../../types/index.js";

interface IMessageViewProps {
  readonly messages: readonly IChatMessage[];
}

function getRoleColor(role: MessageRole): string {
  switch (role) {
    case "user":
      return colors.role.user;
    case "assistant":
      return colors.role.assistant;
    case "system":
      return colors.role.system;
    case "tool":
      return colors.role.tool;
  }
}

function getRoleIcon(role: MessageRole): string {
  switch (role) {
    case "user":
      return "\u276F";
    case "assistant":
      return "\u2726";
    case "system":
      return "\u2022";
    case "tool":
      return "\u2699";
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

/** Format tool call arguments as a readable one-liner */
function formatToolArgs(
  name: string,
  args: Record<string, unknown>,
): string {
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
      return cmd.length > 60 ? cmd.slice(0, 60) + "\u2026" : cmd;
    }
    default:
      return JSON.stringify(args).slice(0, 80);
  }
}

// ── Individual message item ────────────────────────────────────────────

interface IMessageItemProps {
  readonly message: IChatMessage;
}

function MessageItem({ message }: IMessageItemProps): React.ReactElement {
  const color = getRoleColor(message.role);
  const icon = getRoleIcon(message.role);
  const label = getRoleLabel(
    message.role,
    message.model ? shortModelName(message.model) : undefined,
  );

  // System messages — compact, dimmed
  if (message.role === "system") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color={colors.role.system} dimColor>
            {icon}{" "}
          </Text>
          <Text color={colors.role.system} dimColor wrap="wrap">
            {message.content}
          </Text>
        </Box>
      </Box>
    );
  }

  // Tool result — show as rich tool call display
  if (message.role === "tool" && message.toolCalls && message.toolCalls.length > 0) {
    const firstCall = message.toolCalls[0];
    if (firstCall) {
      return (
        <Box marginY={0} marginLeft={2}>
          <ToolCallDisplay
            toolName={firstCall.name}
            status={message.content.startsWith("Error:") ? "error" : "success"}
            description={formatToolArgs(firstCall.name, firstCall.arguments)}
            output={message.content}
            isError={message.content.startsWith("Error:")}
            isCollapsed={message.content.length > 500}
          />
        </Box>
      );
    }
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role header */}
      <Box>
        <Text color={color} bold>
          {icon} {label}
        </Text>
        {message.tokenUsage ? (
          <Text color={colors.text.muted} dimColor>
            {" "}
            ({message.tokenUsage.totalTokens} tokens)
          </Text>
        ) : null}
      </Box>

      {/* Message content — full markdown rendering */}
      <Box marginLeft={2} flexDirection="column">
        <MarkdownContent content={message.content} />
      </Box>

      {/* Tool calls that the assistant invoked */}
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <Box marginLeft={2} flexDirection="column" marginTop={0}>
          {message.toolCalls.map((call) => {
            const argSummary = formatToolArgs(call.name, call.arguments);
            return (
              <ToolCallDisplay
                key={call.id}
                toolName={call.name}
                status="success"
                description={argSummary}
              />
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

// ── Message list ───────────────────────────────────────────────────────

const MAX_VISIBLE_MESSAGES = 50;

export function MessageView({
  messages,
}: IMessageViewProps): React.ReactElement {
  const visibleMessages =
    messages.length > MAX_VISIBLE_MESSAGES
      ? messages.slice(-MAX_VISIBLE_MESSAGES)
      : messages;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.length > MAX_VISIBLE_MESSAGES ? (
        <Text color={colors.text.muted} dimColor>
          {"  "}({messages.length - MAX_VISIBLE_MESSAGES} earlier messages
          hidden)
        </Text>
      ) : null}
      {visibleMessages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
