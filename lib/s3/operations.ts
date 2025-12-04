/**
 * S3 file operations module
 * Provides utilities for uploading, downloading, deleting, and managing files in AWS S3
 */

import { Readable } from 'node:stream';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, getS3Bucket } from './client';
import { logger } from '@/lib/logger';
import type { S3Client } from '@aws-sdk/client-s3';

/**
 * Get the S3 client, throwing an error if S3 is disabled
 * @returns The S3 client
 * @throws Error if S3 is disabled or not configured
 */
function requireS3Client(): S3Client {
  const client = getS3Client();
  if (!client) {
    throw new Error('S3 is disabled. Enable S3 by setting S3_MODE to "external" or "embedded".');
  }
  return client;
}

/**
 * Upload a file to S3
 * @param key The object key (path) in S3
 * @param body The file content as Buffer or Readable stream
 * @param contentType The MIME type of the file
 * @param metadata Optional metadata to attach to the object
 * @throws Error if upload fails
 */
export async function uploadFile(
  key: string,
  body: Buffer | Readable,
  contentType: string,
  metadata?: Record<string, string>
): Promise<void> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Uploading file to S3', {
      key,
      contentType,
      bucket,
      hasMetadata: !!metadata,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      Metadata: metadata,
    });

    await client.send(command);

    logger.info('File uploaded to S3', {
      key,
      contentType,
      bucket,
    });
  } catch (error) {
    logger.error(
      'Failed to upload file to S3',
      { key, contentType, bucket },
      error as Error
    );
    throw error;
  }
}

/**
 * Download a file from S3
 * @param key The object key (path) in S3
 * @returns The file content as a Buffer
 * @throws Error if download fails or file not found
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Downloading file from S3', { key, bucket });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    const stream = response.Body as Readable;

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);

    logger.debug('File downloaded from S3', {
      key,
      bucket,
      size: buffer.length,
    });

    return buffer;
  } catch (error) {
    logger.error(
      'Failed to download file from S3',
      { key, bucket },
      error as Error
    );
    throw error;
  }
}

/**
 * Delete a file from S3
 * @param key The object key (path) in S3
 * @throws Error if deletion fails
 */
export async function deleteFile(key: string): Promise<void> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Deleting file from S3', { key, bucket });

    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);

    logger.info('File deleted from S3', { key, bucket });
  } catch (error) {
    logger.error(
      'Failed to delete file from S3',
      { key, bucket },
      error as Error
    );
    throw error;
  }
}

/**
 * Check if a file exists in S3
 * @param key The object key (path) in S3
 * @returns true if file exists, false otherwise
 */
export async function fileExists(key: string): Promise<boolean> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Checking if file exists in S3', { key, bucket });

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await client.send(command);

    logger.debug('File exists in S3', { key, bucket });
    return true;
  } catch (error) {
    const err = error as any;

    // Check if error is NoSuchKey or 404
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      logger.debug('File does not exist in S3', { key, bucket });
      return false;
    }

    logger.error(
      'Failed to check file existence in S3',
      { key, bucket },
      error as Error
    );
    throw error;
  }
}

/**
 * Generate a presigned URL for downloading a file
 * @param key The object key (path) in S3
 * @param expiresIn The URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns The presigned URL
 * @throws Error if URL generation fails
 */
export async function getPresignedUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Generating presigned download URL', {
      key,
      bucket,
      expiresIn,
    });

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(client, command, { expiresIn });

    logger.debug('Presigned download URL generated', {
      key,
      bucket,
      expiresIn,
    });

    return url;
  } catch (error) {
    logger.error(
      'Failed to generate presigned download URL',
      { key, bucket, expiresIn },
      error as Error
    );
    throw error;
  }
}

/**
 * Generate a presigned URL for uploading a file
 * @param key The object key (path) in S3
 * @param contentType The MIME type of the file to be uploaded
 * @param expiresIn The URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns The presigned URL
 * @throws Error if URL generation fails
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Generating presigned upload URL', {
      key,
      contentType,
      bucket,
      expiresIn,
    });

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(client, command, { expiresIn });

    logger.debug('Presigned upload URL generated', {
      key,
      contentType,
      bucket,
      expiresIn,
    });

    return url;
  } catch (error) {
    logger.error(
      'Failed to generate presigned upload URL',
      { key, contentType, bucket, expiresIn },
      error as Error
    );
    throw error;
  }
}

/**
 * Get the public URL for a file in S3
 * Falls back to presigned URL if S3_PUBLIC_URL is not configured
 * @param key The object key (path) in S3
 * @returns The public URL
 * @throws Error if URL generation fails
 */
export async function getPublicUrl(key: string): Promise<string> {
  const bucket = getS3Bucket();
  const publicUrl = process.env.S3_PUBLIC_URL;

  try {
    if (publicUrl) {
      logger.debug('Using configured S3 public URL', { key, bucket });
      return `${publicUrl}/${key}`;
    }

    logger.debug('S3_PUBLIC_URL not configured, generating presigned URL', {
      key,
      bucket,
    });

    return await getPresignedUrl(key);
  } catch (error) {
    logger.error(
      'Failed to get public URL for file',
      { key, bucket, hasPublicUrl: !!publicUrl },
      error as Error
    );
    throw error;
  }
}

/**
 * Get metadata for a file in S3
 * @param key The object key (path) in S3
 * @returns Object containing size, contentType, and lastModified date, or null if file doesn't exist
 * @throws Error if metadata retrieval fails (other than NotFound)
 */
export async function getFileMetadata(
  key: string
): Promise<{ size: number; contentType: string; lastModified: Date } | null> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Getting file metadata from S3', { key, bucket });

    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await client.send(command);

    const metadata = {
      size: response.ContentLength || 0,
      contentType: response.ContentType || 'application/octet-stream',
      lastModified: response.LastModified || new Date(),
    };

    logger.debug('File metadata retrieved from S3', {
      key,
      bucket,
      size: metadata.size,
      contentType: metadata.contentType,
    });

    return metadata;
  } catch (error) {
    const err = error as any;

    // Check if error is NoSuchKey or 404
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      logger.debug('File does not exist in S3', { key, bucket });
      return null;
    }

    logger.error(
      'Failed to get file metadata from S3',
      { key, bucket },
      error as Error
    );
    throw error;
  }
}

/**
 * List all files in S3 with a given prefix
 * @param prefix The prefix to filter objects (e.g., 'uploads/', 'documents/')
 * @param maxKeys The maximum number of keys to return (default: 1000)
 * @returns Array of object keys matching the prefix
 * @throws Error if listing fails
 */
export async function listFiles(
  prefix: string,
  maxKeys: number = 1000
): Promise<string[]> {
  const client = requireS3Client();
  const bucket = getS3Bucket();

  try {
    logger.debug('Listing files in S3', { bucket, prefix, maxKeys });

    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await client.send(command);
    const keys = response.Contents?.map((obj) => obj.Key).filter(
      (key): key is string => key !== undefined
    ) ?? [];

    logger.debug('Files listed from S3', {
      bucket,
      prefix,
      count: keys.length,
    });

    return keys;
  } catch (error) {
    logger.error(
      'Failed to list files in S3',
      { bucket, prefix, maxKeys },
      error as Error
    );
    throw error;
  }
}
