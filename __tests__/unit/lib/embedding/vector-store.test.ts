/**
 * Vector Store Unit Tests
 */

import { CharacterVectorStore, VectorStoreManager, getVectorStoreManager } from '@/lib/embedding/vector-store'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

describe('CharacterVectorStore', () => {
  let tempDir: string
  let store: CharacterVectorStore

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-store-test-'))
    store = new CharacterVectorStore('test-character', tempDir)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('addVector', () => {
    it('should add a vector to the store', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4]
      await store.addVector('memory-1', embedding, {
        memoryId: 'memory-1',
        characterId: 'test-character',
        content: 'Test memory',
      })

      expect(store.size).toBe(1)
      expect(store.hasVector('memory-1')).toBe(true)
    })

    it('should set dimensions from first vector', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4]
      await store.addVector('memory-1', embedding, {
        memoryId: 'memory-1',
        characterId: 'test-character',
      })

      expect(store.getDimensions()).toBe(4)
    })

    it('should reject vectors with mismatched dimensions', async () => {
      const embedding1 = [0.1, 0.2, 0.3, 0.4]
      const embedding2 = [0.1, 0.2, 0.3] // Different dimensions

      await store.addVector('memory-1', embedding1, {
        memoryId: 'memory-1',
        characterId: 'test-character',
      })

      await expect(
        store.addVector('memory-2', embedding2, {
          memoryId: 'memory-2',
          characterId: 'test-character',
        })
      ).rejects.toThrow('Vector dimension mismatch')
    })
  })

  describe('removeVector', () => {
    it('should remove a vector from the store', async () => {
      await store.addVector('memory-1', [0.1, 0.2, 0.3], {
        memoryId: 'memory-1',
        characterId: 'test-character',
      })

      const removed = await store.removeVector('memory-1')

      expect(removed).toBe(true)
      expect(store.size).toBe(0)
      expect(store.hasVector('memory-1')).toBe(false)
    })

    it('should return false if vector not found', async () => {
      const removed = await store.removeVector('non-existent')
      expect(removed).toBe(false)
    })
  })

  describe('updateVector', () => {
    it('should update an existing vector', async () => {
      await store.addVector('memory-1', [0.1, 0.2, 0.3], {
        memoryId: 'memory-1',
        characterId: 'test-character',
      })

      const updated = await store.updateVector('memory-1', [0.4, 0.5, 0.6])

      expect(updated).toBe(true)
    })

    it('should return false if vector not found', async () => {
      const updated = await store.updateVector('non-existent', [0.1, 0.2, 0.3])
      expect(updated).toBe(false)
    })
  })

  describe('search', () => {
    beforeEach(async () => {
      // Add some vectors with different similarities
      // Vector close to [1, 0, 0]
      await store.addVector('memory-1', [0.9, 0.1, 0.0], {
        memoryId: 'memory-1',
        characterId: 'test-character',
        content: 'First memory',
      })
      // Vector close to [0, 1, 0]
      await store.addVector('memory-2', [0.1, 0.9, 0.0], {
        memoryId: 'memory-2',
        characterId: 'test-character',
        content: 'Second memory',
      })
      // Vector close to [0, 0, 1]
      await store.addVector('memory-3', [0.0, 0.1, 0.9], {
        memoryId: 'memory-3',
        characterId: 'test-character',
        content: 'Third memory',
      })
    })

    it('should find most similar vectors', () => {
      const results = store.search([1.0, 0.0, 0.0], 3)

      expect(results.length).toBe(3)
      expect(results[0].id).toBe('memory-1') // Most similar
      expect(results[0].score).toBeGreaterThan(results[1].score)
    })

    it('should respect limit parameter', () => {
      const results = store.search([1.0, 0.0, 0.0], 1)
      expect(results.length).toBe(1)
    })

    it('should apply filter function', () => {
      const results = store.search(
        [1.0, 0.0, 0.0],
        3,
        metadata => metadata.content === 'Second memory'
      )

      expect(results.length).toBe(1)
      expect(results[0].id).toBe('memory-2')
    })

    it('should return empty array for empty store', () => {
      const emptyStore = new CharacterVectorStore('empty', tempDir)
      const results = emptyStore.search([1.0, 0.0, 0.0], 10)
      expect(results).toEqual([])
    })
  })

  describe('save and load', () => {
    it('should persist vectors to disk', async () => {
      await store.addVector('memory-1', [0.1, 0.2, 0.3], {
        memoryId: 'memory-1',
        characterId: 'test-character',
      })

      await store.save()

      // Create new store and load
      const newStore = new CharacterVectorStore('test-character', tempDir)
      await newStore.load()

      expect(newStore.size).toBe(1)
      expect(newStore.hasVector('memory-1')).toBe(true)
      expect(newStore.getDimensions()).toBe(3)
    })

    it('should handle loading from non-existent file', async () => {
      const newStore = new CharacterVectorStore('non-existent', tempDir)
      await newStore.load()

      expect(newStore.size).toBe(0)
      expect(newStore.getDimensions()).toBeNull()
    })
  })

  describe('clear', () => {
    it('should remove all entries', async () => {
      await store.addVector('memory-1', [0.1, 0.2, 0.3], {
        memoryId: 'memory-1',
        characterId: 'test-character',
      })
      await store.addVector('memory-2', [0.4, 0.5, 0.6], {
        memoryId: 'memory-2',
        characterId: 'test-character',
      })

      store.clear()

      expect(store.size).toBe(0)
      expect(store.getDimensions()).toBeNull()
    })
  })
})

