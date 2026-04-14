'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { BsEye, BsEyeSlash } from 'react-icons/bs';
import Image from 'next/image';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Get OAuth params from URL (including PKCE + nonce)
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const state = searchParams.get('state');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');
  const nonce = searchParams.get('nonce');

  // Check if user is already logged in (skip for OAuth flows — cross-site cookies won't be sent)
  useEffect(() => {
    if (clientId) {
      // OAuth flow: show login form immediately, no session check needed
      setCheckingAuth(false);
      return;
    }

    const checkAuth = async () => {
      try {
        await authApi.getCurrentUser();
        // User is logged in, redirect to success page
        router.push('/success');
      } catch (error) {
        // User is not logged in, show login form
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, [router, clientId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await authApi.login({
        identifier,
        password,
        ...(clientId && { client_id: clientId }),
        ...(redirectUri && { redirect_uri: redirectUri }),
        ...(state && { state }),
        ...(codeChallenge && { code_challenge: codeChallenge }),
        ...(codeChallengeMethod && { code_challenge_method: codeChallengeMethod }),
        ...(nonce && { nonce }),
      });

      // OAuth flow: server returns a redirect URL to the authorize endpoint
      if (response.data?.redirectUrl) {
        window.location.href = response.data.redirectUrl;
        return;
      }

      // Standard login (no OAuth): go to success page
      router.push('/success');
    } catch (err: any) {
      setError(
        err.response?.data?.message || 'Login failed. Please try again.'
      );
      setLoading(false);
    }
  };

  if (checkingAuth) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white">
        <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin text-[#131313]" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="h-16 w-full p-4 flex items-center justify-between">
      </div>
      <div className="flex flex-1 flex-col items-center justify-center bg-white">
        <div className="-mt-12 w-[420px]">
          <h3 className="font-roobert mb-4 text-[22px] leading-7 font-medium text-[#141414]">
            Sign in to Shelfex
          </h3>

          <div className="mt-4">
            {clientId && (
              <div className="mb-6 bg-gray-100 p-4">
                <div className="flex items-center">
                  <svg
                    className="mr-2 h-5 w-5 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-sm text-blue-900">
                    <span className="font-medium">Signing in to:</span>{' '}
                    {clientId}
                  </p>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-6 bg-gray-100 p-4">
                <div className="flex items-center">
                  <svg
                    className="mt-0.5 mr-2 h-5 w-5 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="relative">
                <label
                  htmlFor="identifier"
                  className="mb-2 block text-[14px] leading-5 font-medium text-[#131313]"
                >
                  Email or Username
                </label>
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  autoComplete="username"
                  className="w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all duration-200 hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
                  placeholder="you@example.com"
                />
              </div>

              <div className="relative">
                <label
                  htmlFor="password"
                  className="mb-2 block text-[14px] leading-5 font-medium text-[#131313]"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all duration-200 hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
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
                <a href="/forgot-password" className="mt-2 mb-2 block w-max cursor-pointer px-1 py-0.5 text-[14px] font-medium text-[#131313] transition-all duration-100 hover:bg-black/80 hover:text-white">
                  Forgot your password?
                </a>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full transform cursor-pointer bg-[#131313] px-2.5 py-3 text-[14px] font-medium text-white shadow-md transition-all duration-200 hover:bg-[#2b2b2b] disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-md"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <AiOutlineLoading3Quarters className='animate-spin' />
                    <span className="ml-2">Signing In...</span>
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="mt-5">
              <p className="group block w-max cursor-pointer text-[14px] font-medium text-[#131313]">
                Don't have an account?{' '}
                <a href="/register" className="text-purple-800">
                  Create one
                </a>
              </p>
            </div>
            <div>
              <p className="group block w-max cursor-pointer text-[14px] font-medium text-[#131313]">
                By continuing, you agree to our <span className='text-purple-800'>Terms</span>{' '}
                and <span className='text-purple-800'>Privacy Policy</span>.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const GooglePlayButtonComponent = () => (
  <a
    href="https://play.google.com/store/apps/details?id=com.se_app&pcampaignid=web_share"
    className="inline-block"
  >
    <Image
      src="/svgs/play_store_btn.svg"
      alt="Get it on Google Play"
      width={120}
      height={40}
      className="h-9 w-auto"
    />
  </a>
);

const AppStoreButtonComponent = () => (
  <a
    href="#"
    className="inline-block"
    onClick={(e) => e.preventDefault()}
  >
    <Image
      src="/svgs/app_store_btn.svg"
      alt="Download on the App Store"
      width={120}
      height={40}
      className="h-9 w-auto"
    />
  </a>
);

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen flex-col items-center justify-center bg-white">
        <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin text-[#131313]" />
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}