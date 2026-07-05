import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import path from "node:path";

const writeQueues = new Map<string, Promise<void>>();

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const previous = writeQueues.get(filePath) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeJsonAtomicOnce(filePath, value));
  writeQueues.set(filePath, current);
  try {
    await current;
  } finally {
    if (writeQueues.get(filePath) === current) {
      writeQueues.delete(filePath);
    }
  }
}

async function writeJsonAtomicOnce(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, {recursive: true});
  const content = `${JSON.stringify(value, null, 2)}\n`;

  try {
    if (await readFile(filePath, "utf8") === content) return;
  } catch {
    // Missing or unreadable files are replaced below.
  }

  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(tempPath, content, "utf8");
    try {
      await rename(tempPath, filePath);
    } catch (error) {
      const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : "";
      if (code !== "EPERM" && code !== "EEXIST") throw error;
      await rm(filePath, {force: true});
      await rename(tempPath, filePath);
    }
  } catch (error) {
    await rm(tempPath, {force: true}).catch(() => undefined);
    throw error;
  }
}
