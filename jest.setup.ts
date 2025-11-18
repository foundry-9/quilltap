import '@testing-library/jest-dom'

// Mock environment variables for tests
process.env.ENCRYPTION_MASTER_PEPPER = process.env.ENCRYPTION_MASTER_PEPPER || 'test-pepper-for-unit-tests-32-chars-long!'
