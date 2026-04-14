'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const emailParam = searchParams.get('email') || '';

  const [email] = useState(emailParam);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await authApi.verifyEmail({ email, code });
      setSuccess('Email verified! Redirecting to login...');
      setTimeout(() => router.push('/login'), 2000);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError('');
    try {
      await authApi.resendVerification({ email });
      setSuccess('New verification code sent. Check your email.');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to resend.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="-mt-12 w-[420px]">
          <h3 className="font-roobert mb-2 text-[22px] leading-7 font-medium text-[#141414]">
            Verify your email
          </h3>
          <p className="mb-6 text-[14px] text-gray-500">
            We sent a 6-digit code to <span className="font-medium text-[#131313]">{email}</span>
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
              <label htmlFor="code" className="mb-2 block text-[14px] font-medium text-[#131313]">
                Verification Code
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                maxLength={6}
                className="w-full border border-gray-300 bg-white px-3 py-2 text-center text-[18px] tracking-[8px] text-gray-900 transition-all hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full cursor-pointer bg-[#131313] px-2.5 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <AiOutlineLoading3Quarters className="animate-spin" />
                  <span className="ml-2">Verifying...</span>
                </span>
              ) : (
                'Verify Email'
              )}
            </button>
          </form>

          <div className="mt-5">
            <p className="text-[14px] text-[#131313]">
              Didn&apos;t receive the code?{' '}
              <button
                onClick={handleResend}
                disabled={resending}
                className="cursor-pointer font-medium text-purple-800"
              >
                {resending ? 'Sending...' : 'Resend'}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white">
        <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin text-[#131313]" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
