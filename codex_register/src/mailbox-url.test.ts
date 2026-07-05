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

test("times out a hung mailbox API request instead of waiting forever", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => undefined)) as typeof fetch;

  try {
    const provider = new MailboxUrlCodeProvider("https://mail.example.test/code");
    await assert.rejects(
      () => provider.waitForCode({timeoutMs: 80, intervalMs: 5, fetchTimeoutMs: 20}),
      /mailbox code timeout: mailbox_url request timeout after 20ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports mailbox wait progress while polling for a new code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({successful: true, data: {}}))) as typeof fetch;
  const progress: string[] = [];

  try {
    const provider = new MailboxUrlCodeProvider("https://mail.example.test/code");
    await assert.rejects(
      () => provider.waitForCode({
        timeoutMs: 25,
        intervalMs: 5,
        progressIntervalMs: 10,
        onProgress: (event) => progress.push(event.lastError),
      }),
      /mailbox returned no code/,
    );
    assert.ok(progress.includes("mailbox returned no code"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
