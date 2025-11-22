'use client'

interface ProviderIconProps {
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  className?: string
}

export function ProviderIcon({ provider, className = 'h-5 w-5' }: ProviderIconProps) {
  switch (provider) {
    case 'OPENAI':
      return (
        <svg
          className={`text-green-600 ${className}`}
          fill="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M12 0c6.627 0 12 5.373 12 12s-5.373 12-12 12S0 18.627 0 12 5.373 0 12 0z" />
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="14" fontWeight="bold">
            OAI
          </text>
        </svg>
      )

    case 'GROK':
      return (
        <svg
          className={`text-purple-600 ${className}`}
          fill="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="12" />
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="12" fontWeight="bold">
            XAI
          </text>
        </svg>
      )

    case 'GOOGLE_IMAGEN':
      return (
        <svg
          className={`text-blue-600 ${className}`}
          fill="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="12" />
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="10" fontWeight="bold">
            GGL
          </text>
        </svg>
      )

    default:
      return null
  }
}

export function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    OPENAI: { bg: 'bg-green-100', text: 'text-green-800' },
    GROK: { bg: 'bg-purple-100', text: 'text-purple-800' },
    GOOGLE_IMAGEN: { bg: 'bg-blue-100', text: 'text-blue-800' },
  }

  const labels: Record<string, string> = {
    OPENAI: 'OpenAI',
    GROK: 'Grok',
    GOOGLE_IMAGEN: 'Google Imagen',
  }

  const color = colors[provider] || { bg: 'bg-gray-100', text: 'text-gray-800' }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${color.bg} ${color.text}`}>
      <ProviderIcon provider={provider as any} className="h-3 w-3" />
      {labels[provider] || provider}
    </span>
  )
}
