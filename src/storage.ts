// Every storage access is wrapped: private windows, blocked site data and
// sandboxed frames throw, and the SDK must keep working in memory.

type Area = 'localStorage' | 'sessionStorage'

function area(name: Area): Storage | null {
  try {
    return globalThis[name]
  } catch {
    return null
  }
}

export function read(name: Area, key: string): string | null {
  try {
    return area(name)?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Returns false when the value could not be stored. */
export function write(name: Area, key: string, value: string): boolean {
  try {
    area(name)?.setItem(key, value)
    return area(name)?.getItem(key) === value
  } catch {
    return false
  }
}

export function remove(name: Area, key: string): void {
  try {
    area(name)?.removeItem(key)
  } catch {
    // Nothing to clean when storage is unavailable.
  }
}

export function readCookie(key: string): string | null {
  try {
    const prefix = `${key}=`
    const part = document.cookie.split('; ').find((c) => c.startsWith(prefix))
    return part ? decodeURIComponent(part.slice(prefix.length)) : null
  } catch {
    return null
  }
}

const YEAR = 60 * 60 * 24 * 365

export function writeCookie(key: string, value: string): void {
  try {
    document.cookie = `${key}=${encodeURIComponent(value)}; max-age=${YEAR}; path=/; SameSite=Lax`
  } catch {
    // Cookies disabled: the id then lives for the page only.
  }
}

export function removeCookie(key: string): void {
  try {
    document.cookie = `${key}=; max-age=0; path=/; SameSite=Lax`
  } catch {
    // Nothing to remove.
  }
}
