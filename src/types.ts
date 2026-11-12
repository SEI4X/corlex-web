import type {
  BaseInitOptions,
  CorlexApi as CoreApi,
  ConfigApi as CoreConfigApi,
  ConfigJson as CoreConfigJson,
  ConfigOptions as CoreConfigOptions,
  ConfigUpdate as CoreConfigUpdate,
  ConsentState as CoreConsentState,
  ExperimentAssignment as CoreExperimentAssignment,
  Properties as CoreProperties,
  WireContext,
  WireEvent as CoreEvent,
} from '#core'

// Aliases, not re-exports: the declaration bundler needs a local name for every public type.
export type Properties = CoreProperties
export type ConfigApi = CoreConfigApi
export type ConfigJson = CoreConfigJson
export type ConfigOptions = CoreConfigOptions
export type ConfigUpdate = CoreConfigUpdate
export type ConsentState = CoreConsentState
export type ExperimentAssignment = CoreExperimentAssignment

/** Which automatic events to collect. Every part is on by default. */
export interface AutocaptureOptions {
  pageViews?: boolean
  clicks?: boolean
  forms?: boolean
  errors?: boolean
}

export interface InitOptions extends BaseInitOptions {
  /** `true` (default) collects everything, `false` nothing, or pick parts. */
  autocapture?: boolean | AutocaptureOptions
  /** Collect nothing when Do Not Track or Global Privacy Control is on. Default `true`. */
  respectDnt?: boolean
  /**
   * Extra query parameter names to keep as event properties. Query strings are
   * never captured otherwise, except `utm_*`, `gclid`, `fbclid` and `yclid`.
   */
  captureQueryParams?: string[]
}

/** An event as `POST /v1/batch` takes it (services/ingest/docs/protocol.md). */
export type WireEvent = CoreEvent & { context: WireContext & { platform: 'web' } }

/** The public API, shared by the npm module and `window.corlex`. */
export type CorlexApi = CoreApi<InitOptions>
