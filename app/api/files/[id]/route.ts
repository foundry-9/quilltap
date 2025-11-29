/**
 * File Serving API Route
 *
 * Serves files from the centralized file storage.
 * GET /api/files/:id - Retrieve a file by ID
 * DELETE /api/files/:id - Delete a file by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { findFileById, readFile, deleteFile, removeFileLink } from '@/lib/file-manager';

/**
 * GET /api/files/:id
 * Retrieve a file by its ID
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fileId } = await params;

    // Get file metadata
    const fileEntry = await findFileById(fileId);
    if (!fileEntry) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Read file buffer
    const buffer = await readFile(fileId);

    // Return file with appropriate headers
    return new NextResponse(Buffer.from(buffer), {
      headers: {
        'Content-Type': fileEntry.mimeType,
        'Content-Length': fileEntry.size.toString(),
        'Content-Disposition': `inline; filename="${fileEntry.originalFilename}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (error) {
    console.error('Error serving file:', error);
    return NextResponse.json(
      { error: 'Failed to serve file' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/files/:id
 * Delete a file by its ID
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fileId } = await params;

    // Get file metadata
    const fileEntry = await findFileById(fileId);
    if (!fileEntry) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Check if file is still linked to any entities
    if (fileEntry.linkedTo.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete file that is still in use',
          linkedTo: fileEntry.linkedTo,
        },
        { status: 400 }
      );
    }

    // Delete the file
    const deleted = await deleteFile(fileId);

    if (!deleted) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting file:', error);
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/files/:id/unlink
 * Remove a link from a file
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: fileId } = await params;
    const { entityId } = await request.json();

    if (!entityId) {
      return NextResponse.json(
        { error: 'entityId is required' },
        { status: 400 }
      );
    }

    // Get file metadata
    const fileEntry = await findFileById(fileId);
    if (!fileEntry) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    // Remove the link
    const updated = await removeFileLink(fileId, entityId);

    // If no more links, consider auto-deleting the file
    if (updated.linkedTo.length === 0) {
      // Optionally delete the file automatically
      // await deleteFile(fileId);
      // return NextResponse.json({ success: true, deleted: true });
    }

    return NextResponse.json({ success: true, file: updated });
  } catch (error) {
    console.error('Error unlinking file:', error);
    return NextResponse.json(
      { error: 'Failed to unlink file' },
      { status: 500 }
    );
  }
}
