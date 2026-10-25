/** New subscriptions wait for the next publication; removed ones are skipped. */
export function notifyListeners(listeners: ReadonlySet<() => void>): void {
  for (const listener of [...listeners]) {
    if (listeners.has(listener)) {
      listener();
    }
  }
}
