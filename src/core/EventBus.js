/**
 * EventBus - minimal pub/sub, no dependency needed for something this small.
 *
 * Used by TournamentManager to announce things like "show the instructions
 * screen" or "a round just ended" without importing any UI code itself.
 * That's the whole point: the tournament/game-logic layer never reaches
 * into the DOM, and the UI layer never reaches into game state directly -
 * they only ever talk through events.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * @param {string} event
   * @param {Function} handler
   * @returns {Function} an unsubscribe function
   */
  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this._listeners.get(event)?.delete(handler);
  }

  emit(event, payload) {
    this._listeners.get(event)?.forEach((handler) => handler(payload));
  }
}
