import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import StarField from '../ui/StarField'
import { FocusProvider } from '../../features/koins/focusMode'
import PanicButton from '../../features/panic/PanicButton'
import { ChatProvider } from '../../features/chat/ChatProvider'

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [focus, setFocus] = useState(false)

  return (
    <ChatProvider>
    <FocusProvider value={setFocus}>
      <div className="min-h-full">
        <StarField />
        {!focus && <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />}
        <main
          className={`px-4 pt-8 transition-[padding] duration-300 md:px-8 md:pb-12 ${focus ? 'pb-12' : 'pb-28'} ${
            focus ? '' : collapsed ? 'md:pl-[108px]' : 'md:pl-[288px]'
          }`}
        >
          <div className="mx-auto max-w-6xl animate-rise">
            <Outlet />
          </div>
        </main>
        <PanicButton />
        {!focus && <MobileNav />}
      </div>
    </FocusProvider>
    </ChatProvider>
  )
}
