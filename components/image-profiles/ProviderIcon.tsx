'use client'

import { useMemo } from 'react'

/**
 * Icon data structure that can be provided by plugins
 */
export interface PluginIconData {
  /** Raw SVG string (complete <svg> element) */
  svg?: string
  /** SVG viewBox attribute */
  viewBox?: string
  /** SVG path elements */
  paths?: Array<{
    d: string
    fill?: string
    stroke?: string
    strokeWidth?: string
    opacity?: string
    fillRule?: 'nonzero' | 'evenodd'
  }>
  /** SVG circle elements */
  circles?: Array<{
    cx: string | number
    cy: string | number
    r: string | number
    fill?: string
    stroke?: string
    strokeWidth?: string
    opacity?: string
  }>
  /** SVG text element */
  text?: {
    content: string
    x?: string
    y?: string
    fontSize?: string
    fontWeight?: string
    fill?: string
  }
}

interface ProviderIconProps {
  provider: string
  className?: string
  /** Custom icon data from plugin (optional) */
  iconData?: PluginIconData
  /** Override abbreviation (optional) */
  abbreviation?: string
  /** Override color class (optional) */
  colorClass?: string
}

// Provider-specific defaults (used when no custom icon data provided)
const PROVIDER_DEFAULTS: Record<string, { color: string; abbrev: string }> = {
  OPENAI: { color: 'qt-text-success', abbrev: 'OAI' },
  GROK: { color: 'qt-text-primary', abbrev: 'XAI' },
  GOOGLE_IMAGEN: { color: 'qt-text-info', abbrev: 'GGL' },
  GOOGLE: { color: 'qt-text-info', abbrev: 'GGL' },
  OPENROUTER: { color: 'qt-text-warning', abbrev: 'OR' },
  Z_AI: { color: 'qt-text-success', abbrev: 'ZAI' },
  ETERNAL_AI: { color: 'qt-text-primary', abbrev: 'EAI' },
  ANTHROPIC: { color: 'qt-text-warning', abbrev: 'ANT' },
  OLLAMA: { color: 'qt-text-secondary', abbrev: 'OLL' },
  OPENAI_COMPATIBLE: { color: 'qt-text-secondary', abbrev: 'OAC' },
}

/**
 * Renders a custom SVG icon from plugin icon data
 */
function CustomIcon({ iconData, className, colorClass }: {
  iconData: PluginIconData
  className: string
  colorClass: string
}) {
  // If raw SVG string is provided, render it directly
  if (iconData.svg) {
    // Parse the SVG and inject className
    // Note: dangerouslySetInnerHTML is safe here as we control the plugin source
    return (
      <span
        className={`${colorClass} ${className} inline-block`}
        dangerouslySetInnerHTML={{ __html: iconData.svg }}
      />
    )
  }

  // If structured data is provided, build the SVG
  if (iconData.viewBox && (iconData.paths || iconData.circles || iconData.text)) {
    return (
      <svg
        className={`${colorClass} ${className}`}
        viewBox={iconData.viewBox}
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
      >
        {iconData.circles?.map((circle, i) => (
          <circle
            key={`circle-${i}`}
            cx={circle.cx}
            cy={circle.cy}
            r={circle.r}
            fill={circle.fill}
            stroke={circle.stroke}
            strokeWidth={circle.strokeWidth}
            opacity={circle.opacity}
          />
        ))}
        {iconData.paths?.map((path, i) => (
          <path
            key={`path-${i}`}
            d={path.d}
            fill={path.fill}
            stroke={path.stroke}
            strokeWidth={path.strokeWidth}
            opacity={path.opacity}
            fillRule={path.fillRule}
          />
        ))}
        {iconData.text && (
          <text
            x={iconData.text.x || '50%'}
            y={iconData.text.y || '50%'}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={iconData.text.fill || 'white'}
            fontSize={iconData.text.fontSize || '10'}
            fontWeight={iconData.text.fontWeight || 'bold'}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {iconData.text.content}
          </text>
        )}
      </svg>
    )
  }

  return null
}

/**
 * Default circle icon with abbreviation text
 */
function DefaultIcon({ abbreviation, className, colorClass }: {
  abbreviation: string
  className: string
  colorClass: string
}) {
  return (
    <svg
      className={`${colorClass} ${className}`}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="12" />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="middle"
        fill="white"
        fontSize={abbreviation.length > 3 ? '9' : '10'}
        fontWeight="bold"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        {abbreviation}
      </text>
    </svg>
  )
}

export function ProviderIcon({
  provider,
  className = 'h-5 w-5',
  iconData,
  abbreviation,
  colorClass,
}: ProviderIconProps) {
  const defaults = PROVIDER_DEFAULTS[provider] || {
    color: 'qt-text-secondary',
    abbrev: provider.slice(0, 3).toUpperCase()
  }

  const finalColorClass = colorClass || defaults.color
  const finalAbbreviation = abbreviation || defaults.abbrev

  // If custom icon data is provided, try to render it
  if (iconData) {
    const customIcon = (
      <CustomIcon
        iconData={iconData}
        className={className}
        colorClass={finalColorClass}
      />
    )
    if (customIcon) {
      return customIcon
    }
  }

  // Fall back to default circle + abbreviation icon
  return (
    <DefaultIcon
      abbreviation={finalAbbreviation}
      className={className}
      colorClass={finalColorClass}
    />
  )
}

// Provider badge colors and labels
const PROVIDER_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  OPENAI: { bg: 'qt-bg-success/10', text: 'qt-text-success', label: 'OpenAI' },
  GROK: { bg: 'qt-bg-primary/10', text: 'text-primary', label: 'Grok' },
  GOOGLE_IMAGEN: { bg: 'qt-bg-info/10', text: 'qt-text-info', label: 'Google Imagen' },
  GOOGLE: { bg: 'qt-bg-info/10', text: 'qt-text-info', label: 'Google' },
  OPENROUTER: { bg: 'qt-bg-warning/10', text: 'qt-text-warning', label: 'OpenRouter' },
  Z_AI: { bg: 'qt-bg-success/10', text: 'qt-text-success', label: 'Z.AI' },
  ETERNAL_AI: { bg: 'qt-bg-primary/10', text: 'text-primary', label: 'Eternal AI' },
  ANTHROPIC: { bg: 'qt-bg-warning/10', text: 'qt-text-warning', label: 'Anthropic' },
  OLLAMA: { bg: 'qt-bg-muted', text: 'qt-text-secondary', label: 'Ollama' },
  OPENAI_COMPATIBLE: { bg: 'qt-bg-muted', text: 'qt-text-secondary', label: 'OpenAI Compatible' },
}

export function ProviderBadge({
  provider,
  iconData,
  label,
}: {
  provider: string
  iconData?: PluginIconData
  label?: string
}) {
  const badge = PROVIDER_BADGES[provider] || { bg: 'qt-bg-muted', text: 'qt-text-secondary', label: provider }
  const finalLabel = label || badge.label

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full qt-text-label-xs ${badge.bg} ${badge.text}`}>
      <ProviderIcon provider={provider} className="h-3 w-3" iconData={iconData} />
      {finalLabel}
    </span>
  )
}
