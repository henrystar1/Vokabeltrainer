import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import StarField from '../ui/StarField'

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-full">
      <StarField />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <main
        className={`px-4 pb-28 pt-8 transition-[padding] duration-300 md:px-8 md:pb-12 ${
          collapsed ? 'md:pl-[108px]' : 'md:pl-[288px]'
        }`}
      >
        <div className="mx-auto max-w-6xl animate-rise">
          <Outlet />
        </div>
      </main>
      <MobileNav />
    </div>
  )
}
