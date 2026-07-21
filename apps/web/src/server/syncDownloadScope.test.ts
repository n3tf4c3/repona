import assert from "node:assert/strict";
import test from "node:test";
import { emptySyncHighWaterMarks } from "@repona/core";
import { isListItemWithinDownloadScope } from "./syncDownloadScope";

test("activeListId forjado de outra casa nunca atravessa o download", () => {
  const marks = { ...emptySyncHighWaterMarks(), activeListId: 200, listItems: 300 };
  assert.equal(
    isListItemWithinDownloadScope(
      { id: 250, itemCasaId: 2, productCasaId: 2, shoppingListId: 200 },
      1,
      marks
    ),
    false
  );
  assert.equal(
    isListItemWithinDownloadScope(
      { id: 250, itemCasaId: 1, productCasaId: 1, shoppingListId: 200 },
      1,
      marks
    ),
    true
  );
});
