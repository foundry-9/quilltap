'use client'

import { useMemo } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarClasses } from '@/lib/avatar-styles'
import { useQuickHide } from '@/components/providers/quick-hide-provider'

interface FavoriteCharacter {
  id: string
  name: string
  title?: string | null
  defaultImageId: string | null
  defaultImage: {
    id: string
    filepath: string
    url?: string | null
  } | null
  avatarUrl: string | null
  tags?: string[]
}

interface FavoriteCharactersProps {
  characters: FavoriteCharacter[]
}

function getAvatarSrc(character: FavoriteCharacter): string | null {
  if (character.defaultImage) {
    return character.defaultImage.url || `/${character.defaultImage.filepath}`
  }
  return character.avatarUrl || null
}

export function FavoriteCharactersSection({ characters }: FavoriteCharactersProps) {
  const { style } = useAvatarDisplay()
  const { shouldHideByIds } = useQuickHide()
  const visibleCharacters = useMemo(
    () => characters.filter(character => !shouldHideByIds(character.tags || [])),
    [characters, shouldHideByIds]
  )

  if (visibleCharacters.length === 0) {
    return null
  }

  return (
    <div className="mt-8">
      <h2 className="mb-6 text-2xl font-bold text-gray-900 dark:text-white">
        Your Favorite Characters
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {visibleCharacters.map((character) => (
          <Link
            key={character.id}
            href={`/characters/${character.id}/view`}
            className="flex flex-col items-center gap-4 p-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 dark:hover:border-blue-500 hover:shadow-md transition-all"
          >
            {getAvatarSrc(character) ? (
              <Image
                src={getAvatarSrc(character)!}
                alt={character.name}
                width={80}
                height={80}
                className={getAvatarClasses(style, 'lg').imageClass}
              />
            ) : (
              <div className={getAvatarClasses(style, 'lg').wrapperClass} style={style === 'RECTANGULAR' ? { aspectRatio: '4/5' } : undefined}>
                <span className={getAvatarClasses(style, 'lg').fallbackClass}>
                  {character.name.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white text-center truncate w-full px-1">
              {character.name}
            </h3>
            {character.title && (
              <p className="text-xs text-gray-600 dark:text-gray-400 text-center truncate w-full px-1">
                {character.title}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
