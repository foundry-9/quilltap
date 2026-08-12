'use client'

/**
 * Group Editor — the body of a single group's page as a props-driven view, so
 * it renders either at `/aurora/groups/[id]` (route wrapper supplies a router
 * `onBack`) or in place inside the Aurora workspace tab (the list view supplies
 * a state `onBack`), keeping the workspace mounted for keep-alive.
 *
 * @module app/aurora/groups/[id]/GroupDetailView
 */

import { useEffect, useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { GroupMembersCard } from '../components/GroupMembersCard'
import { GroupLinkedStoresCard } from '../components/GroupLinkedStoresCard'
import { useGroupMembers } from '../hooks/useGroupMembers'
import { useGroupMountPoints } from '../hooks/useGroupMountPoints'
import { Icon } from '@/components/ui/icon'
import StateEditorModal from '@/components/state/StateEditorModal'
import type { Group } from '../../types'

export interface GroupDetailViewProps {
  groupId: string
  onBack: () => void
}

export function GroupDetailView({ groupId, onBack }: GroupDetailViewProps) {
  const [group, setGroup] = useState<Group | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({ name: '', description: '', color: '', icon: '' })
  const [membersExpanded, setMembersExpanded] = useState(false)
  const [storesExpanded, setStoresExpanded] = useState(false)
  const [showStateModal, setShowStateModal] = useState(false)

  const { members, allCharacters, fetchMembers, fetchAllCharacters, addMember, removeMember } = useGroupMembers(groupId)
  const { linkedStores, allStores, fetchLinkedStores, fetchAllStores, linkStore, unlinkStore } = useGroupMountPoints(groupId)

  // Fetch group and related data on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Fetch group
        const groupRes = await fetch(`/api/v1/groups/${groupId}`)
        if (!groupRes.ok) throw new Error('Failed to fetch group')
        const groupData = await groupRes.json()
        const g = groupData.group || groupData
        setGroup(g)
        setFormData({
          name: g.name || '',
          description: g.description || '',
          color: g.color || '',
          icon: g.icon || '',
        })

        // Fetch members and all characters
        await Promise.all([
          fetchMembers(),
          fetchAllCharacters(),
          fetchLinkedStores(),
          fetchAllStores(),
        ])
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'An error occurred'
        console.error('GroupDetailView: fetch error', { error: errorMsg })
        setError(errorMsg)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [groupId, fetchMembers, fetchAllCharacters, fetchLinkedStores, fetchAllStores])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!group) return

    try {
      setSaving(true)
      const res = await fetch(`/api/v1/groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          color: formData.color || null,
          icon: formData.icon || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to save group')

      const data = await res.json()
      setGroup(data.group || data)
      showSuccessToast('Group updated successfully!')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save group'
      console.error('GroupDetailView: save error', { error: errorMsg })
      showErrorToast(errorMsg)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading group...</p>
      </div>
    )
  }

  if (error || !group) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg qt-text-destructive mb-4">Error: {error || 'Group not found'}</p>
          <button onClick={onBack} className="qt-text-primary hover:text-primary/80">
            Back to groups
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="qt-page-container text-foreground">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="inline-flex items-center justify-center rounded-lg border qt-border-default qt-bg-muted/70 p-2 qt-shadow-sm transition hover:qt-bg-muted"
          title="Go back"
        >
          <Icon name="chevron-left" className="w-5 h-5" />
        </button>
        <h1 className="qt-page-title">Edit Group</h1>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="max-w-2xl space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Group Name *
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent text-foreground text-sm"
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Description
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            rows={3}
            className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent text-foreground text-sm resize-none"
            placeholder="Optional description of this group"
          />
        </div>

        {/* Color */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Color
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={formData.color || '#808080'}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              className="w-12 h-10 rounded-lg cursor-pointer"
            />
            <input
              type="text"
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              placeholder="#000000"
              className="flex-1 px-4 py-2 rounded-lg border qt-border-default bg-transparent text-foreground text-sm"
            />
          </div>
        </div>

        {/* Icon (emoji) */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Icon (emoji)
          </label>
          <input
            type="text"
            value={formData.icon}
            onChange={(e) => setFormData(prev => ({ ...prev, icon: e.target.value }))}
            maxLength={2}
            className="w-full px-4 py-2 rounded-lg border qt-border-default bg-transparent text-foreground text-sm"
            placeholder="e.g., 👥 or 🎭"
          />
        </div>

        {/* Save button */}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="qt-button qt-button-primary inline-flex items-center rounded-lg px-6 py-2 font-semibold qt-shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          <button
            type="button"
            onClick={() => setShowStateModal(true)}
            className="qt-button qt-button-secondary inline-flex items-center rounded-lg px-6 py-2 font-semibold qt-shadow-sm"
          >
            Group State
          </button>
        </div>
      </form>

      {/* Management sections */}
      <div className="mt-12 space-y-6">
        <GroupMembersCard
          members={members}
          allCharacters={allCharacters}
          expanded={membersExpanded}
          onToggle={() => setMembersExpanded(!membersExpanded)}
          onAdd={addMember}
          onRemove={removeMember}
        />

        <GroupLinkedStoresCard
          linkedStores={linkedStores}
          allStores={allStores}
          expanded={storesExpanded}
          onToggle={() => setStoresExpanded(!storesExpanded)}
          onLink={linkStore}
          onUnlink={unlinkStore}
        />
      </div>

      <StateEditorModal
        isOpen={showStateModal}
        onClose={() => setShowStateModal(false)}
        entityType="group"
        entityId={groupId}
        entityName={group.name}
      />
    </div>
  )
}
