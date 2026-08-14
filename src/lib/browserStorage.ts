/** Guarded localStorage writes with quota detection. */

export type StorageWriteResult =
  | { ok: true }
  | { ok: false; quotaExceeded: boolean; message: string };

export function isQuotaExceededError(error: unknown): boolean {
  if (error == null) return false;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (
      error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    ) {
      return true;
    }
    // Legacy WebKit / IE code
    if (error.code === 22 || error.code === 1014) return true;
  }
  if (typeof error === "object") {
    const name = "name" in error ? String((error as { name: unknown }).name) : "";
    const message =
      "message" in error ? String((error as { message: unknown }).message) : "";
    if (/quotaexceeded/i.test(name) || /quotaexceeded/i.test(message)) {
      return true;
    }
  }
  return /quotaexceeded/i.test(String(error));
}

export function safeLocalStorageSetItem(
  key: string,
  value: string,
): StorageWriteResult {
  try {
    localStorage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      quotaExceeded: isQuotaExceededError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function safeLocalStorageRemoveItem(key: string): StorageWriteResult {
  try {
    localStorage.removeItem(key);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      quotaExceeded: isQuotaExceededError(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
