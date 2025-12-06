/**
 * Mock for AWS SDK S3 Client
 *
 * Provides mock implementations of S3 client and commands for testing.
 * All operations are mocked to succeed by default.
 */

export class S3Client {
  private config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
  }

  send = jest.fn().mockImplementation((command: unknown) => {
    // Return appropriate mock response based on command type
    if (command instanceof GetObjectCommand) {
      return Promise.resolve({
        Body: {
          [Symbol.asyncIterator]: async function* () {
            yield Buffer.from('mock file content');
          },
        },
        ContentType: 'application/octet-stream',
        ContentLength: 17,
      });
    }
    if (command instanceof PutObjectCommand) {
      return Promise.resolve({
        ETag: '"mock-etag"',
      });
    }
    if (command instanceof DeleteObjectCommand) {
      return Promise.resolve({});
    }
    if (command instanceof HeadObjectCommand) {
      return Promise.resolve({
        ContentLength: 17,
        ContentType: 'application/octet-stream',
        LastModified: new Date(),
      });
    }
    if (command instanceof ListObjectsV2Command) {
      return Promise.resolve({
        Contents: [],
        IsTruncated: false,
      });
    }
    return Promise.resolve({});
  });

  destroy = jest.fn();
}

export class PutObjectCommand {
  public readonly input: {
    Bucket?: string;
    Key?: string;
    Body?: unknown;
    ContentType?: string;
    Metadata?: Record<string, string>;
  };

  constructor(input: {
    Bucket?: string;
    Key?: string;
    Body?: unknown;
    ContentType?: string;
    Metadata?: Record<string, string>;
  }) {
    this.input = input;
  }
}

export class GetObjectCommand {
  public readonly input: {
    Bucket?: string;
    Key?: string;
  };

  constructor(input: { Bucket?: string; Key?: string }) {
    this.input = input;
  }
}

export class DeleteObjectCommand {
  public readonly input: {
    Bucket?: string;
    Key?: string;
  };

  constructor(input: { Bucket?: string; Key?: string }) {
    this.input = input;
  }
}

export class HeadObjectCommand {
  public readonly input: {
    Bucket?: string;
    Key?: string;
  };

  constructor(input: { Bucket?: string; Key?: string }) {
    this.input = input;
  }
}

export class ListObjectsV2Command {
  public readonly input: {
    Bucket?: string;
    Prefix?: string;
    MaxKeys?: number;
    ContinuationToken?: string;
  };

  constructor(input: {
    Bucket?: string;
    Prefix?: string;
    MaxKeys?: number;
    ContinuationToken?: string;
  }) {
    this.input = input;
  }
}

// Error class for "key not found" scenarios
export class NoSuchKey extends Error {
  public readonly name = 'NoSuchKey';
  public readonly $metadata = {
    httpStatusCode: 404,
  };

  constructor(message?: string) {
    super(message || 'The specified key does not exist.');
  }
}
