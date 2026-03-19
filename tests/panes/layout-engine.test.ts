import { describe, expect, it } from "vitest";
import { LayoutEngine } from "../../src/panes/layout-engine.js";
import type { ILayoutConfig, IPaneConfig } from "../../src/types/team.js";

function createPane(index: number): IPaneConfig {
  return {
    paneId: `pane-${index}`,
    agentName: `Agent ${index}`,
    model: "gpt-5.2-codex",
    role: "testing",
    title: `Pane ${index}`,
  };
}

function createConfig(
  paneCount: number,
  overrides: Partial<ILayoutConfig> = {},
): ILayoutConfig {
  return {
    layout: "auto",
    panes: Array.from({ length: paneCount }, (_, index) => createPane(index + 1)),
    maxPanes: 10,
    ...overrides,
  };
}

describe("LayoutEngine", () => {
  it("returns an empty layout when no panes are configured", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(0));

    expect(result).toEqual({
      panes: [],
      rows: 0,
      cols: 0,
      terminalWidth: 120,
      terminalHeight: 40,
    });
  });

  it("uses horizontal auto layout for a single pane", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(1));

    expect(result.rows).toBe(1);
    expect(result.cols).toBe(1);
    expect(result.panes).toEqual([
      {
        paneId: "pane-1",
        row: 0,
        col: 0,
        widthPercent: 100,
        heightPercent: 100,
        splitDirection: "none",
      },
    ]);
  });

  it("uses hub-spoke auto layout when multiple panes are present", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(3));

    expect(result.rows).toBe(2);
    expect(result.cols).toBe(2);
    expect(result.panes).toEqual([
      {
        paneId: "pane-1",
        row: 0,
        col: 0,
        widthPercent: 50,
        heightPercent: 100,
        splitDirection: "none",
      },
      {
        paneId: "pane-2",
        row: 0,
        col: 1,
        widthPercent: 50,
        heightPercent: 50,
        splitDirection: "horizontal",
      },
      {
        paneId: "pane-3",
        row: 1,
        col: 1,
        widthPercent: 50,
        heightPercent: 50,
        splitDirection: "vertical",
      },
    ]);
  });

  it("distributes leftover width to the final pane in horizontal layouts", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(3, { layout: "horizontal" }));

    expect(result.panes.map((pane) => pane.widthPercent)).toEqual([33, 33, 34]);
    expect(result.panes.map((pane) => pane.heightPercent)).toEqual([100, 100, 100]);
    expect(result.panes.map((pane) => pane.splitDirection)).toEqual([
      "none",
      "horizontal",
      "horizontal",
    ]);
  });

  it("distributes leftover height to the final pane in vertical layouts", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(3, { layout: "vertical" }));

    expect(result.panes.map((pane) => pane.heightPercent)).toEqual([33, 33, 34]);
    expect(result.panes.map((pane) => pane.widthPercent)).toEqual([100, 100, 100]);
    expect(result.panes.map((pane) => pane.splitDirection)).toEqual([
      "none",
      "vertical",
      "vertical",
    ]);
  });

  it("creates the documented 3-pane grid with a full-width leader row", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(3, { layout: "grid" }));

    expect(result.rows).toBe(2);
    expect(result.cols).toBe(2);
    expect(result.panes).toEqual([
      {
        paneId: "pane-1",
        row: 0,
        col: 0,
        widthPercent: 100,
        heightPercent: 50,
        splitDirection: "none",
      },
      {
        paneId: "pane-2",
        row: 1,
        col: 0,
        widthPercent: 50,
        heightPercent: 50,
        splitDirection: "vertical",
      },
      {
        paneId: "pane-3",
        row: 1,
        col: 1,
        widthPercent: 50,
        heightPercent: 50,
        splitDirection: "horizontal",
      },
    ]);
  });

  it("expands the last row in 5-pane grids when it is only partially filled", () => {
    const engine = new LayoutEngine({ columns: 120, rows: 40 });

    const result = engine.computeLayout(createConfig(5, { layout: "grid" }));

    expect(result.rows).toBe(3);
    expect(result.cols).toBe(3);
    expect(result.panes).toEqual([
      {
        paneId: "pane-1",
        row: 0,
        col: 0,
        widthPercent: 100,
        heightPercent: 40,
        splitDirection: "none",
      },
      {
        paneId: "pane-2",
        row: 1,
        col: 0,
        widthPercent: 33,
        heightPercent: 30,
        splitDirection: "vertical",
      },
      {
        paneId: "pane-3",
        row: 1,
        col: 1,
        widthPercent: 33,
        heightPercent: 30,
        splitDirection: "horizontal",
      },
      {
        paneId: "pane-4",
        row: 1,
        col: 2,
        widthPercent: 34,
        heightPercent: 30,
        splitDirection: "horizontal",
      },
      {
        paneId: "pane-5",
        row: 2,
        col: 0,
        widthPercent: 100,
        heightPercent: 30,
        splitDirection: "vertical",
      },
    ]);
  });

  it("caps the effective pane count by terminal capacity and maxPanes", () => {
    const engine = new LayoutEngine({ columns: 80, rows: 20 });

    const result = engine.computeLayout(createConfig(6, { layout: "horizontal", maxPanes: 5 }));

    expect(engine.getMaxPanes()).toBe(4);
    expect(engine.canFitPanes(4)).toBe(true);
    expect(engine.canFitPanes(5)).toBe(false);
    expect(result.panes).toHaveLength(4);
    expect(result.panes.map((pane) => pane.paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
    ]);
  });
});
