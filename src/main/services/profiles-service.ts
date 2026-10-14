import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ProfileSchema, type Profile, type ProfileInput } from '@shared/domain'
import { AppException } from '@shared/errors'
import { JsonFileStore } from './json-store'

const ProfilesFileSchema = z.object({
  version: z.literal(1),
  profiles: z.array(ProfileSchema),
})

const EXE_NAME = /^[^\\/:*?"<>|]+\.exe$/i
const WINDOWS_ABSOLUTE_EXE = /^[a-zA-Z]:\\[^\0<>"|?*]+\.exe$/i

/** Validates executable names and paths coming from the renderer. */
export function validateExecutable(exeName: string, exePath: string | null): void {
  if (!EXE_NAME.test(exeName)) {
    throw new AppException('invalidExecutable', 'The executable name must end with .exe')
  }
  if (exePath !== null) {
    if (!WINDOWS_ABSOLUTE_EXE.test(exePath)) {
      throw new AppException(
        'invalidExecutable',
        'The executable path must be an absolute .exe path',
      )
    }
    const fileName = exePath.split('\\').pop() ?? ''
    if (fileName.toLowerCase() !== exeName.toLowerCase()) {
      throw new AppException('invalidExecutable', 'The executable name does not match its path')
    }
  }
}

export class ProfilesService {
  private profiles: Profile[] = []
  private readonly store: JsonFileStore<typeof ProfilesFileSchema>

  constructor(
    path: string,
    onWarning: (message: string) => void,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = new JsonFileStore(
      path,
      ProfilesFileSchema,
      () => ({ version: 1, profiles: [] }),
      onWarning,
    )
  }

  async load(): Promise<Profile[]> {
    this.profiles = (await this.store.read()).profiles
    return this.list()
  }

  list(): Profile[] {
    return [...this.profiles].sort((a, b) => a.name.localeCompare(b.name))
  }

  async save(input: ProfileInput): Promise<Profile> {
    validateExecutable(input.exeName, input.exePath)
    const timestamp = this.now().toISOString()
    const existing = input.id === null ? undefined : this.profiles.find((p) => p.id === input.id)
    if (input.id !== null && existing === undefined) {
      throw new AppException('profileNotFound', 'The profile no longer exists.')
    }
    const duplicate = this.profiles.find(
      (p) => p.name.toLowerCase() === input.name.trim().toLowerCase() && p.id !== input.id,
    )
    if (duplicate)
      throw new AppException('profileNameTaken', 'A profile with this name already exists.')

    const profile = ProfileSchema.parse({
      ...input,
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastUsedAt: existing?.lastUsedAt ?? null,
    })
    const next = existing
      ? this.profiles.map((p) => (p.id === profile.id ? profile : p))
      : [...this.profiles, profile]
    await this.persist(next)
    return profile
  }

  async delete(id: string): Promise<void> {
    if (!this.profiles.some((p) => p.id === id)) return
    await this.persist(this.profiles.filter((p) => p.id !== id))
  }

  async markUsed(id: string): Promise<void> {
    const timestamp = this.now().toISOString()
    await this.persist(
      this.profiles.map((p) => (p.id === id ? { ...p, lastUsedAt: timestamp } : p)),
    )
  }

  private async persist(profiles: Profile[]): Promise<void> {
    await this.store.write({ version: 1, profiles })
    this.profiles = profiles
  }
}
