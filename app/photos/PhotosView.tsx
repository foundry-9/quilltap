'use client';

/**
 * "My Photos" gallery page — a deduped roll-up of every `photos/` folder
 * across the instance (character vaults, project stores, Quilltap General,
 * Quilltap Uploads). The same image hard-linked into multiple albums
 * collapses to a single card with a "linked in N places" badge that
 * expands to the full linker list in the detail modal.
 *
 * Backed by `GET /api/v1/photos`; see `lib/photos/user-gallery-service.ts`
 * for the aggregation logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { showConfirmation } from '@/lib/alert';
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider';

interface PhotoLinker {
  linkId: string;
  mountPointId: string;
  mountPointName: string;
  mountStoreType: 'character' | 'documents';
  relativePath: string;
  isPhotoAlbum: boolean;
  linkedAt: string;
  linkedBy: string | null;
  linkedById: string | null;
  caption: string | null;
  tags: string[];
}

interface PhotoLinkSummary {
  count: number;
  linkers: PhotoLinker[];
}

interface GalleryEntry {
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sha256: string;
  fileSizeBytes: number;
  keptAt: string;
  caption: string | null;
  tags: string[];
  generationPromptExcerpt: string;
  relevanceScore?: number;
  linkSummary: PhotoLinkSummary;
}

interface ListResponse {
  entries: GalleryEntry[];
  total: number;
  hasMore: boolean;
}

const PAGE_SIZE = 60;

export function PhotosView() {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selected, setSelected] = useState<GalleryEntry | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Each new search/clear bumps the fetch generation so a stale in-flight
  // load-more from the previous query can't clobber the new page.
  const fetchGenerationRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const bgStyle = useSubsystemBackgroundStyle('lantern');

  // Initial / on-search-change fetch.
  useEffect(() => {
    const generation = ++fetchGenerationRef.current;
    const fetchInitial = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
        params.set('limit', String(PAGE_SIZE));
        params.set('offset', '0');
        const res = await fetch(`/api/v1/photos?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to load gallery (${res.status})`);
        }
        const json: ListResponse = await res.json();
        if (generation !== fetchGenerationRef.current) return;
        setEntries(json.entries ?? []);
        setTotal(json.total ?? json.entries?.length ?? 0);
        setHasMore(Boolean(json.hasMore));
      } catch (err) {
        if (generation !== fetchGenerationRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load gallery');
      } finally {
        if (generation === fetchGenerationRef.current) setLoading(false);
      }
    };
    fetchInitial();
  }, [appliedQuery]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore) return;
    const generation = fetchGenerationRef.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
      params.set('limit', String(PAGE_SIZE));
      params.set('offset', String(entries.length));
      const res = await fetch(`/api/v1/photos?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to load more (${res.status})`);
      const json: ListResponse = await res.json();
      if (generation !== fetchGenerationRef.current) return;
      const incoming = json.entries ?? [];
      setEntries(prev => {
        // Defensive de-dupe: if the underlying ordering shifted (a save
        // happened mid-scroll), the same linkId could appear twice.
        const seen = new Set(prev.map(e => e.linkId));
        const fresh = incoming.filter(e => !seen.has(e.linkId));
        return [...prev, ...fresh];
      });
      setHasMore(Boolean(json.hasMore));
      if (typeof json.total === 'number') setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [appliedQuery, entries.length, hasMore, loading, loadingMore]);

  // IntersectionObserver — fires loadMore when the sentinel scrolls into
  // view. rootMargin pre-loads the next page before the user hits the
  // bottom, so scrolling feels continuous.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entriesObs) => {
        if (entriesObs.some(e => e.isIntersecting)) {
          loadMore();
        }
      },
      { rootMargin: '600px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setAppliedQuery(query);
    },
    [query]
  );

  const handleDelete = useCallback(
    async (linkId: string) => {
      if (!(await showConfirmation('Remove this photo from this album? Other albums that link the same image will keep their copy.'))) return;
      setDeleting(linkId);
      try {
        const res = await fetch(`/api/v1/photos/${linkId}`, { method: 'DELETE' });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || `Failed to delete (${res.status})`);
        }
        setEntries(prev => prev.filter(e => e.linkId !== linkId));
        setTotal(prev => Math.max(0, prev - 1));
        if (selected?.linkId === linkId) setSelected(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete');
      } finally {
        setDeleting(null);
      }
    },
    [selected]
  );

  const counterLabel = useMemo(() => {
    if (loading && entries.length === 0) return 'Loading…';
    if (appliedQuery && total > 0) return `${total} ${total === 1 ? 'match' : 'matches'} for “${appliedQuery}”`;
    if (appliedQuery) return `No matches for “${appliedQuery}”`;
    if (total === 0) return 'No photos yet';
    return `${total} ${total === 1 ? 'photo' : 'photos'}`;
  }, [loading, entries.length, total, appliedQuery]);

  const emptyState = entries.length === 0 && !loading && !error;

  return (
    <div
      className="qt-page-container text-foreground"
      style={bgStyle}
    >
      <header className="flex flex-wrap items-end justify-between gap-6 border-b qt-border-default/60 pb-6">
        <div className="max-w-2xl space-y-2">
          <h1 className="qt-page-title">My Photos</h1>
          <p className="qt-text-small">
            Every image you&rsquo;ve kept, gathered from each character&rsquo;s vault, each project album, and your private uploads — listed once and linked to wherever it lives.
          </p>
          <p className="qt-text-muted text-xs uppercase tracking-wide">
            {counterLabel}
          </p>
        </div>
        <Link href="/salon" className="qt-link text-sm whitespace-nowrap">
          ← Back to the Salon
        </Link>
      </header>

      <form onSubmit={handleSearch} className="mt-8 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[16rem]">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center qt-text-muted"
            aria-hidden="true"
          >
            🔍
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by prompt, caption, scene, or tag…"
            className="qt-input pl-9"
            aria-label="Search your photos"
          />
        </div>
        <button type="submit" className="qt-button-primary">Search</button>
        {appliedQuery && (
          <button
            type="button"
            className="qt-button-secondary"
            onClick={() => {
              setQuery('');
              setAppliedQuery('');
            }}
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <div className="qt-alert-error mt-6" role="alert">
          {error}
        </div>
      )}

      {loading && entries.length === 0 && (
        <div className="mt-12 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary" />
        </div>
      )}

      {emptyState && appliedQuery && (
        <div className="mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-16 text-center qt-shadow-sm">
          <h2 className="qt-heading-3 mb-3">Nothing matches that search</h2>
          <p className="qt-text-small max-w-md mx-auto">
            No photo&rsquo;s prompt, caption, scene, or tags pair convincingly with &ldquo;{appliedQuery}&rdquo;. Try a different phrasing or clear the search to browse everything.
          </p>
          <button
            type="button"
            className="qt-link mt-6 inline-block text-sm"
            onClick={() => {
              setQuery('');
              setAppliedQuery('');
            }}
          >
            Clear search ↺
          </button>
        </div>
      )}

      {emptyState && !appliedQuery && (
        <div className="mt-12 rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-16 text-center qt-shadow-sm">
          <h2 className="qt-heading-3 mb-3">Nothing pinned to the wall yet</h2>
          <p className="qt-text-small max-w-md mx-auto">
            Save an image from any chat — the &ldquo;Save image&rdquo; button on a message tucks it into the album of your choice, and it&rsquo;ll appear here the moment it&rsquo;s filed.
          </p>
          <Link href="/salon" className="qt-link mt-6 inline-block text-sm">
            Take me to the Salon →
          </Link>
        </div>
      )}

      {entries.length > 0 && (
        <>
          <ul className="mt-8 grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {entries.map((entry) => (
              <PhotoCard
                key={entry.linkId}
                entry={entry}
                onClick={() => setSelected(entry)}
              />
            ))}
          </ul>

          <div ref={sentinelRef} aria-hidden="true" className="h-1" />

          {loadingMore && (
            <div className="mt-8 flex items-center justify-center gap-3 qt-text-muted text-sm">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-b-2 qt-border-primary" />
              Loading more photos…
            </div>
          )}

          {!hasMore && !loadingMore && entries.length >= PAGE_SIZE && (
            <p className="mt-10 text-center qt-text-muted text-xs uppercase tracking-wider">
              {entries.length === total
                ? `That’s all ${total} of them.`
                : `End of the gallery — ${entries.length} of ${total} shown.`}
            </p>
          )}
        </>
      )}

      {selected && (
        <PhotoDetailModal
          entry={selected}
          deleting={deleting === selected.linkId}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected.linkId)}
        />
      )}
    </div>
  );
}

function PhotoCard({ entry, onClick }: { entry: GalleryEntry; onClick: () => void }) {
  const primaryCaption = entry.caption || entry.generationPromptExcerpt || entry.fileName;
  const primaryLinker = entry.linkSummary.linkers.find(l => l.linkId === entry.linkId)
    ?? entry.linkSummary.linkers[0];
  const linkerLabel = primaryLinker
    ? primaryLinker.linkedBy ?? primaryLinker.mountPointName
    : 'Unfiled';

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group relative flex w-full flex-col overflow-hidden rounded-2xl border qt-border-default/60 qt-bg-card/90 text-left qt-shadow-sm transition-all hover:-translate-y-0.5 hover:qt-border-primary/60 hover:qt-shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={primaryCaption}
      >
        <div className="relative aspect-square w-full overflow-hidden qt-bg-muted/40">
          <img
            src={entry.blobUrl}
            alt={primaryCaption}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          {entry.linkSummary.count > 1 && (
            <span
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium qt-text-primary backdrop-blur-sm qt-shadow-sm"
              title={`Hard-linked in ${entry.linkSummary.count} places`}
            >
              <span aria-hidden="true">🔗</span>
              {entry.linkSummary.count}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-4 py-3">
          <p className="line-clamp-2 text-sm font-medium text-foreground" title={primaryCaption}>
            {primaryCaption}
          </p>
          <p className="qt-text-muted truncate text-xs" title={linkerLabel}>
            {linkerLabel}
          </p>
        </div>
      </button>
    </li>
  );
}

function PhotoDetailModal({
  entry,
  deleting,
  onClose,
  onDelete,
}: {
  entry: GalleryEntry;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const primaryCaption = entry.caption || entry.fileName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border qt-border-default qt-bg-card qt-shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-detail-title"
      >
        <header className="flex items-start justify-between gap-4 border-b qt-border-default/60 px-6 py-4">
          <div className="min-w-0">
            <h2 id="photo-detail-title" className="qt-heading-3 truncate">
              {primaryCaption}
            </h2>
            <p className="qt-text-muted mt-1 text-xs">
              Saved {new Date(entry.keptAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="qt-button-secondary qt-text-muted px-3 py-1 text-lg leading-none"
          >
            ×
          </button>
        </header>
        <div className="grid max-h-[calc(90vh-9rem)] gap-6 overflow-y-auto px-6 py-5 md:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex items-start justify-center">
            <img
              src={entry.blobUrl}
              alt={primaryCaption}
              className="max-h-[70vh] w-full rounded-xl object-contain qt-shadow-sm"
            />
          </div>
          <div className="space-y-5">
            {entry.generationPromptExcerpt && (
              <Section title="Original prompt">
                <p className="qt-text-small leading-relaxed">{entry.generationPromptExcerpt}</p>
              </Section>
            )}

            {entry.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1.5">
                  {entry.tags.map((t) => (
                    <span key={t} className="qt-badge qt-badge-muted">{t}</span>
                  ))}
                </div>
              </Section>
            )}

            <Section
              title={`Linked in ${entry.linkSummary.count} ${entry.linkSummary.count === 1 ? 'place' : 'places'}`}
            >
              <ul className="space-y-2">
                {entry.linkSummary.linkers.map((linker) => (
                  <li
                    key={linker.linkId}
                    className="rounded-lg border qt-border-default/50 qt-bg-muted/40 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-medium text-foreground">
                        {linker.linkedBy ?? linker.mountPointName}
                      </span>
                      <span className="qt-badge qt-badge-muted whitespace-nowrap text-[10px] uppercase">
                        {linker.mountStoreType === 'character' ? 'Vault' : 'Album'}
                      </span>
                    </div>
                    <p className="qt-text-muted mt-1 break-all font-mono text-xs">
                      {linker.relativePath}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Identity">
              <p className="qt-text-muted break-all font-mono text-[11px]">
                sha256: {entry.sha256}
              </p>
              <p className="qt-text-muted break-all font-mono text-[11px]">
                linkId: {entry.linkId}
              </p>
            </Section>
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t qt-border-default/60 px-6 py-4">
          <button
            type="button"
            className="qt-button qt-button-destructive"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? 'Removing…' : 'Remove from this album'}
          </button>
          <button type="button" className="qt-button-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="qt-text-muted mb-2 text-[11px] font-semibold uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
