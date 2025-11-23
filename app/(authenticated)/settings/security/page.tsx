'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function SecuritySettingsPage() {
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'complete'>('idle')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [encryptedData, setEncryptedData] = useState<any>(null)
  const [verificationCode, setVerificationCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSetup2FA() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/setup', {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to setup 2FA')
      }

      const data = await res.json()
      setQrCode(data.qrCode)
      setSecret(data.secret)
      setEncryptedData(data.encrypted)
      setSetupStep('qr')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleVerify() {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encryptedSecret: encryptedData.secret,
          encryptedIv: encryptedData.iv,
          encryptedAuthTag: encryptedData.authTag,
          verificationCode
        })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to enable 2FA')
      }

      const data = await res.json()
      setBackupCodes(data.backupCodes)
      setSetupStep('complete')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable2FA() {
    if (!confirm('Are you sure you want to disable 2FA? This will make your account less secure.')) {
      return
    }

    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to disable 2FA')
      }

      setSetupStep('idle')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Security Settings</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Two-Factor Authentication</h2>

        {setupStep === 'idle' && (
          <div>
            <p className="text-gray-600 mb-4">
              Add an extra layer of security to your account by requiring a code from your
              authenticator app when signing in.
            </p>
            <button
              onClick={handleSetup2FA}
              disabled={loading}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Setting up...' : 'Enable 2FA'}
            </button>
          </div>
        )}

        {setupStep === 'qr' && (
          <div className="space-y-4">
            <p className="text-gray-600">
              Scan this QR code with your authenticator app (1Password, Google Authenticator, Authy, etc.)
            </p>

            {qrCode && (
              <div className="flex justify-center">
                <Image src={qrCode} alt="2FA QR Code" width={200} height={200} />
              </div>
            )}

            <div>
              <p className="text-sm text-gray-600 mb-2">
                Or enter this code manually:
              </p>
              <code className="block bg-gray-100 p-2 rounded font-mono text-sm">
                {secret}
              </code>
            </div>

            <div>
              <label htmlFor="verificationCode" className="block text-sm font-medium mb-2">
                Enter the 6-digit code from your app:
              </label>
              <input
                id="verificationCode"
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                placeholder="000000"
                maxLength={6}
                className="block w-full rounded border-gray-300 shadow-sm"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleVerify}
                disabled={loading || verificationCode.length !== 6}
                className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify and Enable'}
              </button>
              <button
                onClick={() => setSetupStep('idle')}
                disabled={loading}
                className="bg-gray-300 text-gray-700 py-2 px-4 rounded hover:bg-gray-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {setupStep === 'complete' && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded">
              2FA has been enabled successfully!
            </div>

            <div>
              <p className="font-semibold mb-2">Save these backup codes</p>
              <p className="text-sm text-gray-600 mb-4">
                If you lose access to your authenticator app, you can use these codes to sign in.
                Each code can only be used once. Store them in a safe place.
              </p>

              <div className="bg-gray-100 p-4 rounded">
                <div className="grid grid-cols-2 gap-2 font-mono text-sm">
                  {backupCodes.map((code, index) => (
                    <div key={index}>{code}</div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => {
                  const text = backupCodes.join('\n')
                  navigator.clipboard.writeText(text)
                  alert('Backup codes copied to clipboard')
                }}
                className="mt-4 text-sm text-blue-600 hover:text-blue-700"
              >
                Copy backup codes
              </button>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {/* Disable 2FA section (show if already enabled) */}
      <div className="bg-white rounded-lg shadow p-6 mt-6">
        <h2 className="text-xl font-semibold mb-4">Disable 2FA</h2>
        <p className="text-gray-600 mb-4">
          This will remove two-factor authentication from your account.
        </p>
        <button
          onClick={handleDisable2FA}
          disabled={loading}
          className="bg-red-600 text-white py-2 px-4 rounded hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? 'Disabling...' : 'Disable 2FA'}
        </button>
      </div>
    </div>
  )
}
