import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

import {MailboxUrlCodeProvider} from "./mailbox-url";

test("mailbox_url fetches use an explicit direct dispatcher instead of the OpenAI global proxy", () => {
  const source = readFileSync(new URL("./mailbox-url.ts", import.meta.url), "utf8");

  assert.match(source, /const directMailboxDispatcher = new Agent\(\)/);
  assert.match(source, /dispatcher: directMailboxDispatcher/);
});

test("treats invalid mailbox API responses as dead mailbox errors", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    successful: false,
    code: "EMAIL_INVALID",
    msg: "The email account is invalid",
    data: {},
  }), {status: 200})) as typeof fetch;

  const provider = new MailboxUrlCodeProvider("https://mail.example.test/code");
  await assert.rejects(
    () => provider.snapshot({fetchImpl}),
    /mailbox dead: The email account is invalid/,
  );
});

test("times out a hung mailbox API request instead of waiting forever", async () => {
  const fetchImpl = (() => new Promise<Response>(() => undefined)) as typeof fetch;

  const provider = new MailboxUrlCodeProvider("https://mail.example.test/code");
  await assert.rejects(
    () => provider.waitForCode({timeoutMs: 80, intervalMs: 5, fetchTimeoutMs: 20, fetchImpl}),
    /mailbox code timeout: mailbox_url request timeout after 20ms/,
  );
});

test("reports mailbox wait progress while polling for a new code", async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({successful: true, data: {}}))) as typeof fetch;
  const progress: string[] = [];

  const provider = new MailboxUrlCodeProvider("https://mail.example.test/code");
  await assert.rejects(
    () => provider.waitForCode({
      timeoutMs: 25,
      intervalMs: 5,
      fetchImpl,
      progressIntervalMs: 10,
      onProgress: (event) => progress.push(event.lastError),
    }),
    /mailbox returned no code/,
  );
  assert.ok(progress.includes("mailbox returned no code"));
});
