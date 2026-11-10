// Platform registry. Each adapter implements:
//
//   allowedHosts: string[]                     hosts the page may navigate to
//   join(page, { botName, timeoutMs, shouldStop }) -> 'asked' | 'direct' | 'stopped'
//   waitAdmitted(page, timeoutMs, { shouldStop }) -> 'admitted' | 'denied' | 'timeout' | 'ended' | 'stopped'
//   sendChat(page, text) -> Promise<void>
//   enableCaptions(page) -> Promise<boolean>
//   readState(page, { botName }) -> { inCall, ended, removed, alone, participantCount,
//                                      participants, activeSpeakers, captions, samples }
//   leave(page) -> Promise<void>
//
// Adapter errors carry `reason` (a `failed` reason from docs/calls-bot.md).
import { AdapterError } from './errors.js';
import { meet } from './meet.js';

export { AdapterError };

export const SUPPORTED_PLATFORMS = ['meet'];

/** @param {string} name */
function unsupported(name) {
  const fail = () => {
    throw new AdapterError('unsupported_platform');
  };
  return { name, allowedHosts: [], join: fail, waitAdmitted: fail, sendChat: fail, enableCaptions: fail, readState: fail, leave: fail };
}

const registry = {
  meet,
  zoom: unsupported('zoom'),
  teams: unsupported('teams'),
};

/** @param {string} platform */
export function getAdapter(platform) {
  const a = /** @type {Record<string, any>} */ (registry)[platform];
  if (!a || !SUPPORTED_PLATFORMS.includes(platform)) throw new AdapterError('unsupported_platform');
  return a;
}
