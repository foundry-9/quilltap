'use client'

interface QuillAnimationProps {
  size?: 'lg' | 'sm'
  className?: string
}

export function QuillAnimation({ size = 'lg', className = '' }: QuillAnimationProps) {
  const sizeClasses = size === 'lg'
    ? 'w-12 h-12'
    : 'w-4 h-4'

  return (
    <div className={`inline-flex items-center justify-center ${sizeClasses} ${className}`}>
      <svg
        viewBox="0 0 100 100"
        className={`${sizeClasses} animate-quill-write`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Quill feather */}
        <path
          d="M 20 80 Q 25 60 30 40 Q 32 30 35 20"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          className="opacity-60"
        />

        {/* Quill tip */}
        <ellipse
          cx="35"
          cy="18"
          rx="3"
          ry="4"
          fill="currentColor"
          className="opacity-80"
        />

        {/* Paper/page */}
        <rect
          x="40"
          y="50"
          width="45"
          height="35"
          rx="2"
          stroke="currentColor"
          strokeWidth="2"
          className="opacity-40"
        />

        {/* Writing lines on paper */}
        <line
          x1="45"
          y1="60"
          x2="80"
          y2="60"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-30"
        />
        <line
          x1="45"
          y1="70"
          x2="75"
          y2="70"
          stroke="currentColor"
          strokeWidth="1.5"
          className="opacity-30"
        />
      </svg>

      <style jsx>{`
        @keyframes quill-write {
          0% {
            opacity: 0.6;
            transform: translateY(0px) rotate(0deg);
          }
          50% {
            opacity: 1;
            transform: translateY(-2px) rotate(-2deg);
          }
          100% {
            opacity: 0.6;
            transform: translateY(0px) rotate(0deg);
          }
        }

        :global(.animate-quill-write) {
          animation: quill-write 1.2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
