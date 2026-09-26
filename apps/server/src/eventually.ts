/** GraphQL indexes a moment after the fullnode: retry a read until it returns something. */
export async function eventually<T>(read: () => Promise<T | null>, attempts = 10, delayMs = 1000): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (value !== null) return value;
    if (i < attempts - 1) await Bun.sleep(delayMs);
  }
  return null;
}
