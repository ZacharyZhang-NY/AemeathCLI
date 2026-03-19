/**
 * Semantic color token system for AemeathCLI terminal UI.
 * Brand palette: pink / rose / off-white / mauve / brown.
 */

/** Primary brand color */
export const BRAND_COLOR = "#F0C5DA";

/** Semantic color tokens */
export const colors = {
  text: {
    primary: "#F9F5F5",
    secondary: "#d3acb3",
    muted: "#9e8085",
    accent: "#F0C5DA",
    response: "#F9F5F5",
  },
  border: {
    dim: "#6b5459",
    active: "#d3acb3",
    focus: "#F0C5DA",
  },
  syntax: {
    keyword: "#F0C5DA",
    string: "#EDD6DC",
    function: "#F9F5F5",
    comment: "#9e8085",
    number: "#EDD6DC",
    type: "#F0C5DA",
  },
  status: {
    success: "#F0C5DA",
    error: "#f87171",
    warning: "#EDD6DC",
    info: "#F0C5DA",
    pending: "#d3acb3",
    active: "#F0C5DA",
  },
  role: {
    user: "#F0C5DA",
    assistant: "#F9F5F5",
    system: "#EDD6DC",
    tool: "#d3acb3",
  },
} as const;
