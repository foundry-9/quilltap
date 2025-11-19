'use client';

/**
 * ImageUploadDialog Component
 * Dialog for uploading images or importing from URL
 */

import { useState, useRef, FormEvent } from 'react';

interface ImageUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  contextType?: 'CHARACTER' | 'PERSONA' | 'CHAT';
  contextId?: string;
}

export function ImageUploadDialog({ isOpen, onClose, onSuccess, contextType, contextId }: ImageUploadDialogProps) {
  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setUploading(true);

    try {
      if (uploadMode === 'file') {
        if (!selectedFile) {
          throw new Error('Please select a file');
        }

        const formData = new FormData();
        formData.append('file', selectedFile);

        // Add tags if context is provided
        if (contextType && contextId) {
          formData.append('tags', JSON.stringify([{ tagType: contextType, tagId: contextId }]));
        }

        const response = await fetch('/api/images', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to upload image');
        }
      } else {
        // URL import
        if (!imageUrl) {
          throw new Error('Please enter a URL');
        }

        const tags = contextType && contextId ? [{ tagType: contextType, tagId: contextId }] : undefined;

        const response = await fetch('/api/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: imageUrl, tags }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to import image');
        }
      }

      // Success
      handleClose();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload/import image');
    } finally {
      setUploading(false);
    }
  }

  function handleClose() {
    setSelectedFile(null);
    setImageUrl('');
    setError(null);
    setUploadMode('file');
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Import Image</h2>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            {/* Upload Mode Toggle */}
            <div className="flex space-x-2 border-b border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setUploadMode('file')}
                className={`px-4 py-2 font-medium transition-colors ${
                  uploadMode === 'file'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Upload File
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('url')}
                className={`px-4 py-2 font-medium transition-colors ${
                  uploadMode === 'url'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Import from URL
              </button>
            </div>

            {/* File Upload */}
            {uploadMode === 'file' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Select Image File
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-900 dark:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer bg-gray-50 dark:bg-gray-700 focus:outline-none"
                />
                {selectedFile && (
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                    Selected: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
                  </p>
                )}
              </div>
            )}

            {/* URL Import */}
            {uploadMode === 'url' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Image URL</label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {/* Context Info */}
            {contextType && contextId && (
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  This image will be automatically tagged with this {contextType.toLowerCase()}.
                </p>
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
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={uploading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || (uploadMode === 'file' && !selectedFile) || (uploadMode === 'url' && !imageUrl)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : uploadMode === 'file' ? 'Upload' : 'Import'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
