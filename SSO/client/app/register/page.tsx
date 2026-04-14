'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { validatePassword } from '@/lib/password';
import { BsEye, BsEyeSlash } from 'react-icons/bs';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-white">
        <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin text-[#131313]" />
      </div>
    }>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Invite prefill: ?invite=true&email=xxx&name=yyy
  const isInvite = searchParams.get('invite') === 'true';
  const prefillEmail = searchParams.get('email') || '';
  const prefillName = searchParams.get('name') || '';

  const [email, setEmail] = useState(prefillEmail);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(prefillName);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await authApi.getCurrentUser();
        router.push('/success');
      } catch (error) {
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, [router]);

  const passwordCheck = validatePassword(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!passwordCheck.valid) {
      setError('Password does not meet requirements');
      return;
    }

    setLoading(true);

    try {
      await authApi.register({
        email,
        username: username || undefined,
        password,
        name: name || undefined,
      });

      // Redirect to verify-email page
      router.push(`/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Registration failed.';
      const errors = err.response?.data?.errors;
      setError(errors ? errors.join('. ') : msg);
    } finally {
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
            {isInvite ? 'Complete your Shelfex account' : 'Create your Shelfex account'}
          </h3>
          {isInvite && (
            <p className="mb-4 text-[14px] text-gray-500">
              You&apos;ve been invited to join an organization. Set your password to get started.
            </p>
          )}

          <div className="mt-4">
            {error && (
              <div className="mb-6 bg-red-100 p-4">
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
                  htmlFor="email"
                  className="mb-2 block text-[14px] leading-5 font-medium text-[#131313]"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => !isInvite && setEmail(e.target.value)}
                  readOnly={isInvite}
                  required
                  autoComplete="email"
                  className={`w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all duration-200 hover:border-black focus:border-2 focus:border-black/80 focus:outline-none ${isInvite ? 'bg-gray-50 cursor-not-allowed opacity-75' : ''}`}
                  placeholder="you@example.com"
                />
              </div>

              <div className="relative">
                <label
                  htmlFor="username"
                  className="mb-2 block text-[14px] leading-5 font-medium text-[#131313]"
                >
                  Username <span className="text-xs text-gray-500">(optional)</span>
                </label>
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all duration-200 hover:border-black focus:border-2 focus:border-black/80 focus:outline-none"
                  placeholder="johndoe"
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
                    autoComplete="new-password"
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

                {/* Password requirements */}
                {password.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {[
                      { test: password.length >= 8, label: '8+ characters' },
                      { test: /[a-z]/.test(password), label: 'Lowercase letter' },
                      { test: /[A-Z]/.test(password), label: 'Uppercase letter' },
                      { test: /[0-9]/.test(password), label: 'Number' },
                      { test: /[^a-zA-Z0-9]/.test(password), label: 'Special character' },
                    ].map((req) => (
                      <p key={req.label} className={`text-[12px] ${req.test ? 'text-green-600' : 'text-gray-400'}`}>
                        {req.test ? '✓' : '○'} {req.label}
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div className="relative">
                <label
                  htmlFor="name"
                  className="mb-2 block text-[14px] leading-5 font-medium text-[#131313]"
                >
                  Full Name {!isInvite && <span className="text-xs text-gray-500">(optional)</span>}
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => !isInvite && setName(e.target.value)}
                  readOnly={isInvite}
                  autoComplete="name"
                  className={`w-full border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 transition-all duration-200 hover:border-black focus:border-2 focus:border-black/80 focus:outline-none ${isInvite ? 'bg-gray-50 cursor-not-allowed opacity-75' : ''}`}
                  placeholder="John Doe"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 w-full transform cursor-pointer bg-[#131313] px-2.5 py-3 text-[14px] font-medium text-white shadow-md transition-all duration-200 hover:bg-[#2b2b2b] disabled:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-md"
              >
                {loading ? (
                  <span className="flex items-center justify-center">
                    <AiOutlineLoading3Quarters className='animate-spin' />
                    <span className="ml-2">Creating Account...</span>
                  </span>
                ) : (
                  'Create Account'
                )}
              </button>
            </form>

            <div className="mt-5">
              <p className="group block w-max cursor-pointer text-[14px] font-medium text-[#131313]">
                Already have an account?{' '}
                <a href="/login" className="text-purple-800">
                  Sign in
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