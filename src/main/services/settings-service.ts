import { DEFAULT_SETTINGS, SettingsSchema, type Settings, type SettingsPatch } from '@shared/domain'
import { Emitter } from '../util/emitter'
import { JsonFileStore } from './json-store'

export class SettingsService {
  private settings: Settings = DEFAULT_SETTINGS
  private readonly store: JsonFileStore<typeof SettingsSchema>
  private readonly changes = new Emitter<Settings>()

  constructor(path: string, onWarning: (message: string) => void) {
    this.store = new JsonFileStore(
      path,
      SettingsSchema,
      () => structuredClone(DEFAULT_SETTINGS),
      onWarning,
    )
  }

  async load(): Promise<Settings> {
    this.settings = await this.store.read()
    return this.settings
  }

  get(): Settings {
    return this.settings
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const next = SettingsSchema.parse({ ...this.settings, ...patch, version: 1 })
    await this.store.write(next)
    this.settings = next
    this.changes.emit(next)
    return next
  }

  onChange(listener: (settings: Settings) => void): () => void {
    return this.changes.on(listener)
  }
}
