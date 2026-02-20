/**
 * Layout engine for split-panel auto-layout computation per PRD section 9.2.
 * Computes pane positions based on agent count and terminal dimensions.
 */

import type { PaneLayout, IPaneConfig, ILayoutConfig } from "../types/team.js";
import { logger } from "../utils/logger.js";

// ── Layout Geometry ─────────────────────────────────────────────────────

export interface IPaneGeometry {
  readonly paneId: string;
  readonly row: number;
  readonly col: number;
  readonly widthPercent: number;
  readonly heightPercent: number;
  readonly splitDirection: "horizontal" | "vertical" | "none";
}

export interface IComputedLayout {
  readonly panes: readonly IPaneGeometry[];
  readonly rows: number;
  readonly cols: number;
  readonly terminalWidth: number;
  readonly terminalHeight: number;
}

interface ITerminalSize {
  readonly columns: number;
  readonly rows: number;
}

// ── Constants ───────────────────────────────────────────────────────────

const MIN_PANE_WIDTH = 40;
const MIN_PANE_HEIGHT = 10;
const DEFAULT_TERMINAL_WIDTH = 120;
const DEFAULT_TERMINAL_HEIGHT = 40;
const MAX_GRID_COLUMNS = 3;

// ── Layout Engine ───────────────────────────────────────────────────────

export class LayoutEngine {
  private readonly terminalSize: ITerminalSize;

  constructor(terminalSize?: Partial<ITerminalSize>) {
    this.terminalSize = {
      columns: terminalSize?.columns ?? this.detectTerminalWidth(),
      rows: terminalSize?.rows ?? this.detectTerminalHeight(),
    };
    logger.debug(
      { terminalSize: this.terminalSize },
      "LayoutEngine initialized",
    );
  }

  /**
   * Compute the full layout for a set of pane configs.
   */
  computeLayout(config: ILayoutConfig): IComputedLayout {
    const paneCount = config.panes.length;
    if (paneCount === 0) {
      return {
        panes: [],
        rows: 0,
        cols: 0,
        terminalWidth: this.terminalSize.columns,
        terminalHeight: this.terminalSize.rows,
      };
    }

    const effectiveCount = Math.max(
      1,
      Math.min(paneCount, config.maxPanes, this.getMaxPanes()),
    );
    const layout = config.layout === "auto"
      ? this.resolveAutoLayout(effectiveCount)
      : config.layout;

    const geometries = this.computeGeometries(
      config.panes.slice(0, effectiveCount),
      layout,
      effectiveCount,
    );

    const { gridRows, gridCols } = this.getGridDimensions(effectiveCount, layout);

    logger.info(
      { layout, paneCount: effectiveCount, gridRows, gridCols },
      "Layout computed",
    );

    return {
      panes: geometries,
      rows: gridRows,
      cols: gridCols,
      terminalWidth: this.terminalSize.columns,
      terminalHeight: this.terminalSize.rows,
    };
  }

  /**
   * Determine the best auto-layout for a given pane count (PRD section 9.2).
   */
  resolveAutoLayout(paneCount: number): Exclude<PaneLayout, "auto"> {
    if (paneCount <= 1) return "horizontal";
    if (paneCount === 2) return "horizontal";
    if (paneCount <= 4) return "grid";
    return "grid";
  }

  /**
   * Get the maximum number of panes the terminal can support.
   */
  getMaxPanes(): number {
    const maxByWidth = Math.floor(this.terminalSize.columns / MIN_PANE_WIDTH);
    const maxByHeight = Math.floor(this.terminalSize.rows / MIN_PANE_HEIGHT);
    return Math.max(1, maxByWidth * maxByHeight);
  }

  /**
   * Check if the terminal is large enough for the requested pane count.
   */
  canFitPanes(paneCount: number): boolean {
    return paneCount <= this.getMaxPanes();
  }

  /**
   * Get the grid dimensions for a given pane count and layout type.
   */
  private getGridDimensions(
    paneCount: number,
    layout: Exclude<PaneLayout, "auto">,
  ): { gridRows: number; gridCols: number } {
    switch (layout) {
      case "horizontal":
        return { gridRows: 1, gridCols: paneCount };
      case "vertical":
        return { gridRows: paneCount, gridCols: 1 };
      case "grid":
        return this.computeGridSize(paneCount);
    }
  }

  /**
   * Compute grid rows and columns for a given pane count.
   * PRD section 9.2:
   *   2 agents → horizontal split (50/50) → 1x2
   *   3 agents → 1 top + 2 bottom → 2 rows
   *   4 agents → 2x2 grid
   *   5+ agents → leader top + grid bottom
   */
  private computeGridSize(paneCount: number): { gridRows: number; gridCols: number } {
    if (paneCount <= 1) return { gridRows: 1, gridCols: 1 };
    if (paneCount === 2) return { gridRows: 1, gridCols: 2 };
    if (paneCount <= 4) return { gridRows: 2, gridCols: 2 };

    const bottomPaneCount = paneCount - 1;
    const gridCols = Math.min(bottomPaneCount, MAX_GRID_COLUMNS);
    const gridRows = 1 + Math.ceil(bottomPaneCount / gridCols);
    return { gridRows, gridCols };
  }

