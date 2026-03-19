/**
 * Interactive model selector with provider grouping,
 * gradient highlights, and provider icons.
 */

import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../theme.js";
import type { IModelDisplayEntry } from "../../types/model.js";

interface IModelSelectorProps {
  readonly currentModelId: string;
  readonly onSelect: (modelId: string) => void;
  readonly onCancel: () => void;
  /** Provider-grouped model list (dynamic, from model-discovery). */
  readonly modelOrder?: Readonly<Record<string, readonly IModelDisplayEntry[]>> | undefined;
}

interface ISelectorRow {
  readonly type: "header" | "model";
  readonly label: string;
  readonly description?: string;
  readonly modelId?: string;
  readonly isCurrent?: boolean;
}

const PROVIDER_LABELS: Readonly<Record<string, string>> = {
  anthropic: "\u2726 Claude (Anthropic)",
  openai: "\u2B22 Codex (OpenAI)",
  google: "\u25C6 Gemini (Google)",
  kimi: "\u25CE Kimi (Moonshot)",
};

export function ModelSelector({
  currentModelId,
  onSelect,
  onCancel,
  modelOrder,
}: IModelSelectorProps): React.ReactElement {
  const rows = useMemo<readonly ISelectorRow[]>(() => {
    // Use dynamic model order if provided, otherwise lazy-import hardcoded
    const order = modelOrder ?? {};
    const result: ISelectorRow[] = [];
    for (const [providerKey, entries] of Object.entries(order)) {
      result.push({
        type: "header",
        label: PROVIDER_LABELS[providerKey] ?? providerKey,
      });
      for (const entry of entries) {
        result.push({
          type: "model",
          label: entry.label,
          description: entry.description,
          modelId: entry.id,
          isCurrent: entry.id === currentModelId,
        });
      }
    }
    return result;
  }, [currentModelId]);

  const selectableIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.type === "model") indices.push(i);
    }
    return indices;
  }, [rows]);

  const initialIndex = useMemo(() => {
    const rowIdx = rows.findIndex(
      (r) => r.type === "model" && r.modelId === currentModelId,
    );
    const selectIdx = selectableIndices.indexOf(rowIdx);
    return selectIdx >= 0 ? selectIdx : 0;
  }, [rows, selectableIndices, currentModelId]);

  const [cursor, setCursor] = useState(initialIndex);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((prev) =>
        prev > 0 ? prev - 1 : selectableIndices.length - 1,
      );
    } else if (key.downArrow) {
      setCursor((prev) =>
        prev < selectableIndices.length - 1 ? prev + 1 : 0,
      );
    } else if (key.return) {
      const rowIdx = selectableIndices[cursor];
      const row = rowIdx !== undefined ? rows[rowIdx] : undefined;
      if (row?.modelId) onSelect(row.modelId);
    } else if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={colors.status.active}>
          Select Model
        </Text>
        <Text color={colors.text.muted}>
          {"  "}\u2191\u2193 navigate \u00B7 Enter select \u00B7 Esc cancel
        </Text>
      </Box>

      {rows.map((row, idx) => {
        if (row.type === "header") {
          return (
            <Box key={`header-${idx}`} marginTop={idx > 0 ? 1 : 0}>
              <Text bold color={colors.status.warning}>
                {"  "}
                {row.label}
              </Text>
            </Box>
          );
        }

        const isHighlighted = selectableIndices[cursor] === idx;
        const currentTag = row.isCurrent ? " (current)" : "";

        return (
          <Box key={row.modelId ?? `row-${idx}`}>
            <Text
              color={
                isHighlighted
                  ? colors.status.success
                  : row.isCurrent
                    ? colors.text.accent
                    : colors.text.primary
              }
              bold={isHighlighted}
            >
              {isHighlighted ? "\u25B8 " : "  "}
              {row.label.padEnd(30)}
            </Text>
            <Text color={colors.text.muted}>
              {" "}
              {row.description}
              {currentTag}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color={colors.text.muted}>
          {"  "}Current: {currentModelId}
        </Text>
      </Box>
    </Box>
  );
}
