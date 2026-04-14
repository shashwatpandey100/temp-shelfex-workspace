'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { validatePassword } from '@/lib/password';
import { BsEye, BsEyeSlash } from 'react-icons/bs';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const passwordCheck = validatePassword(newPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (!passwordCheck.valid) {
      setError('Password does not meet requirements');
      return;
    }

    setLoading(true);

    try {
      await authApi.resetPassword({ email, token, newPassword });
      setSuccess('Password reset successfully! Redirecting to login...');
      setTimeout(() => router.push('/login'), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  if (!token || !email) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="w-[420px]">
          <div className="mb-4 bg-gray-100 p-4">
            <p className="text-[13px] text-red-800">Invalid reset link. Please request a new one.</p>
          </div>
          <a href="/forgot-password" className="text-[14px] font-medium text-purple-800">
            Request new reset link
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="-mt-12 w-[420px]">
          <h3 className="font-roobert mb-2 text-[22px] leading-7 font-medium text-[#141414]">
            Set new password
          </h3>
          <p className="mb-6 text-[14px] text-gray-500">
            For <span className="font-medium text-[#131313]">{email}</span>
          </p>

          {error && (
            <div className="mb-4 bg-gray-100 p-4">
              <p className="text-[13px] text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="mb-4 bg-green-50 p-4">
              <p className="text-[13px] text-green-800">{success}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="password" className="mb-2 block text-[14px] font-medium text-[#131313]">
                New Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="group absolute top-0 right-0 flex aspect-square h-full cursor-pointer items-center justify-center hover:bg-[#2b2b2b]"
                >
                  {showPassword ? (
                    <BsEyeSlash className="text-black group-hover:text-white" />
                  ) : (
                    <BsEye className="text-black group-hover:text-white" />
                  )}
                </button>
              </div>

              {/* Password requirements */}
              {newPassword.length > 0 && (
                <div className="mt-2 space-y-1">
                  {[
                    { test: newPassword.length >= 8, label: '8+ characters' },
                    { test: /[a-z]/.test(newPassword), label: 'Lowercase letter' },
                    { test: /[A-Z]/.test(newPassword), label: 'Uppercase letter' },
                    { test: /[0-9]/.test(newPassword), label: 'Number' },
                    { test: /[^a-zA-Z0-9]/.test(newPassword), label: 'Special character' },
                  ].map((req) => (
                    <p key={req.label} className={`text-[12px] ${req.test ? 'text-green-600' : 'text-gray-400'}`}>
                      {req.test ? '✓' : '○'} {req.label}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-2 block text-[14px] font-medium text-[#131313]">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
                placeholder="••••••••"
              />
              {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                <p className="mt-1 text-[12px] text-red-500">Passwords do not match</p>
              )}
              {confirmPassword.length > 0 && newPassword === confirmPassword && (
                <p className="mt-1 text-[12px] text-green-600">✓ Passwords match</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !passwordCheck.valid || newPassword !== confirmPassword}
              className="w-full cursor-pointer bg-[#131313] px-2.5 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <AiOutlineLoading3Quarters className="animate-spin" />
                  <span className="ml-2">Resetting...</span>
                </span>
              ) : (
                'Reset Password'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white">
        <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin text-[#131313]" />
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  );
}
