'use client';

/**
 * ImageGallery Component
 * Displays a grid of images with optional filtering and selection
 */

import { useState, useEffect } from 'react';
import Image from 'next/image';

export interface ImageData {
  id: string;
  filename: string;
  filepath: string;
  url?: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  tags?: Array<{
    id: string;
    tagType: string;
    tagId: string;
  }>;
}

interface ImageGalleryProps {
  tagType?: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME';
  tagId?: string;
  onSelectImage?: (image: ImageData) => void;
  selectedImageId?: string;
  className?: string;
}

export function ImageGallery({ tagType, tagId, onSelectImage, selectedImageId, className = '' }: ImageGalleryProps) {
  const [images, setImages] = useState<ImageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadImages();
  }, [tagType, tagId]);

  async function loadImages() {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (tagType) params.append('tagType', tagType);
      if (tagId) params.append('tagId', tagId);

      const response = await fetch(`/api/images?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load images');
      }

      setImages(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load images');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteImage(imageId: string) {
    if (!confirm('Are you sure you want to delete this image?')) {
      return;
    }

    try {
      const response = await fetch(`/api/images/${imageId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete image');
      }

      // Reload images
      loadImages();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete image');
    }
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="text-gray-500 dark:text-gray-400">Loading images...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <div className="text-gray-500 dark:text-gray-400">No images found</div>
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 ${className}`}>
      {images.map((image) => (
        <div
          key={image.id}
          className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
            selectedImageId === image.id
              ? 'border-blue-500 ring-2 ring-blue-500 ring-opacity-50'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          } ${onSelectImage ? 'cursor-pointer' : ''}`}
          onClick={() => onSelectImage?.(image)}
        >
          <div className="aspect-square relative bg-gray-100 dark:bg-gray-800">
            <Image
              src={image.url || `/${image.filepath}`}
              alt={image.filename}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
            />
          </div>

          {/* Overlay with actions */}
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteImage(image.id);
              }}
              className="bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
          </div>

          {/* Selected indicator */}
          {selectedImageId === image.id && (
            <div className="absolute top-2 right-2 bg-blue-500 text-white rounded-full p-1">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
