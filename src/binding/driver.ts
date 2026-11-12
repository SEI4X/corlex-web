import { MemoryStore, uuid } from '#core'
import type {
  BindingDriver,
  BoundScope,
  ConsentState,
  KeyValueStore,
  PrivacyRead,
} from '#core'
import {
  choice,
  discardLegacy,
  legacyChoice,
  readPrivacy,
  samePrivacy,
  SCOPE_PREFIX,
  wipeScopes,
  writePrivacy,
} from './privacy'

/** Physical keys include both immutable owner and global privacy generation, including session state. */
export class WebBindingDriver implements BindingDriver {
  constructor(
    private readonly owner: string,
    private readonly requested: ConsentState,
  ) {}
  current = readPrivacy
  fresh = readPrivacy
  prepare(): BoundScope {
    let privacy = readPrivacy()
    const legacy = legacyChoice()
    if (privacy.kind === 'missing') privacy = writePrivacy(legacy ?? this.requested)
    if (this.requested === 'denied' && privacy.kind === 'valid' && privacy.state !== 'denied') {
      privacy = writePrivacy('denied')
      wipeScopes()
    }
    if (
      privacy.kind === 'valid' &&
      privacy.state === 'granted' &&
      this.requested === 'pending' &&
      this.scope(privacy).choice !== 'granted'
    ) {
      privacy = writePrivacy('pending')
      wipeScopes()
    }
    if (privacy.kind === 'valid') discardLegacy()
    return this.scope(privacy)
  }
  grant({ expected }: { owner: string; expected: PrivacyRead }): BoundScope {
    const current = readPrivacy()
    if (!samePrivacy(expected, current)) return this.scope(current)
    if (current.kind === 'unavailable') return this.scope(current, 'granted')
    const generation =
      current.kind === 'valid' && current.state === 'pending' ? current.generation : uuid()
    const privacy = writePrivacy('granted', generation)
    if (privacy.kind === 'valid' && (current.kind !== 'valid' || current.generation !== generation))
      wipeScopes()
    const scope = this.scope(privacy, 'granted')
    if (privacy.kind === 'valid') scope.stores.persistent.set('corlex_consent', 'granted')
    return scope
  }
  revoke(): void {
    // Publish the refusal before cleanup; another tab must never replay an old scope on regrant.
    const privacy = writePrivacy('denied')
    wipeScopes()
    if (privacy.kind === 'valid') discardLegacy()
  }
  private scope(privacy: PrivacyRead, explicit?: ConsentState): BoundScope {
    const generation = privacy.kind === 'valid' ? privacy.generation : uuid()
    const persistent = privacy.kind === 'valid'
    const prefix = `${SCOPE_PREFIX}${this.owner}:${generation}:`
    const store = (area: 'localStorage' | 'sessionStorage'): KeyValueStore => {
      if (!persistent) return new MemoryStore()
      const valid = () => samePrivacy(privacy, readPrivacy())
      return {
        get: (key) => {
          try {
            return valid() ? globalThis[area].getItem(prefix + key) : null
          } catch {
            return null
          }
        },
        set: (key, value) => {
          if (!valid()) return false
          try {
            globalThis[area].setItem(prefix + key, value)
            if (valid()) return globalThis[area].getItem(prefix + key) === value
            globalThis[area].removeItem(prefix + key)
          } catch {
            /* memory-only if unavailable */
          }
          return false
        },
        remove: (key) => {
          try {
            if (valid()) globalThis[area].removeItem(prefix + key)
          } catch {
            /* no host rows */
          }
        },
      }
    }
    const local = store('localStorage')
    const selected = explicit ?? choice(local.get('corlex_consent'))
    return {
      owner: this.owner,
      generation,
      privacy,
      persistent,
      ...(selected === undefined ? {} : { choice: selected }),
      stores: { persistent: local, identity: local, session: store('sessionStorage') },
    }
  }
}
