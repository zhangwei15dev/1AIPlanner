import type { PropsWithChildren } from 'react'
import { AppProvider } from './store/app'
import './app.scss'

export default function App({ children }: PropsWithChildren) {
  return <AppProvider>{children}</AppProvider>
}
