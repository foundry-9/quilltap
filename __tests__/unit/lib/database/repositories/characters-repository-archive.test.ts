import { describe, it, expect } from '@jest/globals';
import { validateCharacterArchivePatch, CharacterArchivedError } from '@/lib/database/repositories/characters.repository';

describe('validateCharacterArchivePatch', () => {
  it('refuses non-rehydrate updates for an archived character', () => {
    expect(() =>
      validateCharacterArchivePatch(
        {
          id: 'character-1',
          userId: 'user-1',
          name: 'Mara',
          archivedAt: '2026-08-10T00:00:00.000Z',
        } as any,
        { name: 'Mara V2' }
      )
    ).toThrow(CharacterArchivedError);
  });

  it('allows the sanctioned unarchive patch', () => {
    expect(() =>
      validateCharacterArchivePatch(
        {
          id: 'character-1',
          userId: 'user-1',
          name: 'Mara',
          archivedAt: '2026-08-10T00:00:00.000Z',
        } as any,
        { archivedAt: null }
      )
    ).not.toThrow();
  });

  it('refuses the retired archive-finalization patch', () => {
    // Pre-§4.2a, cleanup was allowed to null the vault pointer after deleting
    // the store. Nothing deletes the vault any more — the archive prunes it in
    // place — so nulling the pointer is no longer sanctioned for anyone.
    expect(() =>
      validateCharacterArchivePatch(
        {
          id: 'character-1',
          userId: 'user-1',
          name: 'Mara',
          archivedAt: '2026-08-10T00:00:00.000Z',
        } as any,
        { characterDocumentMountPointId: null }
      )
    ).toThrow(CharacterArchivedError);
  });

  it('refuses to repoint an archived character at a live store', () => {
    expect(() =>
      validateCharacterArchivePatch(
        {
          id: 'character-1',
          userId: 'user-1',
          name: 'Mara',
          archivedAt: '2026-08-10T00:00:00.000Z',
        } as any,
        { characterDocumentMountPointId: 'some-other-store' }
      )
    ).toThrow(CharacterArchivedError);
  });

  it('refuses a finalization patch smuggling extra fields', () => {
    expect(() =>
      validateCharacterArchivePatch(
        {
          id: 'character-1',
          userId: 'user-1',
          name: 'Mara',
          archivedAt: '2026-08-10T00:00:00.000Z',
        } as any,
        { characterDocumentMountPointId: null, name: 'Mara V2' }
      )
    ).toThrow(CharacterArchivedError);
  });

  it('permits updates for live characters', () => {
    expect(() =>
      validateCharacterArchivePatch(
        {
          id: 'character-1',
          userId: 'user-1',
          name: 'Mara',
          archivedAt: null,
        } as any,
        { name: 'Mara V2' }
      )
    ).not.toThrow();
  });
});
