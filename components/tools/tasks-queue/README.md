# Tasks Queue Card Component

This directory contains a refactored version of the tasks queue management card split into focused, reusable modules.

## Files

- **types.ts** - TypeScript interfaces and types
  - `QueueStats` - Statistics about the queue
  - `ProcessorStatus` - Status of the queue processor
  - `JobDetail` - Details of a single job
  - `FullJobDetail` - Extended job details with payload
  - `QueueData` - Complete queue data structure

- **hooks/useTasksQueue.ts** - Custom hook for queue management
  - Handles all API calls for fetching and managing jobs
  - Manages loading, error, and job action states
  - Governs the **fallback** poll (see "Staying current" below)

- **TaskItem.tsx** - Individual task list item component
  - Displays job status, metadata, and action buttons
  - Handles pause/resume/view/delete actions
  - Status color and icon rendering

- **TaskFilters.tsx** - Filter and control components
  - Refresh button
  - Queue start/stop controls
  - Fallback-polling toggle
  - Processor status indicator

- **TaskDetails.tsx** - Job details modal dialog
  - Shows complete job information
  - Displays error messages
  - Shows job payload (JSON)
  - Delete button

- **index.tsx** - Main component that orchestrates everything
  - Brings together all subcomponents
  - Manages overall layout and data flow

## Usage

```tsx
import { TasksQueueCard } from '@/components/tools/tasks-queue'

export function DashboardPage() {
  return <TasksQueueCard />
}
```

## Component Hierarchy

```
TasksQueueCard (index.tsx)
├── TaskFilters
├── Stats Display
├── TaskItem[] (mapped from data.jobs)
│   ├── Status Icon & Color
│   ├── Job Metadata
│   └── Action Buttons
└── TaskDetails (when dialog is open)
    ├── Job Metadata Grid
    ├── Error Display
    └── Payload Display
```

## Staying current

The queue is **pushed**, not polled. Every job-lifecycle chokepoint on the server publishes a `jobs`
hint over the realtime socket (`docs/developer/features/complete/realtime-updates.md`), and
`RealtimeProvider` invalidates `queryKeys.system.tasksQueue` when one arrives — normally within a
frame of the change committing.

The 5 s interval survives only as the fallback for a dropped socket, which is what the user-facing
**Fallback polling (5s)** switch governs. `useRealtimeRefetchInterval` returns `false` while the
socket is healthy, so with the wire up the switch does nothing at all. Its old label was
"Auto-refresh (5s)", which stopped being true once the push path landed.

## State Management

All state is managed in the `useTasksQueue` hook:
- Queue data and stats
- Loading and error states
- Job selection and dialog state
- Fallback-polling preference
- Action loading states

## API Integration

- `GET /api/v1/system/jobs` - Fetch queue status and jobs
- `POST /api/v1/system/jobs` - Start/stop queue
- `GET /api/v1/system/jobs/{jobId}` - Fetch job details
- `PATCH /api/v1/system/jobs/{jobId}` - Pause/resume job
- `DELETE /api/v1/system/jobs/{jobId}` - Delete job
