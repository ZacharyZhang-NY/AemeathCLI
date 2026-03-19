/**
 * Autocomplete popup overlay with themed colors,
 * scroll indicators, and visual selection highlight.
 */

import React from "react";
import { Box, Text } from "ink";
import { colors } from "../theme.js";
import type { IAutocompleteItem } from "../autocomplete-data.js";

const MAX_VISIBLE_ITEMS = 8;
const SCROLL_UP_LABEL = "▲";
const SCROLL_DOWN_LABEL = "▼";
const SELECTED_LABEL = "▸ ";

interface IAutocompletePopupProps {
  readonly items: readonly IAutocompleteItem[];
  readonly selectedIndex: number;
}

export function AutocompletePopup({
  items,
  selectedIndex,
}: IAutocompletePopupProps): React.ReactElement | null {
  if (items.length === 0) return null;

  const totalItems = items.length;
  const windowSize = Math.min(MAX_VISIBLE_ITEMS, totalItems);

  let scrollOffset = 0;
  if (selectedIndex >= windowSize) {
    scrollOffset = selectedIndex - windowSize + 1;
  }
  scrollOffset = Math.max(
    0,
    Math.min(scrollOffset, totalItems - windowSize),
  );

  const visibleItems = items.slice(scrollOffset, scrollOffset + windowSize);
  const hasMore = scrollOffset + windowSize < totalItems;
  const hasLess = scrollOffset > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.status.active}
      paddingX={1}
      marginBottom={0}
    >
      {/* Scroll-up indicator */}
      {hasLess ? (
        <Text color={colors.text.muted} dimColor>
          {"  "}
          {SCROLL_UP_LABEL} {scrollOffset} above
        </Text>
      ) : null}

      {visibleItems.map((item, visibleIndex) => {
        const actualIndex = scrollOffset + visibleIndex;
        const isSelected = actualIndex === selectedIndex;
        return (
          <Box key={`${item.label}-${actualIndex}`}>
            <Text
              color={isSelected ? colors.status.active : colors.text.primary}
              bold={isSelected}
            >
              {isSelected ? SELECTED_LABEL : "  "}
              {item.label}
            </Text>
            <Text color={colors.text.muted} dimColor>
              {"  "}
              {item.description}
            </Text>
          </Box>
        );
      })}

      {/* Scroll-down indicator */}
      {hasMore ? (
        <Text color={colors.text.muted} dimColor>
          {"  "}
          {SCROLL_DOWN_LABEL} {totalItems - scrollOffset - windowSize} more
        </Text>
      ) : null}
    </Box>
  );
}