describe('VectorStoreManager', () => {
  let tempDir: string
  let manager: VectorStoreManager

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-manager-test-'))
    manager = new VectorStoreManager(tempDir)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('getStore', () => {
    it('should create and cache store for character', async () => {
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-1')

      expect(store1).toBe(store2) // Same instance
    })

    it('should create separate stores for different characters', async () => {
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-2')

      expect(store1).not.toBe(store2)
    })
  })

  describe('saveAll', () => {
    it('should save all dirty stores', async () => {
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-2')

      await store1.addVector('m1', [0.1, 0.2], { memoryId: 'm1', characterId: 'char-1' })
      await store2.addVector('m2', [0.3, 0.4], { memoryId: 'm2', characterId: 'char-2' })

      await manager.saveAll()

      // Verify files exist
      const files = await fs.readdir(tempDir)
      expect(files).toContain('char-1.json')
      expect(files).toContain('char-2.json')
    })
  })

  describe('deleteStore', () => {
    it('should delete store from cache and disk', async () => {
      const store = await manager.getStore('char-1')
      await store.addVector('m1', [0.1, 0.2], { memoryId: 'm1', characterId: 'char-1' })
      await store.save()

      const deleted = await manager.deleteStore('char-1')

      expect(deleted).toBe(true)

      // Verify file is gone
      const files = await fs.readdir(tempDir)
      expect(files).not.toContain('char-1.json')
    })

    it('should return false if store does not exist on disk', async () => {
      const deleted = await manager.deleteStore('non-existent')
      expect(deleted).toBe(false)
    })
  })

  describe('getStats', () => {
    it('should return correct stats', async () => {
      const store1 = await manager.getStore('char-1')
      const store2 = await manager.getStore('char-2')

      await store1.addVector('m1', [0.1, 0.2], { memoryId: 'm1', characterId: 'char-1' })
      await store1.addVector('m2', [0.3, 0.4], { memoryId: 'm2', characterId: 'char-1' })
      await store2.addVector('m3', [0.5, 0.6], { memoryId: 'm3', characterId: 'char-2' })

      const stats = manager.getStats()

      expect(stats.loadedStores).toBe(2)
      expect(stats.totalVectors).toBe(3)
    })
  })
})
