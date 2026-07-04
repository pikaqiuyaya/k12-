import assert from "node:assert/strict";
import {test} from "node:test";

import {MailboxUrlCodeProvider} from "./mailbox-url";

test("treats invalid mailbox API responses as dead mailbox errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    successful: false,
    code: "EMAIL_INVALID",
    msg: "The email account is invalid",
    data: {},
  }), {status: 200})) as typeof fetch;

  try {
    const provider = new MailboxUrlCodeProvider("https://mail.example.test/code");
    await assert.rejects(
      () => provider.snapshot(),
      /mailbox dead: The email account is invalid/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
