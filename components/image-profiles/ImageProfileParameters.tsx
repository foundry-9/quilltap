'use client'

interface ImageProfileParametersProps {
  provider: 'OPENAI' | 'GROK' | 'GOOGLE_IMAGEN'
  parameters: Record<string, any>
  onChange: (params: Record<string, any>) => void
}

export function ImageProfileParameters({
  provider,
  parameters,
  onChange,
}: ImageProfileParametersProps) {
  const handleChange = (key: string, value: any) => {
    onChange({
      ...parameters,
      [key]: value,
    })
  }

  const handleRemove = (key: string) => {
    const newParams = { ...parameters }
    delete newParams[key]
    onChange(newParams)
  }

  switch (provider) {
    case 'OPENAI':
      return (
        <div className="space-y-4 border-t border-gray-200 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">Image Parameters (Optional)</h3>

          {/* Quality */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Quality
            </label>
            <select
              value={parameters.quality || 'standard'}
              onChange={e => handleChange('quality', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            >
              <option value="standard">Standard</option>
              <option value="hd">HD (Higher detail and consistency)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">HD quality produces finer details</p>
          </div>

          {/* Style */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Style
            </label>
            <select
              value={parameters.style || 'vivid'}
              onChange={e => handleChange('style', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            >
              <option value="vivid">Vivid (Dramatic, hyper-real)</option>
              <option value="natural">Natural (Realistic, less exaggerated)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Controls the aesthetic style of generated images</p>
          </div>

          {/* Size */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Size
            </label>
            <select
              value={parameters.size || '1024x1024'}
              onChange={e => handleChange('size', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            >
              <option value="1024x1024">Square (1024x1024)</option>
              <option value="1792x1024">Landscape (1792x1024)</option>
              <option value="1024x1792">Portrait (1024x1792)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Default image dimensions for generation</p>
          </div>
        </div>
      )

    case 'GOOGLE_IMAGEN':
      return (
        <div className="space-y-4 border-t border-gray-200 dark:border-slate-700 pt-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">Image Parameters (Optional)</h3>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Aspect Ratio
            </label>
            <select
              value={parameters.aspectRatio || '1:1'}
              onChange={e => handleChange('aspectRatio', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Standard (4:3)</option>
              <option value="3:2">Photo (3:2)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Default aspect ratio for image generation</p>
          </div>

          {/* Negative Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Default Negative Prompt
            </label>
            <textarea
              value={parameters.negativePrompt || ''}
              onChange={e => handleChange('negativePrompt', e.target.value)}
              placeholder="e.g., blurry, low quality, distorted"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              rows={2}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Things to avoid in generated images</p>
          </div>
        </div>
      )

    case 'GROK':
      return (
        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Grok supports basic text-to-image generation with minimal parameters.
            Configuration is handled through the main prompt.
          </p>
        </div>
      )

    default:
      return null
  }
}
