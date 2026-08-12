/**
 * Help Docs API v1 - Individual Document Endpoint
 *
 * GET /api/v1/help-docs/[id] - Get a single help document with content
 */

import { NextRequest } from 'next/server';
import { createContextHandler, type RequestContext } from '@/lib/api/middleware';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { successResponse, notFound, serverError } from '@/lib/api/responses';
import { getHelpSearch } from '@/lib/help-search';

const logger = createServiceLogger('HelpDocRoute');

/**
 * Extract document ID from the URL pathname
 */
function extractDocumentId(pathname: string): string {
  const segments = pathname.split('/');
  return segments[segments.length - 1];
}

/**
 * GET /api/v1/help-docs/[id] - Get a single help document with content
 */
export const GET = createContextHandler(async (request: NextRequest, _context: RequestContext) => {
  try {
    const docId = extractDocumentId(request.nextUrl.pathname);

    const helpSearch = getHelpSearch();
    if (!helpSearch.isLoaded()) {
      await helpSearch.loadFromDatabase();
    }

    const document = await helpSearch.getDocument(docId);

    if (!document) {
      logger.warn('[HelpDoc] Document not found', { documentId: docId });
      return notFound('Help document');
    }

    logger.info('[HelpDoc] Document retrieved', {
      documentId: docId,
      title: document.title,
    });

    return successResponse({
      document: {
        id: document.id,
        title: document.title,
        path: document.path,
        url: document.url,
        content: document.content,
      },
    });
  } catch (error) {
    logger.error('[HelpDoc] Error getting document', {}, error instanceof Error ? error : undefined);
    return serverError('Failed to get help document');
  }
});
