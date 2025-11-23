/**
 * Avatar Display Styles Utility
 * Provides consistent avatar styling across the entire application
 * Supports both circular and rectangular (5:4 aspect ratio) display modes
 */

export type AvatarDisplayStyle = 'CIRCULAR' | 'RECTANGULAR'

export interface AvatarStyleConfig {
  wrapperClass: string
  imageClass: string
  fallbackClass: string
}

/**
 * Avatar sizes used throughout the app
 */
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/**
 * Get avatar styling classes based on display mode and size
 */
export function getAvatarClasses(
  style: AvatarDisplayStyle,
  size: AvatarSize = 'md'
): AvatarStyleConfig {
  const sizeConfigs: Record<AvatarSize, { w: string; h: string; textSize: string }> = {
    xs: { w: 'w-8', h: 'h-8', textSize: 'text-xs' },
    sm: { w: 'w-10', h: 'h-10', textSize: 'text-sm' },
    md: { w: 'w-12', h: 'h-12', textSize: 'text-lg' },
    lg: { w: 'w-20', h: 'h-20', textSize: 'text-3xl' },
    xl: { w: 'w-32', h: 'h-32', textSize: 'text-5xl' },
  }

  const config = sizeConfigs[size]

  if (style === 'CIRCULAR') {
    return {
      wrapperClass: `${config.w} ${config.h} rounded-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center flex-shrink-0`,
      imageClass: `${config.w} ${config.h} rounded-full object-cover`,
      fallbackClass: `${config.textSize} font-bold text-gray-600 dark:text-gray-300`,
    }
  } else {
    // RECTANGULAR: 4:5 aspect ratio (width:height = 4:5)
    // Compute height based on width
    const heightMap: Record<AvatarSize, string> = {
      xs: 'h-10', // 8 * 1.25 = 10
      sm: 'h-12', // 10 * 1.25 = 12.5 ≈ 12
      md: 'h-15', // 12 * 1.25 = 15
      lg: 'h-25', // 20 * 1.25 = 25
      xl: 'h-40', // 32 * 1.25 = 40
    }

    return {
      wrapperClass: `${config.w} ${heightMap[size]} bg-gray-300 dark:bg-slate-700 flex items-center justify-center flex-shrink-0`,
      imageClass: `${config.w} ${heightMap[size]} object-cover`,
      fallbackClass: `${config.textSize} font-bold text-gray-600 dark:text-gray-300`,
    }
  }
}

/**
 * Apply aspect ratio style for rectangular avatars
 */
export function getAvatarAspectRatioStyle(style: AvatarDisplayStyle) {
  return style === 'RECTANGULAR' ? { aspectRatio: '4 / 5' } : undefined
}

/**
 * Get Tailwind classes for avatar container margin
 */
export function getAvatarMarginClass(position: 'left' | 'right' | 'none' = 'right'): string {
  switch (position) {
    case 'left':
      return 'ml-3'
    case 'right':
      return 'mr-3'
    case 'none':
      return ''
    default:
      return 'mr-3'
  }
}
