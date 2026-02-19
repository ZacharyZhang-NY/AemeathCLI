/**
 * Message display component per PRD section 6.2
 * Renders conversation messages with model attribution and tool output
 */

import React from "react";
import { Box, Text } from "ink";
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

function getRoleLabel(role: MessageRole, model?: string): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return model ? `[${model}]` : "Assistant";
    case "system":
      return "System";
    case "tool":
      return "Tool";
  }
}

interface IMessageItemProps {
  readonly message: IChatMessage;
}

function MessageItem({ message }: IMessageItemProps): React.ReactElement {
  const color = getRoleColor(message.role);
  const label = getRoleLabel(message.role, message.model);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={color} bold>
        {label}
      </Text>
      <Box marginLeft={2}>
        <Text wrap="wrap">{message.content}</Text>
      </Box>
      {message.toolCalls && message.toolCalls.length > 0 ? (
        <Box marginLeft={2} flexDirection="column">
          {message.toolCalls.map((call) => (
            <Text key={call.id} color="gray" dimColor>
              Tool: {call.name}({JSON.stringify(call.arguments).slice(0, 80)})
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

export function MessageView({ messages }: IMessageViewProps): React.ReactElement {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} />
      ))}
    </Box>
  );
}
