'use client';

import { useEffect, useState } from 'react';
import { authApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { CgCheck } from 'react-icons/cg';
import { IoLogOutSharp } from 'react-icons/io5';
import { HiUser } from 'react-icons/hi';
import { MdAlternateEmail } from 'react-icons/md';
import { FaCircleUser } from 'react-icons/fa6';

export default function SuccessPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const userData = await authApi.getCurrentUser();
        setUser(userData);
      } catch (error) {
        // Not authenticated, redirect to login
        router.push('/login');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [router]);

  const handleLogout = async () => {
    try {
      await authApi.logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white">
        <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin text-[#131313]" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white">
      <div className="h-16 w-full p-4 flex items-center justify-between">
      </div>
      <div className="-mt-12 flex flex-col items-center justify-center bg-white">
        <div className="w-[420px]">
          <div className="mb-4 flex items-center">
            <div className="mr-3 inline-flex h-10 w-10 items-center justify-center bg-[#131313]">
              <CgCheck className='text-[28px]' />
            </div>
            <div>
              <h3 className="font-roobert text-[22px] leading-7 font-medium text-[#141414]">
                Successfully Logged In!
              </h3>
            </div>
          </div>

<div className='pb-6 border-b'>
<div className="bg-gray-100 p-4">
              <div className="flex items-start">
                <div className="text-[#131313]">
                  <p className="font-semibold text-[15px] text-[#4b4b4b] mb-1">Single Sign-On Active</p>
                  <p className="text-[13px]">You can now access all Shelfex apps without logging in again.</p>
                </div>
              </div>
            </div>
</div>

          <div className="mt-6">

            <div className="space-y-2 border-b pb-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <HiUser className='text-[22px] text-[#666666]' />
                  <div>
                    <p className="text-[12px] text-gray-500">Name</p>
                    <p className="text-[14px] font-medium text-[#131313]">{user.data.name || 'Not provided'}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <MdAlternateEmail className='text-[22px] text-[#666666]' />
                  <div>
                    <p className="text-[12px] text-gray-500">Email</p>
                    <p className="text-[14px] font-medium text-[#131313]">{user.data.email || 'Not provided'}</p>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleLogout}
              className="mt-6 w-full transform cursor-pointer bg-[#131313] px-2.5 py-3 text-[14px] font-medium text-white shadow-md transition-all duration-200 hover:bg-[#2b2b2b]"
            >
              <span className="flex gap-2.5 items-center justify-center">
                <IoLogOutSharp className='text-[22px]' />
                Sign Out
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
