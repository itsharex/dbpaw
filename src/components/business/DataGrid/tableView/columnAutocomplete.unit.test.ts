import { describe, expect, test } from "bun:test";
import {
  getAutocompleteToken,
  getColumnAutocompleteOptions,
  replaceAutocompleteToken,
  type ColumnAutocompleteOption,
} from "./columnAutocomplete";

describe("column autocomplete", () => {
  test("finds the token immediately before the cursor", () => {
    expect(getAutocompleteToken("status = 1 AND ord", 18)).toEqual({
      from: 15,
      to: 18,
      text: "ord",
    });
  });

  test("returns null when the cursor is not after an identifier token", () => {
    expect(getAutocompleteToken("status = ", 9)).toBeNull();
  });

  test("does not attempt SQL string parsing", () => {
    expect(getAutocompleteToken("'ord", 4)).toEqual({
      from: 1,
      to: 4,
      text: "ord",
    });
  });

  test("replaces only the active token", () => {
    const token = getAutocompleteToken("status = 1 AND ord", 18);
    expect(token).not.toBeNull();
    expect(
      replaceAutocompleteToken("status = 1 AND ord", token!, "order"),
    ).toBe("status = 1 AND order");
  });

  test("filters options by case-insensitive prefix and caps results", () => {
    const options: ColumnAutocompleteOption[] = [
      "order",
      "order_id",
      "owner",
      "created_at",
      "other_1",
      "other_2",
      "other_3",
      "other_4",
      "other_5",
      "other_6",
    ].map((name) => ({ name }));

    const token = getAutocompleteToken("O", 1);
    expect(
      getColumnAutocompleteOptions(options, token).map((o) => o.name),
    ).toEqual([
      "order",
      "order_id",
      "owner",
      "other_1",
      "other_2",
      "other_3",
      "other_4",
      "other_5",
    ]);
  });
});
