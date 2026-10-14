import type { InputSplitApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    inputsplit: InputSplitApi
  }
}

export {}
