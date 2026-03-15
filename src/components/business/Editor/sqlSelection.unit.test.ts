import { describe, it, expect } from "bun:test";
import { collectSelectedSql } from "./sqlSelection";

describe("collectSelectedSql", () => {
  it("executes only selected SQL when a selection exists", () => {
    const doc = "SELECT 1;\nSELECT 2;";
    const start = doc.indexOf("SELECT 2;");
    const end = start + "SELECT 2;".length;

    const result = collectSelectedSql({
      ranges: [{ from: start, to: end }],
      sliceDoc: (from, to) => doc.slice(from, to),
      fullDoc: () => doc,
    });

    expect(result).toBe("SELECT 2;");
  });

  it("concatenates multiple selections in order", () => {
    const doc = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    const r1Start = doc.indexOf("SELECT 1;");
    const r1End = r1Start + "SELECT 1;".length;
    const r2Start = doc.indexOf("SELECT 3;");
    const r2End = r2Start + "SELECT 3;".length;

    const result = collectSelectedSql({
      ranges: [
        { from: r1Start, to: r1End },
        { from: r2Start, to: r2End },
      ],
      sliceDoc: (from, to) => doc.slice(from, to),
      fullDoc: () => doc,
    });

    expect(result).toBe("SELECT 1;\nSELECT 3;");
  });

  it("executes full text when no valid selection exists", () => {
    const doc = "SELECT 1;\nSELECT 2;";

    const result = collectSelectedSql({
      ranges: [{ from: 0, to: 0 }],
      sliceDoc: (from, to) => doc.slice(from, to),
      fullDoc: () => doc,
    });

    expect(result).toBe(doc);
  });
});
