import { describe, expect, test } from "bun:test";
import {
  elasticsearchIndexActionSuccessMessage,
  parseElasticsearchIndexBody,
} from "./elasticsearch-index-management";

describe("parseElasticsearchIndexBody", () => {
  test("returns empty body for blank input", () => {
    expect(parseElasticsearchIndexBody("   ")).toEqual({});
  });

  test("accepts JSON objects", () => {
    expect(parseElasticsearchIndexBody('{"settings":{}}')).toEqual({
      body: { settings: {} },
    });
  });

  test("rejects non-object JSON", () => {
    expect(parseElasticsearchIndexBody("[]").error).toBe(
      "Index body must be a JSON object.",
    );
  });

  test("returns parser errors", () => {
    expect(parseElasticsearchIndexBody("{").error).toBeTruthy();
  });
});

describe("elasticsearchIndexActionSuccessMessage", () => {
  test("formats delete separately", () => {
    expect(elasticsearchIndexActionSuccessMessage("delete", "products")).toBe(
      "Index deleted · products",
    );
  });

  test("formats operational actions", () => {
    expect(elasticsearchIndexActionSuccessMessage("refresh", "products")).toBe(
      "Index refresh complete · products",
    );
  });
});
