/**
 * Mock for AWS SDK S3 Request Presigner
 *
 * Provides mock implementation of getSignedUrl for testing.
 */

export const getSignedUrl = jest.fn().mockImplementation(
  async (_client: unknown, _command: unknown, _options?: { expiresIn?: number }) => {
    return 'https://mock-s3-bucket.s3.amazonaws.com/mock-presigned-url';
  }
);
