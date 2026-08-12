'use client'

/**
 * SpeakingAsAvatar
 *
 * A persistent cue, seated inside the composer directly to the left of the
 * action-button cluster, of the character whose voice a typed message will
 * carry — the human's active "Speaking As" seat, resolved the same way the
 * server attributes the message (`findActiveUserParticipant`, impersonation
 * overlay aware; see Bug 45 / Bug 46).
 *
 * It stretches to the full height of the composer row (`self-stretch`, 4:5
 * portrait) and renders at full brightness when the human may type, dimming to
 * near-dark while a reply is in flight — so a glance tells the operator both
 * *who* they are speaking as and *whether* the floor is theirs.
 */

import { getAvatarSrc, type AvatarImageSource } from '@/components/ui/Avatar'

interface SpeakingAsAvatarProps {
  /** The character the human is currently speaking as. */
  name: string
  title?: string | null
  src?: AvatarImageSource | null
  /** Bright when the human may type now; dimmed to near-dark while a reply streams. */
  canType: boolean
  /** Extra wrapper classes (e.g. responsive show/hide from the composer). */
  className?: string
}

export function SpeakingAsAvatar({
  name,
  title,
  src,
  canType,
  className = '',
}: Readonly<SpeakingAsAvatarProps>) {
  const avatarSrc = getAvatarSrc(src ?? null)
  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      className={`qt-speaking-as-avatar self-stretch aspect-[4/5] max-h-40 flex-shrink-0 overflow-hidden qt-bg-muted flex items-center justify-center transition-[filter,opacity] duration-200 ${
        canType ? 'opacity-100' : 'opacity-60 brightness-50'
      } ${className}`}
      style={{ borderRadius: 'var(--radius-md)' }}
      title={canType ? `Speaking as ${name}` : `Speaking as ${name} — waiting for the room`}
      aria-label={canType ? `Speaking as ${name}` : `Speaking as ${name}, waiting for the room`}
    >
      {avatarSrc ? (

        <img src={avatarSrc} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="font-bold qt-text-secondary text-lg">{initial}</span>
      )}
    </div>
  )
}

export default SpeakingAsAvatar
