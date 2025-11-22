'use client';

/**
 * ImageGenerationDialog Component
 * Phase 5: UI Integration for Image Generation
 *
 * Dialog for generating images using configured LLM providers
 * Supports different generation options based on selected provider
 */

import { useState, useEffect, FormEvent } from 'react';

interface GenerationOption {
  n?: number;
  size?: string;
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  aspectRatio?: string;
}

interface ImageGenerationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  contextType?: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME';
  contextId?: string;
}

interface ConnectionProfile {
  id: string;
  name: string;
  provider: string;
  modelName: string;
}

type PreviewImage = {
  id: string;
  data: string;
  mimeType: string;
  revisedPrompt?: string;
};

const OPENAI_SIZES = ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'];
const DEFAULT_SIZES = ['1024x1024', '512x512'];

export function ImageGenerationDialog({
  isOpen,
  onClose,
  onSuccess,
  contextType,
  contextId
}: ImageGenerationDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewImages, setPreviewImages] = useState<PreviewImage[]>([]);

  // Generation options
  const [options, setOptions] = useState<GenerationOption>({
    n: 1,
    size: '1024x1024',
    quality: 'standard',
    style: 'vivid',
  });

  // Load image-capable profiles on open
  useEffect(() => {
    if (isOpen) {
      loadProfiles();
    }
  }, [isOpen]);

  async function loadProfiles() {
    setLoadingProfiles(true);
    setError(null);
    try {
      const response = await fetch('/api/profiles?imageCapable=true');
      if (!response.ok) {
        throw new Error('Failed to load profiles');
      }
      const data = await response.json();
      setProfiles(data.profiles || []);
      if (data.profiles && data.profiles.length > 0) {
        setSelectedProfileId(data.profiles[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profiles');
      setProfiles([]);
    } finally {
      setLoadingProfiles(false);
    }
  }

  const selectedProfile = profiles.find(p => p.id === selectedProfileId);
  const isOpenAI = selectedProfile?.provider === 'OPENAI';
  const isGemini = selectedProfile?.provider === 'GOOGLE';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setGenerating(true);
    setPreviewImages([]);

    try {
      if (!prompt.trim()) {
        throw new Error('Please enter a prompt');
      }

      if (!selectedProfileId) {
        throw new Error('Please select a provider');
      }

      const requestBody: any = {
        prompt: prompt.trim(),
        profileId: selectedProfileId,
        options: {},
      };

      // Add tags if context is provided
      if (contextType && contextId) {
        requestBody.tags = [{ tagType: contextType, tagId: contextId }];
      }

      // Add generation options
      if (options.n && options.n > 1) {
        requestBody.options.n = options.n;
      }
      if (options.size) {
        requestBody.options.size = options.size;
      }
      if (isOpenAI && options.quality) {
        requestBody.options.quality = options.quality;
      }
      if (isOpenAI && options.style) {
        requestBody.options.style = options.style;
      }
      if (isGemini && options.aspectRatio) {
        requestBody.options.aspectRatio = options.aspectRatio;
      }

      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate images');
      }

      // Show preview of generated images
      const previews: PreviewImage[] = data.data.map((img: any, idx: number) => ({
        id: img.id || `preview-${idx}`,
        data: img.url || '',
        mimeType: img.mimeType,
        revisedPrompt: img.revisedPrompt,
      }));

      setPreviewImages(previews);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate images');
    } finally {
      setGenerating(false);
    }
  }

  function handleConfirm() {
    handleClose();
    onSuccess?.();
  }

  function handleClose() {
    setPrompt('');
    setSelectedProfileId('');
    setError(null);
    setPreviewImages([]);
    setOptions({
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      style: 'vivid',
    });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Generate Image</h2>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-6">
            {/* Provider Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Provider
              </label>
              {loadingProfiles ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Loading providers...</div>
              ) : profiles.length === 0 ? (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-3">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    No image-capable providers configured. Please set up OpenAI, Google, Grok, or OpenRouter in your connection profiles.
                  </p>
                </div>
              ) : (
                <select
                  value={selectedProfileId}
                  onChange={(e) => setSelectedProfileId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} ({profile.modelName})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Prompt Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate..."
                rows={4}
                maxLength={4000}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {prompt.length}/4000 characters
              </p>
            </div>

            {/* Generation Options */}
            {selectedProfile && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Generation Options</h3>

                {/* Number of Images */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Number of Images
                    </label>
                    <select
                      value={options.n || 1}
                      onChange={(e) => setOptions({ ...options, n: Number.parseInt(e.target.value) })}
                      className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Image Size */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Size
                    </label>
                    <select
                      value={options.size || '1024x1024'}
                      onChange={(e) => setOptions({ ...options, size: e.target.value })}
                      className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {(isOpenAI ? OPENAI_SIZES : DEFAULT_SIZES).map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* OpenAI Specific Options */}
                {isOpenAI && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Quality
                      </label>
                      <select
                        value={options.quality || 'standard'}
                        onChange={(e) => setOptions({ ...options, quality: e.target.value as any })}
                        className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="standard">Standard</option>
                        <option value="hd">HD</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Style
                      </label>
                      <select
                        value={options.style || 'vivid'}
                        onChange={(e) => setOptions({ ...options, style: e.target.value as any })}
                        className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="vivid">Vivid</option>
                        <option value="natural">Natural</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Gemini Specific Options */}
                {isGemini && (
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Aspect Ratio
                    </label>
                    <select
                      value={options.aspectRatio || ''}
                      onChange={(e) => setOptions({ ...options, aspectRatio: e.target.value || undefined })}
                      className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Default</option>
                      <option value="16:9">16:9 (Landscape)</option>
                      <option value="4:3">4:3 (Landscape)</option>
                      <option value="1:1">1:1 (Square)</option>
                      <option value="3:4">3:4 (Portrait)</option>
                      <option value="9:16">9:16 (Portrait)</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Context Info */}
            {contextType && contextId && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Generated images will be automatically tagged with this {contextType.toLowerCase()}.
                </p>
              </div>
            )}

            {/* Preview Images */}
            {previewImages.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Generated Images</h3>
                <div className="grid grid-cols-2 gap-3">
                  {previewImages.map((img) => (
                    <div key={img.id} className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.data}
                        alt="Generated"
                        className="w-full h-48 object-cover bg-gray-100 dark:bg-gray-700"
                      />
                      {img.revisedPrompt && (
                        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border-t border-gray-300 dark:border-gray-600">
                          <p className="text-xs text-gray-600 dark:text-gray-400">
                            <span className="font-semibold">Revised:</span> {img.revisedPrompt}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3 sticky bottom-0">
            <button
              type="button"
              onClick={handleClose}
              disabled={generating}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Cancel
            </button>
            {previewImages.length > 0 ? (
              <button
                type="button"
                onClick={handleConfirm}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                Done
              </button>
            ) : (
              <button
                type="submit"
                disabled={generating || !selectedProfileId || profiles.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
