import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

import {
  extractSub2ApiListTotal,
  shouldFetchNextSub2ApiListPage,
} from "./sub2ApiPagination";

test("continues account pagination when server caps page size below the requested size", () => {
  assert.equal(extractSub2ApiListTotal({
    items: Array.from({length: 100}),
    total: 265,
  }, 100), 265);

  assert.equal(shouldFetchNextSub2ApiListPage({
    loadedUniqueCount: 100,
    total: 265,
    lastPageItemCount: 100,
    addedUniqueCount: 100,
    page: 1,
    maxPages: 200,
  }), true);

  assert.equal(shouldFetchNextSub2ApiListPage({
    loadedUniqueCount: 265,
    total: 265,
    lastPageItemCount: 65,
    addedUniqueCount: 65,
    page: 3,
    maxPages: 200,
  }), false);
});

test("continues without a total until a page is empty or fully duplicated", () => {
  assert.equal(shouldFetchNextSub2ApiListPage({
    loadedUniqueCount: 100,
    lastPageItemCount: 100,
    addedUniqueCount: 100,
    page: 1,
    maxPages: 200,
  }), true);

  assert.equal(shouldFetchNextSub2ApiListPage({
    loadedUniqueCount: 100,
    lastPageItemCount: 0,
    addedUniqueCount: 0,
    page: 2,
    maxPages: 200,
  }), false);

  assert.equal(shouldFetchNextSub2ApiListPage({
    loadedUniqueCount: 100,
    lastPageItemCount: 100,
    addedUniqueCount: 0,
    page: 2,
    maxPages: 200,
  }), false);
});

test("account scanner does not stop on a short page caused by server page-size caps", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pageItems\.length\s*<\s*pageSize/);
  assert.match(source, /shouldFetchNextSub2ApiListPage/);
});
