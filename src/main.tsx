import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './features/auth/AuthProvider'
import PresenceProvider from './features/presence/PresenceProvider'
import { WalletProvider } from './features/koins/WalletProvider'
import ThemeApplier from './features/shop/ThemeProvider'
import { SettingsProvider } from './features/settings/SettingsProvider'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ThemeApplier />
        <WalletProvider>
          <SettingsProvider>
            <PresenceProvider>
              <App />
            </PresenceProvider>
          </SettingsProvider>
        </WalletProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
