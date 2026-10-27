/** An action's captured session, view, or caller scope is no longer current. */
export class EnboxBindingChangedError extends Error {
  public constructor() {
    super('The Enbox binding has changed. Use the current session or view.');
    this.name = 'EnboxBindingChangedError';
  }
}
