// Errors thrown by platform adapters. `reason` is a `failed` reason from
// docs/calls-bot.md (denied, invalid_meeting, join_error, ...).
export class AdapterError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.name = 'AdapterError';
    this.reason = reason;
  }
}
