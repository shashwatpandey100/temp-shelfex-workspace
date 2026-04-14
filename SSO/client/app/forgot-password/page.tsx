'use client';

import { useState } from 'react';
import { authApi } from '@/lib/api';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await authApi.forgotPassword({ email });
      setSent(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="-mt-12 w-[420px]">
          <h3 className="font-roobert mb-2 text-[22px] leading-7 font-medium text-[#141414]">
            Reset your password
          </h3>

          {sent ? (
            <div>
              <div className="mb-4 bg-green-50 p-4">
                <p className="text-[13px] text-green-800">
                  If that email is registered, a password reset link has been sent. Check your inbox.
                </p>
              </div>
              <a href="/login" className="text-[14px] font-medium text-purple-800">
                Back to sign in
              </a>
            </div>
          ) : (
            <>
              <p className="mb-6 text-[14px] text-gray-500">
                Enter your email and we&apos;ll send you a link to reset your password.
              </p>

              {error && (
                <div className="mb-4 bg-gray-100 p-4">
                  <p className="text-[13px] text-red-800">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-2 block text-[14px] font-medium text-[#131313]">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
                    placeholder="you@example.com"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full cursor-pointer bg-[#131313] px-2.5 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#2b2b2b] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? (
                    <span className="flex items-center justify-center">
                      <AiOutlineLoading3Quarters className="animate-spin" />
                      <span className="ml-2">Sending...</span>
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>

              <div className="mt-5">
                <a href="/login" className="text-[14px] font-medium text-purple-800">
                  Back to sign in
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
