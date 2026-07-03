'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV = [
  { href: '/dashboard', icon: '⌂', label: 'TODAY'  },
  { href: '/tasks',     icon: '☐', label: 'TASKS'  },
  { href: '/braindump', icon: '◉', label: 'DUMP'   },
  { href: '/notes',     icon: '≡', label: 'NOTES'  },
  { href: '/contacts',  icon: '○', label: 'PEOPLE' },
]

export function NavBar() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <nav
      className="w-[72px] shrink-0 flex flex-col items-center py-5 gap-0.5"
      style={{
        background: 'linear-gradient(to bottom, #CCCAC0, #BAB8AE)',
        borderRight: '1px solid rgba(255,255,255,0.6)',
        boxShadow: '3px 0 8px rgba(148,141,126,0.22)',
      }}
    >
      {NAV.map(({ href, icon, label }) => {
        const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-0.5 w-full py-3 px-1 rounded-lg transition-all"
            style={{
              color: active ? '#516439' : '#837C6F',
              backgroundColor: active ? 'rgba(0,0,0,0.05)' : 'transparent',
            }}
          >
            <span style={{ fontSize: 22, lineHeight: '26px' }}>{icon}</span>
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 9,
              letterSpacing: '0.5px',
              fontWeight: 500,
            }}>
              {label}
            </span>
          </Link>
        )
      })}

      <div className="mt-auto w-full px-2">
        <button
          onClick={logout}
          className="w-full flex flex-col items-center gap-0.5 py-3 rounded-lg transition-all"
          style={{ color: '#9E9890' }}
        >
          <span style={{ fontSize: 16, lineHeight: '20px' }}>⏻</span>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 8,
            letterSpacing: '0.5px',
          }}>
            OUT
          </span>
        </button>
      </div>
    </nav>
  )
}
