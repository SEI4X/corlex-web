import { CorlexCore } from '#core'
import { WebPlatform } from './platform'
import type { InitOptions } from './types'

/** One SDK instance for the browser. The module exports a singleton; tests make their own. */
export class Corlex extends CorlexCore<InitOptions> {
  constructor() {
    super(new WebPlatform())
  }
}
