interface TagDisplayProps {
  tags: Array<{
    id: string
    name: string
  }>
}

export function TagDisplay({ tags }: TagDisplayProps) {
  if (!tags || tags.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-slate-600 rounded-full hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
        >
          {tag.name}
        </span>
      ))}
    </div>
  )
}
