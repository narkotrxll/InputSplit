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
    // Before 0.1.1 English was the only language and was saved as a fixed choice, so those
    // settings files would keep English forever. Nobody picked it, so follow Windows instead.
    if (!this.settings.languageChosen && this.settings.language === 'en') {
      this.settings = { ...this.settings, language: 'system' }
      await this.store.write(this.settings)
    }
    return this.settings
  }

  get(): Settings {
    return this.settings
  }

  async update(patch: SettingsPatch): Promise<Settings> {
    const chosen = patch.language !== undefined || this.settings.languageChosen
    const next = SettingsSchema.parse({
      ...this.settings,
      ...patch,
      languageChosen: chosen,
      version: 1,
    })
    await this.store.write(next)
    this.settings = next
    this.changes.emit(next)
    return next
  }

  onChange(listener: (settings: Settings) => void): () => void {
    return this.changes.on(listener)
  }
}
