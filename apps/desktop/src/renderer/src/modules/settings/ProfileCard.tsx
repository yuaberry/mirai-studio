/**
 * ProfileCard — who is making the anime (v2.1).
 *
 * The full identity surface the user asked for: avatar, name, SOCIAL name,
 * COMPANY name, gender, pronouns, bio and links. Everything is optional except
 * a display name — an identity is never coerced into a form.
 *
 * The avatar is a real FILE conversation with the main process (base64 over
 * IPC, validated there), not a renderer-side data URI pretending to be stored.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload, User } from 'lucide-react'
import { MiraiError, GENDER_OPTIONS } from '@mirai/shared'
import { invoke } from '../../lib/ipc'
import { useT } from '../../lib/i18n'
import { Button, Input, Label, Select, Textarea } from '../../system/ui'
import { toast } from '../../store/appStore'

/** The shape the hooks below return. */
interface Profile {
  id: string
  displayName: string
  socialName: string
  companyName: string
  maker: 'solo' | 'studio' | 'collective'
  gender: string
  pronouns: string
  bio: string
  location: string
  website: string
  social: Record<string, string>
  avatarPath: string
  createdAt: string
  updatedAt: string
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const reload = async () => {
    try {
      setError(null)
      const p = (await invoke('profile:get', {})) as Profile
      setProfile(p)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const patch = async (patch: Partial<Profile>) => {
    const next = (await invoke('profile:update', patch)) as Profile
    setProfile(next)
    return next
  }

  const setAvatar = async (file: File) => {
    const bytes = await file.arrayBuffer()
    const next = (await invoke('profile:avatar:set', {
      fileName: file.name,
      bytes: Buffer.from(bytes).toString('base64'),
    })) as Profile
    setProfile(next)
    return next
  }

  return { profile, isLoading, error, patch, setAvatar, reload }
}

/** Reads the avatar as a displayable URL, or null. */
function useAvatarUrl(reloadKey: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let created: string | null = null
    void (async () => {
      try {
        const r = (await invoke('profile:avatar:read', {})) as {
          hasAvatar: boolean
          mimeType: string
          bytes: string
        }
        if (!r.hasAvatar || !r.bytes) {
          if (alive) setUrl(null)
          return
        }
        created = `data:${r.mimeType};base64,${r.bytes}`
        if (alive) setUrl(created)
      } catch {
        if (alive) setUrl(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [reloadKey])
  return url
}

export function ProfileCard() {
  const tr = useT()
  const { profile, patch, setAvatar, reload } = useProfile()
  const fileRef = useRef<HTMLInputElement>(null)
  const avatarUrl = useAvatarUrl(profile?.avatarPath ?? '')

  const initials = useMemo(() => {
    const name = profile?.displayName?.trim() || 'Mirai'
    return name.slice(0, 1).toUpperCase()
  }, [profile?.displayName])

  if (!profile) return null

  return (
    <div className="space-y-3">
      {/* ---- avatar + identity ------------------------------------------- */}
      <div className="flex items-start gap-4">
        <div className="relative">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt=""
              className="h-20 w-20 rounded-full border-2 border-mirai-border object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-mirai-border bg-gradient-mirai text-2xl font-bold text-white">
              {initials}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute -right-1 -bottom-1 rounded-full border border-mirai-border bg-mirai-panel p-1.5 text-mirai-dim transition-colors hover:text-mirai-accent"
            title={tr('Change photo')}
          >
            <Upload className="h-3 w-3" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                await setAvatar(file)
                toast({ kind: 'success', title: tr('Photo updated') })
              } catch (err) {
                const message =
                  err instanceof MiraiError ? err.message : err instanceof Error ? err.message : String(err)
                toast({ kind: 'error', title: tr('Could not use that photo'), description: message })
              }
            }}
          />
        </div>

        <div className="grid flex-1 grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px]">{tr('Display name')}</Label>
            <Input
              className="h-8 text-xs"
              value={profile.displayName}
              onChange={(e) => void patch({ displayName: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <Label className="text-[10px]">{tr('Social name')} · {tr('optional')}</Label>
            <Input
              className="h-8 text-xs"
              value={profile.socialName}
              onChange={(e) => void patch({ socialName: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <Label className="text-[10px]">{tr('Company / studio name')}</Label>
            <Input
              className="h-8 text-xs"
              value={profile.companyName}
              onChange={(e) => void patch({ companyName: e.target.value })}
              maxLength={120}
            />
          </div>
          <div>
            <Label className="text-[10px]">{tr('I make anime as')}</Label>
            <Select
              className="h-8 text-xs"
              value={profile.maker}
              onChange={(e) => void patch({ maker: e.target.value as Profile['maker'] })}
            >
              <option value="solo">{tr('Solo creator')}</option>
              <option value="collective">{tr('Collective')}</option>
              <option value="studio">{tr('Studio / company')}</option>
            </Select>
          </div>
        </div>
      </div>

      {/* ---- identity ----------------------------------------------------- */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px]">{tr('Gender')} · {tr('optional')}</Label>
          <Input
            className="h-8 text-xs"
            list="profile-genders"
            value={profile.gender}
            onChange={(e) => void patch({ gender: e.target.value })}
            maxLength={40}
          />
          <datalist id="profile-genders">
            {GENDER_OPTIONS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        <div>
          <Label className="text-[10px]">{tr('Pronouns')}</Label>
          <Input
            className="h-8 text-xs"
            value={profile.pronouns}
            onChange={(e) => void patch({ pronouns: e.target.value })}
            maxLength={40}
          />
        </div>
        <div>
          <Label className="text-[10px]">{tr('Location')}</Label>
          <Input
            className="h-8 text-xs"
            value={profile.location}
            onChange={(e) => void patch({ location: e.target.value })}
            maxLength={120}
          />
        </div>
      </div>

      <div>
        <Label className="text-[10px]">{tr('Bio')}</Label>
        <Textarea
          rows={2}
          value={profile.bio}
          onChange={(e) => void patch({ bio: e.target.value })}
          maxLength={1_000}
        />
      </div>

      <div>
        <Label className="text-[10px]">{tr('Website')}</Label>
        <Input
          className="h-8 text-xs"
          value={profile.website}
          onChange={(e) => void patch({ website: e.target.value })}
          maxLength={200}
          placeholder="https://…"
        />
      </div>

      {/* ---- the honest state of collaboration --------------------------- */}
      <div className="rounded-md border border-mirai-border bg-mirai-bg/40 p-3">
        <p className="text-[10px] font-semibold text-mirai-dim">{tr('Public card preview')}</p>
        <div className="mt-2 flex items-center gap-2">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-mirai text-xs font-bold text-white">
              <User className="h-4 w-4" />
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-mirai-text">{profile.displayName}</p>
            <p className="text-[10px] text-mirai-faint">
              {[profile.companyName, profile.pronouns, profile.location].filter(Boolean).join(' · ') || tr('Solo creator')}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-mirai-faint">
          {tr('Sharing projects between creators needs a server to sync through — that is the next milestone. ' +
              'The profile is the real identity layer it will use, and it already travels with your backups.')}
        </p>
      </div>


      <Button size="sm" variant="outline" onClick={() => void reload()}>
        {tr('Reload')}
      </Button>
    </div>
  )
}