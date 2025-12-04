/**
 * MongoDB Image Profiles Repository
 *
 * Handles CRUD operations for ImageProfile entities in MongoDB.
 * Provides image profile management with tag support and default profile handling.
 */

import { Collection } from 'mongodb';
import { logger } from '@/lib/logger';
import { ImageProfile, ImageProfileSchema } from '@/lib/json-store/schemas/types';
import { getMongoDatabase } from '../client';

/**
 * MongoDB Image Profiles Repository
 * Implements CRUD operations for image profiles with tag and default profile management
 */
export class MongoImageProfilesRepository {
  private collectionName = 'image_profiles';
  private schema = ImageProfileSchema;

  /**
   * Get the MongoDB collection
   */
  private async getCollection(): Promise<Collection> {
    const db = await getMongoDatabase();
    const collection = db.collection(this.collectionName);

    logger.debug('Retrieved MongoDB image profiles collection', {
      collectionName: this.collectionName,
    });

    return collection;
  }

  /**
   * Validate data against schema
   */
  private validate(data: unknown): ImageProfile {
    return this.schema.parse(data) as ImageProfile;
  }

  /**
   * Safely validate without throwing
   */
  private validateSafe(data: unknown): { success: boolean; data?: ImageProfile; error?: string } {
    try {
      const validated = this.validate(data);
      return { success: true, data: validated };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate UUID v4
   */
  private generateId(): string {
    logger.debug('Generating UUID v4 for image profile');
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Get current ISO timestamp
   */
  private getCurrentTimestamp(): string {
    const timestamp = new Date().toISOString();
    logger.debug('Generated timestamp for image profile', { timestamp });
    return timestamp;
  }

  /**
   * Find an image profile by ID
   */
  async findById(id: string): Promise<ImageProfile | null> {
    const collection = await this.getCollection();

    logger.debug('Finding image profile by ID', {
      profileId: id,
    });

    try {
      const profile = await collection.findOne({ id });

      if (!profile) {
        logger.debug('Image profile not found', {
          profileId: id,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...profileData } = profile as any;

      const validationResult = this.validateSafe(profileData);
      if (!validationResult.success) {
        logger.warn('Image profile validation failed', {
          profileId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Image profile found by ID', {
        profileId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding image profile by ID', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find all image profiles
   */
  async findAll(): Promise<ImageProfile[]> {
    const collection = await this.getCollection();

    logger.debug('Finding all image profiles');

    try {
      const profiles = await collection.find({}).toArray();

      logger.debug('Retrieved all image profiles', {
        count: profiles.length,
      });

      // Map MongoDB documents to ImageProfile objects, removing _id field
      const validatedProfiles: ImageProfile[] = [];
      for (const profile of profiles) {
        const { _id, ...profileData } = profile as any;
        const validationResult = this.validateSafe(profileData);
        if (validationResult.success && validationResult.data) {
          validatedProfiles.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid image profile during findAll', {
            error: validationResult.error,
          });
        }
      }

      return validatedProfiles;
    } catch (error) {
      logger.error('Error finding all image profiles', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find image profiles by user ID
   */
  async findByUserId(userId: string): Promise<ImageProfile[]> {
    const collection = await this.getCollection();

    logger.debug('Finding image profiles by user ID', {
      userId,
    });

    try {
      const profiles = await collection.find({ userId }).toArray();

      logger.debug('Retrieved image profiles by user ID', {
        userId,
        count: profiles.length,
      });

      // Map MongoDB documents to ImageProfile objects, removing _id field
      const validatedProfiles: ImageProfile[] = [];
      for (const profile of profiles) {
        const { _id, ...profileData } = profile as any;
        const validationResult = this.validateSafe(profileData);
        if (validationResult.success && validationResult.data) {
          validatedProfiles.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid image profile during findByUserId', {
            userId,
            error: validationResult.error,
          });
        }
      }

      return validatedProfiles;
    } catch (error) {
      logger.error('Error finding image profiles by user ID', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find image profiles with a specific tag
   */
  async findByTag(tagId: string): Promise<ImageProfile[]> {
    const collection = await this.getCollection();

    logger.debug('Finding image profiles by tag', {
      tagId,
    });

    try {
      const profiles = await collection.find({ tags: tagId }).toArray();

      logger.debug('Retrieved image profiles by tag', {
        tagId,
        count: profiles.length,
      });

      // Map MongoDB documents to ImageProfile objects, removing _id field
      const validatedProfiles: ImageProfile[] = [];
      for (const profile of profiles) {
        const { _id, ...profileData } = profile as any;
        const validationResult = this.validateSafe(profileData);
        if (validationResult.success && validationResult.data) {
          validatedProfiles.push(validationResult.data);
        } else {
          logger.warn('Skipping invalid image profile during findByTag', {
            tagId,
            error: validationResult.error,
          });
        }
      }

      return validatedProfiles;
    } catch (error) {
      logger.error('Error finding image profiles by tag', {
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find the default image profile for a user
   */
  async findDefault(userId: string): Promise<ImageProfile | null> {
    const collection = await this.getCollection();

    logger.debug('Finding default image profile for user', {
      userId,
    });

    try {
      const profile = await collection.findOne({
        userId,
        isDefault: true,
      });

      if (!profile) {
        logger.debug('Default image profile not found for user', {
          userId,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...profileData } = profile as any;

      const validationResult = this.validateSafe(profileData);
      if (!validationResult.success) {
        logger.warn('Default image profile validation failed', {
          userId,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Default image profile found', {
        userId,
        profileId: profileData.id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding default image profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Find an image profile by name for a user
   */
  async findByName(userId: string, name: string): Promise<ImageProfile | null> {
    const collection = await this.getCollection();

    logger.debug('Finding image profile by name', {
      userId,
      name,
    });

    try {
      const profile = await collection.findOne({
        userId,
        name,
      });

      if (!profile) {
        logger.debug('Image profile not found by name', {
          userId,
          name,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...profileData } = profile as any;

      const validationResult = this.validateSafe(profileData);
      if (!validationResult.success) {
        logger.warn('Image profile validation failed during findByName', {
          userId,
          name,
          error: validationResult.error,
        });
        return null;
      }

      logger.debug('Image profile found by name', {
        userId,
        name,
        profileId: profileData.id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error finding image profile by name', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Create a new image profile
   */
  async create(data: Omit<ImageProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<ImageProfile> {
    const collection = await this.getCollection();
    const id = this.generateId();
    const now = this.getCurrentTimestamp();

    logger.debug('Creating new image profile', {
      userId: data.userId,
      name: data.name,
      provider: data.provider,
    });

    try {
      const profile: ImageProfile = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      const validated = this.validate(profile);

      // Insert into MongoDB (MongoDB will add _id automatically)
      const result = await collection.insertOne(validated as any);

      logger.info('Image profile created successfully', {
        profileId: id,
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        insertedId: result.insertedId.toString(),
      });

      return validated;
    } catch (error) {
      logger.error('Error creating image profile', {
        userId: data.userId,
        name: data.name,
        provider: data.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update an image profile
   */
  async update(id: string, data: Partial<ImageProfile>): Promise<ImageProfile | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Updating image profile', {
      profileId: id,
    });

    try {
      // Prepare update data
      const updateData: any = {
        ...data,
        updatedAt: now,
      };

      // Remove id and createdAt to prevent accidental overwrites
      delete updateData.id;
      delete updateData.createdAt;

      const result = await collection.findOneAndUpdate(
        { id },
        { $set: updateData },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Image profile not found during update', {
          profileId: id,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...profileData } = result as any;

      const validationResult = this.validateSafe(profileData);
      if (!validationResult.success) {
        logger.warn('Updated image profile validation failed', {
          profileId: id,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Image profile updated successfully', {
        profileId: id,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error updating image profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Delete an image profile
   */
  async delete(id: string): Promise<boolean> {
    const collection = await this.getCollection();

    logger.debug('Deleting image profile', {
      profileId: id,
    });

    try {
      const result = await collection.deleteOne({ id });

      if (result.deletedCount === 0) {
        logger.warn('Image profile not found during delete', {
          profileId: id,
        });
        return false;
      }

      logger.info('Image profile deleted successfully', {
        profileId: id,
        deletedCount: result.deletedCount,
      });

      return true;
    } catch (error) {
      logger.error('Error deleting image profile', {
        profileId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Add a tag to an image profile
   */
  async addTag(profileId: string, tagId: string): Promise<ImageProfile | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Adding tag to image profile', {
      profileId,
      tagId,
    });

    try {
      const result = await collection.findOneAndUpdate(
        { id: profileId },
        {
          $addToSet: { tags: tagId },
          $set: { updatedAt: now },
        },
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Image profile not found during tag addition', {
          profileId,
          tagId,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...profileData } = result as any;

      const validationResult = this.validateSafe(profileData);
      if (!validationResult.success) {
        logger.warn('Image profile validation failed after adding tag', {
          profileId,
          tagId,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Tag added to image profile successfully', {
        profileId,
        tagId,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error adding tag to image profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Remove a tag from an image profile
   */
  async removeTag(profileId: string, tagId: string): Promise<ImageProfile | null> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Removing tag from image profile', {
      profileId,
      tagId,
    });

    try {
      const result = await collection.findOneAndUpdate(
        { id: profileId },
        {
          $pull: { tags: tagId },
          $set: { updatedAt: now },
        } as any,
        { returnDocument: 'after' }
      );

      if (!result) {
        logger.warn('Image profile not found during tag removal', {
          profileId,
          tagId,
        });
        return null;
      }

      // Remove MongoDB's _id field before validation
      const { _id, ...profileData } = result as any;

      const validationResult = this.validateSafe(profileData);
      if (!validationResult.success) {
        logger.warn('Image profile validation failed after removing tag', {
          profileId,
          tagId,
          error: validationResult.error,
        });
        return null;
      }

      logger.info('Tag removed from image profile successfully', {
        profileId,
        tagId,
      });

      return validationResult.data || null;
    } catch (error) {
      logger.error('Error removing tag from image profile', {
        profileId,
        tagId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Set all profiles for a user to isDefault=false
   * Used to ensure only one default profile per user
   */
  async unsetAllDefaults(userId: string): Promise<number> {
    const collection = await this.getCollection();
    const now = this.getCurrentTimestamp();

    logger.debug('Unsetting all default image profiles for user', {
      userId,
    });

    try {
      const result = await collection.updateMany(
        { userId, isDefault: true },
        {
          $set: {
            isDefault: false,
            updatedAt: now,
          },
        }
      );

      logger.info('All default image profiles unset for user', {
        userId,
        modifiedCount: result.modifiedCount,
      });

      return result.modifiedCount;
    } catch (error) {
      logger.error('Error unsetting all default image profiles', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
