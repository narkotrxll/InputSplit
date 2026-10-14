/**
 * Channel names only (no schemas), so the sandboxed preload script stays tiny and does not
 * bundle Zod. `ipc-contract.test.ts` checks that these lists match the contract exactly.
 */
export const INVOKE_CHANNEL_NAMES = [
  'app:getInfo',
  'app:openExternal',
  'backend:getState',
  'backend:restart',
  'windows:list',
  'windows:icon',
  'windows:checkTarget',
  'controllers:list',
  'controllers:startTest',
  'controllers:stopTest',
  'displays:list',
  'isolation:get',
  'isolation:start',
  'isolation:stop',
  'isolation:dismiss',
  'profiles:list',
  'profiles:save',
  'profiles:delete',
  'profiles:markUsed',
  'profiles:pickExecutable',
  'settings:get',
  'settings:update',
  'diagnostics:getLogs',
  'diagnostics:openLogFolder',
  'diagnostics:export',
] as const

export const EVENT_CHANNEL_NAMES = [
  'backend:state',
  'isolation:changed',
  'controllers:changed',
  'controllers:state',
  'displays:changed',
  'log:entry',
  'app:navigate',
] as const