  /**
   * Compute per-pane geometries based on layout type.
   */
  private computeGeometries(
    panes: readonly IPaneConfig[],
    layout: Exclude<PaneLayout, "auto">,
    paneCount: number,
  ): IPaneGeometry[] {
    switch (layout) {
      case "horizontal":
        return this.computeHorizontalLayout(panes);
      case "vertical":
        return this.computeVerticalLayout(panes);
      case "grid":
        return this.computeGridLayout(panes, paneCount);
    }
  }

  /**
   * Horizontal split: all panes side by side.
   */
  private computeHorizontalLayout(panes: readonly IPaneConfig[]): IPaneGeometry[] {
    const widthPercent = Math.floor(100 / panes.length);
    return panes.map((pane, index) => ({
      paneId: pane.paneId,
      row: 0,
      col: index,
      widthPercent: index === panes.length - 1
        ? 100 - widthPercent * (panes.length - 1)
        : widthPercent,
      heightPercent: 100,
      splitDirection: index === 0 ? "none" as const : "horizontal" as const,
    }));
  }

  /**
   * Vertical split: all panes stacked.
   */
  private computeVerticalLayout(panes: readonly IPaneConfig[]): IPaneGeometry[] {
    const heightPercent = Math.floor(100 / panes.length);
    return panes.map((pane, index) => ({
      paneId: pane.paneId,
      row: index,
      col: 0,
      widthPercent: 100,
      heightPercent: index === panes.length - 1
        ? 100 - heightPercent * (panes.length - 1)
        : heightPercent,
      splitDirection: index === 0 ? "none" as const : "vertical" as const,
    }));
  }

  /**
   * Grid layout per PRD section 9.2 rules:
   *   3 agents → leader spans top, 2 on bottom
   *   4 agents → 2x2 even grid
   *   5+ agents → leader spans top, rest in grid below
   */
  private computeGridLayout(
    panes: readonly IPaneConfig[],
    paneCount: number,
  ): IPaneGeometry[] {
    const geometries: IPaneGeometry[] = [];

    if (paneCount <= 2) {
      return this.computeHorizontalLayout(panes);
    }

    if (paneCount === 3) {
      // 1 top (leader, full width) + 2 bottom
      const firstPane = panes[0];
      if (firstPane) {
        geometries.push({
          paneId: firstPane.paneId,
          row: 0,
          col: 0,
          widthPercent: 100,
          heightPercent: 50,
          splitDirection: "none",
        });
      }
      const bottomPanes = panes.slice(1);
      for (let i = 0; i < bottomPanes.length; i++) {
        const pane = bottomPanes[i];
        if (pane) {
          geometries.push({
            paneId: pane.paneId,
            row: 1,
            col: i,
            widthPercent: 50,
            heightPercent: 50,
            splitDirection: i === 0 ? "vertical" : "horizontal",
          });
        }
      }
      return geometries;
    }

    if (paneCount === 4) {
      // 2x2 even grid
      const { gridCols } = this.computeGridSize(4);
      for (let i = 0; i < panes.length; i++) {
        const pane = panes[i];
        if (pane) {
          const row = Math.floor(i / gridCols);
          const col = i % gridCols;
          geometries.push({
            paneId: pane.paneId,
            row,
            col,
            widthPercent: 50,
            heightPercent: 50,
            splitDirection: this.determineSplitDirection(i, row, col),
          });
        }
      }
      return geometries;
    }

    // 5+ agents: leader top + grid bottom
    const firstPane = panes[0];
    if (firstPane) {
      geometries.push({
        paneId: firstPane.paneId,
        row: 0,
        col: 0,
        widthPercent: 100,
        heightPercent: 40,
        splitDirection: "none",
      });
    }

    const bottomPanes = panes.slice(1);
    const bottomCols = Math.min(bottomPanes.length, MAX_GRID_COLUMNS);
    const bottomRows = Math.ceil(bottomPanes.length / bottomCols);
    const cellWidth = Math.floor(100 / bottomCols);
    const cellHeight = Math.floor(60 / bottomRows);

    for (let i = 0; i < bottomPanes.length; i++) {
      const pane = bottomPanes[i];
      if (pane) {
        const row = Math.floor(i / bottomCols) + 1;
        const col = i % bottomCols;
        const isLastInRow = col === bottomCols - 1 || i === bottomPanes.length - 1;
        geometries.push({
          paneId: pane.paneId,
          row,
          col,
          widthPercent: isLastInRow ? 100 - cellWidth * col : cellWidth,
          heightPercent: cellHeight,
          splitDirection: this.determineSplitDirection(i + 1, row, col),
        });
      }
    }

    return geometries;
  }

  /**
   * Determine split direction based on position in grid.
   */
  private determineSplitDirection(
    index: number,
    row: number,
    col: number,
  ): "horizontal" | "vertical" | "none" {
    if (index === 0) return "none";
    if (col === 0) return "vertical";
    return "horizontal";
  }

  /**
   * Detect terminal width from environment.
   */
  private detectTerminalWidth(): number {
    const columns = process.stdout.columns;
    return Number.isFinite(columns) && columns > 0 ? columns : DEFAULT_TERMINAL_WIDTH;
  }

  /**
   * Detect terminal height from environment.
   */
  private detectTerminalHeight(): number {
    const rows = process.stdout.rows;
    return Number.isFinite(rows) && rows > 0 ? rows : DEFAULT_TERMINAL_HEIGHT;
  }
}
