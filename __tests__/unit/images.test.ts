/**
 * Unit tests for image utility functions
 */

import {
  validateImageFile,
  uploadImage,
  importImageFromUrl,
  deleteImage,
  type ImageUploadResult,
} from '@/lib/images'
import { writeFile, mkdir, unlink } from 'fs/promises'
import { join } from 'path'

// Mock the file system modules
jest.mock('fs/promises')

// Mock node-fetch as an ESM module
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}))

// Import fetch after mocking
import fetch from 'node-fetch'

const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>
const mockFetch = fetch as unknown as jest.MockedFunction<typeof fetch>

describe('Image Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('validateImageFile', () => {
    it('should accept valid image types', () => {
      const validTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/avif',
        'image/svg+xml',
      ]

      validTypes.forEach(type => {
        const file = new File(['test'], 'test.jpg', { type })
        expect(() => validateImageFile(file)).not.toThrow()
      })
    })

    it('should reject invalid file types', () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' })
      expect(() => validateImageFile(file)).toThrow('Invalid file type')
    })

    it('should reject files exceeding max size (10MB)', () => {
      // Create a file that's 11MB
      const largeSize = 11 * 1024 * 1024
      const file = new File(['x'.repeat(largeSize)], 'large.jpg', { type: 'image/jpeg' })

      // Mock the size property
      Object.defineProperty(file, 'size', { value: largeSize })

      expect(() => validateImageFile(file)).toThrow('File size exceeds maximum')
    })

    it('should accept files within size limit', () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
      Object.defineProperty(file, 'size', { value: 1024 * 1024 }) // 1MB

      expect(() => validateImageFile(file)).not.toThrow()
    })
  })

  describe('uploadImage', () => {
    beforeEach(() => {
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)
    })

    it('should upload a valid image file', async () => {
      const file = new File(['test content'], 'test.jpg', { type: 'image/jpeg' })
      Object.defineProperty(file, 'size', { value: 1024 })

      // Mock arrayBuffer
      file.arrayBuffer = jest.fn().mockResolvedValue(Buffer.from('test content'))

      const userId = 'user123'
      const result = await uploadImage(file, userId)

      expect(result).toHaveProperty('filename')
      expect(result).toHaveProperty('filepath')
      expect(result).toHaveProperty('mimeType', 'image/jpeg')
      expect(result).toHaveProperty('size', 1024)
      expect(result.filename).toContain(userId)
      expect(result.filename).toContain('.jpg')
      expect(result.filepath).toContain('uploads/images')
      expect(result.filepath).toContain(userId)
    })

    it('should create user-specific directory', async () => {
      const file = new File(['test'], 'test.png', { type: 'image/png' })
      Object.defineProperty(file, 'size', { value: 100 })
      file.arrayBuffer = jest.fn().mockResolvedValue(Buffer.from('test'))

      const userId = 'user456'
      await uploadImage(file, userId)

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining(join('public', 'uploads', 'images', userId)),
        { recursive: true }
      )
    })

    it('should write file to correct location', async () => {
      const fileContent = 'test image content'
      const file = new File([fileContent], 'test.webp', { type: 'image/webp' })
      Object.defineProperty(file, 'size', { value: fileContent.length })
      file.arrayBuffer = jest.fn().mockResolvedValue(Buffer.from(fileContent))

      const userId = 'user789'
      await uploadImage(file, userId)

      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining(join('public', 'uploads', 'images', userId)),
        expect.any(Buffer)
      )
    })

    it('should throw error for invalid file', async () => {
      const file = new File(['test'], 'test.txt', { type: 'text/plain' })
      const userId = 'user123'

      await expect(uploadImage(file, userId)).rejects.toThrow('Invalid file type')
    })

    it('should generate unique filenames', async () => {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' })
      Object.defineProperty(file, 'size', { value: 100 })
      file.arrayBuffer = jest.fn().mockResolvedValue(Buffer.from('test'))

      const userId = 'user123'
      const result1 = await uploadImage(file, userId)
      const result2 = await uploadImage(file, userId)

      expect(result1.filename).not.toBe(result2.filename)
    })

    it('should preserve file extension from filename', async () => {
      const extensions = ['jpg', 'png', 'gif', 'webp']

      for (const ext of extensions) {
        const file = new File(['test'], `test.${ext}`, { type: `image/${ext}` })
        Object.defineProperty(file, 'size', { value: 100 })
        file.arrayBuffer = jest.fn().mockResolvedValue(Buffer.from('test'))

        const result = await uploadImage(file, 'user123')
        expect(result.filename).toMatch(new RegExp(`\\.${ext}$`))
      }
    })
  })

  describe('importImageFromUrl', () => {
    beforeEach(() => {
      mockMkdir.mockResolvedValue(undefined)
      mockWriteFile.mockResolvedValue(undefined)
    })

    it('should import image from valid URL', async () => {
      const imageBuffer = Buffer.from('fake image data')
      const mockResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/jpeg'),
        },
        arrayBuffer: jest.fn().mockResolvedValue(imageBuffer),
      }

      mockFetch.mockResolvedValue(mockResponse as any)

      const url = 'https://example.com/image.jpg'
      const userId = 'user123'
      const result = await importImageFromUrl(url, userId)

      expect(result).toHaveProperty('filename')
      expect(result).toHaveProperty('filepath')
      expect(result).toHaveProperty('mimeType', 'image/jpeg')
      expect(result).toHaveProperty('url', url)
      expect(result.size).toBe(imageBuffer.length)
    })

    it('should throw error if fetch fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      } as any)

      const url = 'https://example.com/nonexistent.jpg'
      const userId = 'user123'

      await expect(importImageFromUrl(url, userId)).rejects.toThrow('Failed to fetch image from URL')
    })

    it('should throw error for invalid content type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('text/html'),
        },
      } as any)

      const url = 'https://example.com/page.html'
      const userId = 'user123'

      await expect(importImageFromUrl(url, userId)).rejects.toThrow('Invalid image type from URL')
    })

    it('should throw error if image exceeds size limit', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024) // 11MB
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/jpeg'),
        },
        arrayBuffer: jest.fn().mockResolvedValue(largeBuffer),
      } as any)

      const url = 'https://example.com/large.jpg'
      const userId = 'user123'

      await expect(importImageFromUrl(url, userId)).rejects.toThrow('Image size exceeds maximum')
    })

    it('should create user-specific directory for imported images', async () => {
      const imageBuffer = Buffer.from('image data')
      mockFetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('image/png'),
        },
        arrayBuffer: jest.fn().mockResolvedValue(imageBuffer),
      } as any)

      const userId = 'user999'
      await importImageFromUrl('https://example.com/image.png', userId)

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining(join('public', 'uploads', 'images', userId)),
        { recursive: true }
      )
    })

    it('should extract correct extension from content type', async () => {
      const contentTypes = [
        { type: 'image/jpeg', ext: 'jpeg' },
        { type: 'image/png', ext: 'png' },
        { type: 'image/gif', ext: 'gif' },
        { type: 'image/webp', ext: 'webp' },
      ]

      for (const { type, ext } of contentTypes) {
        mockFetch.mockResolvedValue({
          ok: true,
          headers: {
            get: jest.fn().mockReturnValue(type),
          },
          arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('test')),
        } as any)

        const result = await importImageFromUrl('https://example.com/image', 'user123')
        expect(result.filename).toMatch(new RegExp(`\\.${ext}$`))
      }
    })
  })

  describe('deleteImage', () => {
    it('should delete existing image file', async () => {
      mockUnlink.mockResolvedValue(undefined)

      const filepath = 'uploads/images/user123/test.jpg'
      await deleteImage(filepath)

      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining(join('public', filepath))
      )
    })

    it('should not throw error if file does not exist', async () => {
      const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      mockUnlink.mockRejectedValue(error)

      const filepath = 'uploads/images/user123/nonexistent.jpg'

      await expect(deleteImage(filepath)).resolves.not.toThrow()
    })

    it('should throw error for other file system errors', async () => {
      const error = new Error('EACCES: permission denied') as NodeJS.ErrnoException
      error.code = 'EACCES'
      mockUnlink.mockRejectedValue(error)

      const filepath = 'uploads/images/user123/test.jpg'

      await expect(deleteImage(filepath)).rejects.toThrow('EACCES')
    })
  })
})
