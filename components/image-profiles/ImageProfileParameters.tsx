'use client'

interface ImageProfileParametersProps {
  provider: string
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
        <div className="space-y-4 border-t qt-border-default pt-4">
          <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

          {/* Quality */}
          <div>
            <label className="qt-label mb-1">
              Quality
            </label>
            <select
              value={parameters.quality || 'standard'}
              onChange={e => handleChange('quality', e.target.value)}
              className="qt-select"
            >
              <option value="standard">Standard</option>
              <option value="hd">HD (Higher detail and consistency)</option>
            </select>
            <p className="qt-text-xs mt-1">HD quality produces finer details</p>
          </div>

          {/* Style */}
          <div>
            <label className="qt-label mb-1">
              Style
            </label>
            <select
              value={parameters.style || 'vivid'}
              onChange={e => handleChange('style', e.target.value)}
              className="qt-select"
            >
              <option value="vivid">Vivid (Dramatic, hyper-real)</option>
              <option value="natural">Natural (Realistic, less exaggerated)</option>
            </select>
            <p className="qt-text-xs mt-1">Controls the aesthetic style of generated images</p>
          </div>

          {/* Size */}
          <div>
            <label className="qt-label mb-1">
              Default Size
            </label>
            <select
              value={parameters.size || '1024x1024'}
              onChange={e => handleChange('size', e.target.value)}
              className="qt-select"
            >
              <option value="1024x1024">Square (1024x1024)</option>
              <option value="1792x1024">Landscape (1792x1024)</option>
              <option value="1024x1792">Portrait (1024x1792)</option>
            </select>
            <p className="qt-text-xs mt-1">Default image dimensions for generation</p>
          </div>
        </div>
      )

    case 'GOOGLE':
    case 'GOOGLE_IMAGEN':
      return (
        <div className="space-y-4 border-t qt-border-default pt-4">
          <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

          {/* Aspect Ratio */}
          <div>
            <label className="qt-label mb-1">
              Default Aspect Ratio
            </label>
            <select
              value={parameters.aspectRatio || '1:1'}
              onChange={e => handleChange('aspectRatio', e.target.value)}
              className="qt-select"
            >
              <option value="1:1">Square (1:1)</option>
              <option value="16:9">Landscape (16:9)</option>
              <option value="9:16">Portrait (9:16)</option>
              <option value="4:3">Standard (4:3)</option>
              <option value="3:2">Photo (3:2)</option>
            </select>
            <p className="qt-text-xs mt-1">Default aspect ratio for image generation</p>
          </div>

          {/* Negative Prompt */}
          <div>
            <label className="qt-label mb-1">
              Default Negative Prompt
            </label>
            <textarea
              value={parameters.negativePrompt || ''}
              onChange={e => handleChange('negativePrompt', e.target.value)}
              placeholder="e.g., blurry, low quality, distorted"
              className="qt-textarea"
              rows={2}
            />
            <p className="qt-text-xs mt-1">Things to avoid in generated images</p>
          </div>
        </div>
      )

    case 'Z_AI':
      return (
        <div className="space-y-4 border-t qt-border-default pt-4">
          <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

          {/* Size */}
          <div>
            <label className="qt-label mb-1">
              Default Size
            </label>
            <select
              value={parameters.size || '1024x1024'}
              onChange={e => handleChange('size', e.target.value)}
              className="qt-select"
            >
              <option value="1024x1024">Square (1024x1024)</option>
              <option value="1280x1280">Square (1280x1280)</option>
              <option value="1568x1056">Landscape (1568x1056)</option>
              <option value="1664x928">Wide (1664x928)</option>
              <option value="1472x1104">Landscape (1472x1104)</option>
              <option value="1056x1568">Portrait (1056x1568)</option>
              <option value="928x1664">Tall (928x1664)</option>
              <option value="1104x1472">Portrait (1104x1472)</option>
            </select>
            <p className="qt-text-xs mt-1">Z.AI&apos;s recommended sizes for CogView and GLM-Image</p>
          </div>
        </div>
      )

    case 'NANOGPT':
      return (
        <div className="space-y-4 border-t qt-border-default pt-4">
          <h3 className="text-sm qt-text-primary">Image Parameters (Optional)</h3>

          {/* Size */}
          <div>
            <label className="qt-label mb-1">
              Default Size
            </label>
            <select
              value={parameters.size || '1024x1024'}
              onChange={e => handleChange('size', e.target.value)}
              className="qt-select"
            >
              <option value="1024x1024">Square (1024x1024)</option>
              <option value="1248x832">Landscape (1248x832)</option>
              <option value="1360x768">Wide (1360x768)</option>
              <option value="1536x1024">Landscape (1536x1024)</option>
              <option value="832x1248">Portrait (832x1248)</option>
              <option value="768x1360">Tall (768x1360)</option>
              <option value="1024x1536">Portrait (1024x1536)</option>
            </select>
            <p className="qt-text-xs mt-1">Common sizes across NanoGPT&apos;s image models; each model maps to its nearest native resolution</p>
          </div>
        </div>
      )

    case 'GROK':
      return (
        <div className="border-t qt-border-default pt-4">
          <p className="qt-text-small">
            Grok supports basic text-to-image generation with minimal parameters.
            Configuration is handled through the main prompt.
          </p>
        </div>
      )

    default:
      return null
  }
}
