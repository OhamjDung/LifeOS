'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function LogoutButton() {
  const router = useRouter()
  const supabase = createClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <button
      onClick={logout}
      className="w-full px-3 py-2 text-left text-sm text-gray-500 hover:text-gray-300 rounded-lg hover:bg-gray-800 transition-colors"
    >
      Sign out
    </button>
  )
}
