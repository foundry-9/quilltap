'use client';

/**
 * AvatarSelector Component
 * Allows selecting an image from the gallery to use as an avatar
 */

import { useState } from 'react';
import { ImageGallery, ImageData } from './image-gallery';
import { ImageUploadDialog } from './image-upload-dialog';

interface AvatarSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (imageId: string) => void;
  currentImageId?: string;
  contextType?: 'CHARACTER' | 'PERSONA' | 'CHAT';
  contextId?: string;
}

export function AvatarSelector({
  isOpen,
  onClose,
  onSelect,
  currentImageId,
  contextType,
  contextId,
}: AvatarSelectorProps) {
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>(currentImageId);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);

  if (!isOpen) return null;

  function handleSelectImage(image: ImageData) {
    setSelectedImageId(image.id);
  }

  function handleConfirm() {
    if (selectedImageId) {
      onSelect(selectedImageId);
      onClose();
    }
  }

  function handleUploadSuccess() {
    // Reload gallery by changing key
    setGalleryKey((prev) => prev + 1);
  }

  function handleClose() {
    setSelectedImageId(currentImageId);
    onClose();
  }

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={handleClose}>
        <div
          className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Select Avatar</h2>
            <button
              onClick={() => setShowUploadDialog(true)}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Import Image
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-4 flex-1 overflow-y-auto">
            <ImageGallery
              key={galleryKey}
              tagType={contextType}
              tagId={contextId}
              onSelectImage={handleSelectImage}
              selectedImageId={selectedImageId}
            />
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <button
              onClick={() => {
                setSelectedImageId(undefined);
                onSelect('');
                onClose();
              }}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
            >
              Clear Avatar
            </button>
            <div className="flex space-x-3">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!selectedImageId}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Set as Avatar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Upload Dialog */}
      <ImageUploadDialog
        isOpen={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        onSuccess={handleUploadSuccess}
        contextType={contextType}
        contextId={contextId}
      />
    </>
  );
}
