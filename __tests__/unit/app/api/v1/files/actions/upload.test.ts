import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { NextRequest } from 'next/server';

jest.mock('@/lib/logger', () => ({
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

import { handleUploadFile } from '@/app/api/v1/files/actions/upload';

describe('files upload action', () => {
  let ctx: any;

  beforeEach(() => {
    ctx = {
      user: { id: 'user-1' },
      repos: {},
    };
  });

  it('rejects uploads without multipart/form-data content type', async () => {
    const request = {
      headers: {
        get: () => 'application/json',
      },
    } as unknown as NextRequest;

    const response = await handleUploadFile(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Expected multipart/form-data content type');
  });

  it('rejects uploads without a file', async () => {
    const formData = {
      get: () => null,
    } as unknown as FormData;

    const request = {
      headers: {
        get: () => 'multipart/form-data; boundary=test',
      },
      formData: async () => formData,
    } as unknown as NextRequest;

    const response = await handleUploadFile(request, ctx);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('No file provided');
  });

  it('does not require file write permission for user-initiated uploads', async () => {
    // User-initiated uploads should not go through the AI file write permission system.
    // The upload endpoint is protected by authentication (createContextHandler),
    // not by the Prospero file write permission gate.
    const mockFile = {
      name: 'notes.txt',
      type: 'text/plain',
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as File;

    const formData = {
      get: (key: string) => {
        if (key === 'file') return mockFile;
        return null;
      },
    } as unknown as FormData;

    const request = {
      headers: {
        get: () => 'multipart/form-data; boundary=test',
      },
      formData: async () => formData,
    } as unknown as NextRequest;

    // This will fail because we haven't mocked the full file storage pipeline,
    // but the important thing is it does NOT return 403
    const response = await handleUploadFile(request, ctx);
    expect(response.status).not.toBe(403);
  });
});
