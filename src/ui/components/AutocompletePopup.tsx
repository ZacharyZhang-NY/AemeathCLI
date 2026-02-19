/**
 * Autocomplete popup overlay for InputBar
 * Displays filtered suggestions with arrow-key navigation and scrolling
 */

import React from "react";
import { Box, Text } from "ink";
import type { IAutocompleteItem } from "../autocomplete-data.js";

const MAX_VISIBLE_ITEMS = 8;

interface IAutocompletePopupProps {
  readonly items: readonly IAutocompleteItem[];
  readonly selectedIndex: number;
}

export function AutocompletePopup({ items, selectedIndex }: IAutocompletePopupProps): React.ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  // Calculate scrolling window that follows the selected item
  const totalItems = items.length;
  const windowSize = Math.min(MAX_VISIBLE_ITEMS, totalItems);

  let scrollOffset = 0;
  if (selectedIndex >= windowSize) {
    scrollOffset = selectedIndex - windowSize + 1;
  }
  // Clamp scroll offset to valid range
  scrollOffset = Math.max(0, Math.min(scrollOffset, totalItems - windowSize));

  const visibleItems = items.slice(scrollOffset, scrollOffset + windowSize);
  const hasMore = scrollOffset + windowSize < totalItems;
  const hasLess = scrollOffset > 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
      {hasLess ? (
        <Text color="gray" dimColor>
          {"  "}... {scrollOffset} above
        </Text>
      ) : null}
      {visibleItems.map((item, visibleIndex) => {
        const actualIndex = scrollOffset + visibleIndex;
        const isSelected = actualIndex === selectedIndex;
        return (
          <Box key={`${item.label}-${actualIndex}`}>
            <Text color={isSelected ? "cyan" : "white"} bold={isSelected}>
              {isSelected ? "> " : "  "}
              {item.label}
            </Text>
            <Text color="gray" dimColor>
              {"  "}
              {item.description}
            </Text>
          </Box>
        );
      })}
      {hasMore ? (
        <Text color="gray" dimColor>
          {"  "}... {totalItems - scrollOffset - windowSize} more
        </Text>
      ) : null}
    </Box>
  );
}
